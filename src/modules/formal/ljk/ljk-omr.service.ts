import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface OmrExtractionResult {
  kodeCabang: string;
  nisn: string;
  kelas: string;
  semester: string;
  mapel: string;
  jawaban: Record<string, string>;
  confidence: number;
  ambiguities: number[];
  totalSoal: number;
  jumlahBenar?: number;
  jumlahSalah?: number;
  jumlahKosong?: number;
  skor?: number;
  detectedMetrics?: {
    avgContrast: number;
    dimensions: { width: number; height: number };
  };
}

@Injectable()
export class LjkOmrService {
  private readonly logger = new Logger(LjkOmrService.name);

  /**
   * Memproses buffer gambar LJK menggunakan Sharp untuk Optical Mark Recognition (OMR)
   */
  async processLjkImage(
    buffer: Buffer,
    hints?: {
      mapel?: string;
      kelas?: string;
      semester?: string;
      questionBankId?: string;
      answerKey?: Record<string, string>;
    },
  ): Promise<OmrExtractionResult> {
    const TARGET_WIDTH = 1000;
    const TARGET_HEIGHT = 1414; // Rasio standar A4 (1 : 1.414)

    // 1. Normalisasi & Konversi Grayscale via Sharp
    const normalizedImage = sharp(buffer)
      .rotate() // Auto-orient berdasarkan EXIF
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: 'fill',
      })
      .grayscale()
      .normalize();

    const { data: rawPixels, info } = await normalizedImage
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // 2. Hitung ambang batas kehitaman (Thresholding)
    // Hitung rata-rata kecerahan piksel dokumen (background paper)
    let totalBrightness = 0;
    const sampleStep = 10;
    let sampleCount = 0;
    for (let i = 0; i < rawPixels.length; i += sampleStep) {
      totalBrightness += rawPixels[i];
      sampleCount++;
    }
    const avgPaperBrightness = totalBrightness / sampleCount;
    // Nilai piksel di bawah batas ini dianggap arsiran hitam pensil 2B / pulpen
    const darkThreshold = Math.max(60, Math.min(135, avgPaperBrightness - 50));

    // Helper: Mengambil nilai kehitaman dan rasio arsiran pada area lingkaran bulatan (Bubble)
    const sampleBubble = (
      normX: number,
      normY: number,
      normRadius = 0.009,
    ): { fillRatio: number; meanIntensity: number; darkPixels: number } => {
      const cx = Math.round(normX * width);
      const cy = Math.round(normY * height);
      const r = Math.max(4, Math.round(normRadius * width));

      let darkPixels = 0;
      let totalPixels = 0;
      let sumIntensity = 0;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const val = rawPixels[py * width + px];
              sumIntensity += val;
              if (val < darkThreshold) {
                darkPixels++;
              }
              totalPixels++;
            }
          }
        }
      }

      const fillRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
      const meanIntensity = totalPixels > 0 ? sumIntensity / totalPixels : 255;
      return { fillRatio, meanIntensity, darkPixels };
    };

    // 3. Ekstraksi Grid Kode Cabang (4 digit: kolom 0..3, baris 0..9)
    // Koordinat relatif area Kode Cabang: x: 0.10 s.d 0.26, y: 0.16 s.d 0.32
    let extractedKodeCabang = '';
    const cabangXStart = 0.11;
    const cabangXSpacing = 0.038;
    const cabangYStart = 0.18;
    const cabangYSpacing = 0.015;

    for (let col = 0; col < 4; col++) {
      let maxRatio = -1;
      let bestDigit = col === 0 ? '1' : '0'; // Default digit pertama '1' sesuai format 1001

      for (let digit = 0; digit <= 9; digit++) {
        const x = cabangXStart + col * cabangXSpacing;
        const y = cabangYStart + digit * cabangYSpacing;
        const { fillRatio } = sampleBubble(x, y);

        if (fillRatio > maxRatio) {
          maxRatio = fillRatio;
          bestDigit = digit.toString();
        }
      }
      extractedKodeCabang += bestDigit;
    }

    // Format kode cabang dipastikan 4 digit diawali angka 1 jika memungkinkan
    if (!extractedKodeCabang.startsWith('1')) {
      extractedKodeCabang = '1' + extractedKodeCabang.slice(1);
    }

    // 4. Ekstraksi Grid NISN (10 digit: kolom 0..9, baris 0..9)
    // Koordinat relatif area NISN: x: 0.32 s.d 0.68, y: 0.16 s.d 0.32
    let extractedNisn = '';
    const nisnXStart = 0.32;
    const nisnXSpacing = 0.036;
    const nisnYStart = 0.18;
    const nisnYSpacing = 0.015;

    for (let col = 0; col < 10; col++) {
      let maxRatio = -1;
      let bestDigit = (col % 10).toString();

      for (let digit = 0; digit <= 9; digit++) {
        const x = nisnXStart + col * nisnXSpacing;
        const y = nisnYStart + digit * nisnYSpacing;
        const { fillRatio } = sampleBubble(x, y);

        if (fillRatio > maxRatio) {
          maxRatio = fillRatio;
          bestDigit = digit.toString();
        }
      }
      extractedNisn += bestDigit;
    }

    // 5. Ekstraksi Tingkat / Kelas (7 s.d 12)
    const kelasOptions = ['7', '8', '9', '10', '11', '12'];
    let extractedKelas = hints?.kelas || '7';
    let maxKelasRatio = -1;
    const kelasY = 0.35;
    for (let i = 0; i < kelasOptions.length; i++) {
      const x = 0.12 + i * 0.04;
      const { fillRatio } = sampleBubble(x, kelasY);
      if (fillRatio > maxKelasRatio && fillRatio > 0.25) {
        maxKelasRatio = fillRatio;
        extractedKelas = kelasOptions[i];
      }
    }

    // 6. Ekstraksi Semester (Ganjil / Genap)
    let extractedSemester = hints?.semester || 'GANJIL';
    const semesterGanjil = sampleBubble(0.42, 0.35);
    const semesterGenap = sampleBubble(0.50, 0.35);
    if (semesterGenap.fillRatio > semesterGanjil.fillRatio && semesterGenap.fillRatio > 0.25) {
      extractedSemester = 'GENAP';
    } else if (semesterGanjil.fillRatio > 0.25) {
      extractedSemester = 'GANJIL';
    }

    // 7. Ekstraksi Mata Pelajaran
    const extractedMapel = hints?.mapel || 'Pendidikan Agama Islam';

    // 8. Ekstraksi 25 Butir Soal Pilihan Ganda (A, B, C, D)
    // Desain grid 2 kolom:
    // Kolom Kiri: Nomor 1 s.d 13 (x: 0.10 s.d 0.45)
    // Kolom Kanan: Nomor 14 s.d 25 (x: 0.55 s.d 0.90)
    const options = ['A', 'B', 'C', 'D'];
    const jawaban: Record<string, string> = {};
    const ambiguities: number[] = [];
    let totalConfidenceSum = 0;

    const optSpacing = 0.045; // Jarak antar bulatan A-B-C-D
    const qRowSpacing = 0.033; // Jarak antar baris nomor soal
    const qStartY = 0.44;

    // Threshold adaptif berdasarkan kondisi foto:
    // Foto kamera HP bisa lebih terang/gelap dari scan flat.
    // Gunakan radius lebih besar & threshold lebih rendah agar toleran.
    const adaptiveSampleBubble = (
      normX: number,
      normY: number,
    ): { fillRatio: number; meanIntensity: number; darkPixels: number } => {
      // Coba 3 radius berbeda dan ambil yang paling tinggi (adaptive best-of-3)
      const radii = [0.010, 0.013, 0.008];
      let best = { fillRatio: 0, meanIntensity: 255, darkPixels: 0 };
      for (const r of radii) {
        const result = sampleBubble(normX, normY, r);
        if (result.fillRatio > best.fillRatio) best = result;
      }
      return best;
    };

    for (let q = 1; q <= 25; q++) {
      const isLeftCol = q <= 13;
      const rowIdx = isLeftCol ? q - 1 : q - 14;
      const startX = isLeftCol ? 0.16 : 0.60;
      const y = qStartY + rowIdx * qRowSpacing;

      const scoredOptions: { opt: string; ratio: number; intensity: number }[] = [];

      for (let oIdx = 0; oIdx < options.length; oIdx++) {
        const x = startX + oIdx * optSpacing;
        const { fillRatio, meanIntensity } = adaptiveSampleBubble(x, y);
        scoredOptions.push({
          opt: options[oIdx],
          ratio: fillRatio,
          intensity: meanIntensity,
        });
      }

      // Urutkan dari yang paling gelap / rasio arsiran tertinggi
      scoredOptions.sort((a, b) => b.ratio - a.ratio);

      const top = scoredOptions[0];
      const runnerUp = scoredOptions[1];

      // Kriteria penentuan arsiran adaptif:
      // Threshold diturunkan ke 0.12 agar toleran pada foto kamera HP (tidak hanya flat scan)
      // Sebelumnya 0.25 terlalu ketat untuk foto dari kamera yang ada distorsi perspektif
      const FILL_THRESHOLD = 0.12;

      if (top.ratio >= FILL_THRESHOLD) {
        jawaban[q.toString()] = top.opt;
        const margin = top.ratio - runnerUp.ratio;

        if (margin < 0.08 && runnerUp.ratio >= 0.10) {
          // Ambigu: Dua bulatan terisi mirip (coretan / arsiran ganda)
          ambiguities.push(q);
          totalConfidenceSum += 0.5;
        } else {
          totalConfidenceSum += Math.min(1.0, 0.6 + margin * 2);
        }
      } else {
        // Bulatan kosong / tidak terisi
        jawaban[q.toString()] = '';
        totalConfidenceSum += 0.85; // Yakin memang sengaja dikosongkan
      }
    }

    const overallConfidence = Number((totalConfidenceSum / 25).toFixed(2));

    // 9. Perhitungan Skor Otomatis jika terdapat Kunci Jawaban
    let jumlahBenar = 0;
    let jumlahSalah = 0;
    let jumlahKosong = 0;
    let skor: number | undefined = undefined;

    if (hints?.answerKey && Object.keys(hints.answerKey).length > 0) {
      for (let q = 1; q <= 25; q++) {
        const studentAns = (jawaban[q.toString()] || '').toUpperCase().trim();
        const keyAns = (hints.answerKey[q.toString()] || '').toUpperCase().trim();

        if (!studentAns) {
          jumlahKosong++;
        } else if (keyAns && studentAns === keyAns) {
          jumlahBenar++;
        } else {
          jumlahSalah++;
        }
      }
      // Formula: benar × 4 (25 soal × 4 = 100 poin maks)
      skor = jumlahBenar * 4;
    }

    return {
      kodeCabang: extractedKodeCabang,
      nisn: extractedNisn,
      kelas: extractedKelas,
      semester: extractedSemester,
      mapel: extractedMapel,
      jawaban,
      confidence: overallConfidence,
      ambiguities,
      totalSoal: 25,
      jumlahBenar: hints?.answerKey ? jumlahBenar : undefined,
      jumlahSalah: hints?.answerKey ? jumlahSalah : undefined,
      jumlahKosong: hints?.answerKey ? jumlahKosong : undefined,
      skor,
      detectedMetrics: {
        avgContrast: avgPaperBrightness,
        dimensions: { width, height },
      },
    };
  }
}
