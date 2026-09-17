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
    ljkBounds?: { left: number; top: number; right: number; bottom: number; detected: boolean };
    corners?: Record<string, { x: number; y: number; intensity: number; found: boolean }>;
    allMarkersFound?: boolean;
  };
}

@Injectable()
export class LjkOmrService {
  private readonly logger = new Logger(LjkOmrService.name);

  /**
   * Memproses buffer gambar LJK menggunakan Sharp untuk Optical Mark Recognition (OMR).
   *
   * Fitur utama:
   * - Deteksi otomatis batas kertas LJK menggunakan 4 fiducial corner marker (kotak hitam 7mm)
   * - Coordinate remapping sehingga sampling bubble selalu relatif terhadap area LJK
   * - Toleran terhadap foto kamera HP yang tidak memenuhi frame (ada background meja/lantai)
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
    const { data: rawPixels, info } = await sharp(buffer)
      .rotate() // Auto-orient berdasarkan EXIF
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill' })
      .grayscale()
      .normalize()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // 2. Hitung ambang batas kehitaman (Adaptive Threshold)
    let totalBrightness = 0;
    const sampleStep = 10;
    let sampleCount = 0;
    for (let i = 0; i < rawPixels.length; i += sampleStep) {
      totalBrightness += rawPixels[i];
      sampleCount++;
    }
    const avgPaperBrightness = totalBrightness / sampleCount;
    // Nilai piksel di bawah batas ini = arsiran hitam pensil 2B / pulpen
    const darkThreshold = Math.max(60, Math.min(140, avgPaperBrightness - 45));

    // ─── 3. DETEKSI FIDUCIAL CORNER MARKER & BILINEAR MAPPING ─────────────────
    // LJK memiliki 4 kotak hitam solid (7mm) di setiap sudut kertas.
    // Deteksi mencari window lokal paling gelap (minimum mean intensity) di masing-masing sudut,
    // yang menjamin deteksi sukses bahkan dengan bayangan/glare lampu ruangan pada foto HP.
    const zones = {
      TL: { x0: 0.005, x1: 0.28, y0: 0.005, y1: 0.25 },
      TR: { x0: 0.72, x1: 0.995, y0: 0.005, y1: 0.25 },
      BL: { x0: 0.005, x1: 0.28, y0: 0.75, y1: 0.995 },
      BR: { x0: 0.72, x1: 0.995, y0: 0.75, y1: 0.995 },
    };

    const win = Math.max(8, Math.round(width * 0.013));
    const detectedCorners: Record<string, { x: number; y: number; intensity: number; found: boolean }> = {};

    for (const [name, z] of Object.entries(zones)) {
      const x0 = Math.round(z.x0 * width);
      const x1 = Math.round(z.x1 * width);
      const y0 = Math.round(z.y0 * height);
      const y1 = Math.round(z.y1 * height);

      let minVal = Infinity;
      let bestX = Math.round((x0 + x1) / 2);
      let bestY = Math.round((y0 + y1) / 2);

      for (let y = y0 + win; y <= y1 - win; y += 2) {
        for (let x = x0 + win; x <= x1 - win; x += 2) {
          let sum = 0;
          let count = 0;
          for (let dy = -win; dy <= win; dy += 2) {
            for (let dx = -win; dx <= win; dx += 2) {
              sum += rawPixels[(y + dy) * width + (x + dx)];
              count++;
            }
          }
          const val = sum / count;
          if (val < minVal) {
            minVal = val;
            bestX = x;
            bestY = y;
          }
        }
      }

      // Validasi: kotak marker harus secara signifikan lebih gelap dari kertas
      const found = minVal < avgPaperBrightness - 20;
      detectedCorners[name] = { x: bestX, y: bestY, intensity: minVal, found };
    }

    const allMarkersFound =
      detectedCorners.TL.found &&
      detectedCorners.TR.found &&
      detectedCorners.BL.found &&
      detectedCorners.BR.found;

    this.logger.log(
      `OMR Corner Markers: ` +
        `TL=(${detectedCorners.TL.x},${detectedCorners.TL.y},dark=${detectedCorners.TL.intensity.toFixed(1)}) ` +
        `TR=(${detectedCorners.TR.x},${detectedCorners.TR.y},dark=${detectedCorners.TR.intensity.toFixed(1)}) ` +
        `BL=(${detectedCorners.BL.x},${detectedCorners.BL.y},dark=${detectedCorners.BL.intensity.toFixed(1)}) ` +
        `BR=(${detectedCorners.BR.x},${detectedCorners.BR.y},dark=${detectedCorners.BR.intensity.toFixed(1)}) | ` +
        `Detected=${allMarkersFound}`,
    );

    // ─── 4. BILINEAR INTERPOLATION MAPPING ──────────────────────────────────
    // Mengonversi koordinat relatif LJK (u, v) ∈ [0, 1] ke posisi piksel absolut (x, y).
    // u: 0 = garis marker kiri, 1 = garis marker kanan
    // v: 0 = garis marker atas, 1 = garis marker bawah
    // Bilinear mapping secara otomatis mengoreksi perspektif, distorsi kamera HP, & kemiringan kertas!
    const getPoint = (u: number, v: number): { x: number; y: number } => {
      if (allMarkersFound) {
        const tl = detectedCorners.TL;
        const tr = detectedCorners.TR;
        const bl = detectedCorners.BL;
        const br = detectedCorners.BR;
        const x = (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x;
        const y = (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y;
        return { x, y };
      }
      return { x: u * width, y: v * height };
    };

    // Helper sampling bulatan dalam koordinat (u, v)
    const sampleBubble = (
      u: number,
      v: number,
      normRadius = 0.007,
    ): { fillRatio: number; meanIntensity: number; darkPixels: number } => {
      const pt = getPoint(u, v);
      const cx = Math.round(pt.x);
      const cy = Math.round(pt.y);
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
              if (val < darkThreshold) darkPixels++;
              totalPixels++;
            }
          }
        }
      }

      const fillRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
      const meanIntensity = totalPixels > 0 ? sumIntensity / totalPixels : 255;
      return { fillRatio, meanIntensity, darkPixels };
    };

    // ─── 5. Ekstraksi Grid Kode Cabang (4 digit: kolom 0..3, baris 0..9) ────
    let extractedKodeCabang = '';
    const cabStartU = 0.7638;
    const cabColSpacing = 0.02736;
    const cabStartV = 0.0854;
    const cabRowSpacing = 0.01423;

    for (let col = 0; col < 4; col++) {
      let maxRatio = -1;
      let bestDigit = col === 0 ? '1' : '0';

      for (let digit = 0; digit <= 9; digit++) {
        const u = cabStartU + col * cabColSpacing;
        const v = cabStartV + digit * cabRowSpacing;
        const { fillRatio } = sampleBubble(u, v, 0.006);

        if (fillRatio > maxRatio) {
          maxRatio = fillRatio;
          bestDigit = digit.toString();
        }
      }
      extractedKodeCabang += bestDigit;
    }

    if (!extractedKodeCabang.startsWith('1')) {
      extractedKodeCabang = '1' + extractedKodeCabang.slice(1);
    }

    // ─── 6. Ekstraksi Grid NISN (10 digit: kolom 0..9, baris 0..9) ──────────
    let extractedNisn = '';
    const nisnStartU = 0.3779;
    const nisnColSpacing = 0.02736;
    const nisnStartV = 0.2954;
    const nisnRowSpacing = 0.01476;

    for (let col = 0; col < 10; col++) {
      let maxRatio = -1;
      let bestDigit = (col % 10).toString();

      for (let digit = 0; digit <= 9; digit++) {
        const u = nisnStartU + col * nisnColSpacing;
        const v = nisnStartV + digit * nisnRowSpacing;
        const { fillRatio } = sampleBubble(u, v, 0.006);

        if (fillRatio > maxRatio) {
          maxRatio = fillRatio;
          bestDigit = digit.toString();
        }
      }
      extractedNisn += bestDigit;
    }

    // ─── 7. Ekstraksi Tingkat / Kelas (7 s.d 12) ────────────────────────────
    const kelasOptions = ['7', '8', '9', '10', '11', '12'];
    const kelasUOptions = [0.734, 0.760, 0.786, 0.812, 0.838, 0.864];
    const kelasV = 0.244;
    let extractedKelas = hints?.kelas || '12';
    let maxKelasRatio = -1;

    for (let i = 0; i < kelasOptions.length; i++) {
      const { fillRatio } = sampleBubble(kelasUOptions[i], kelasV, 0.006);
      if (fillRatio > maxKelasRatio && fillRatio > 0.15) {
        maxKelasRatio = fillRatio;
        extractedKelas = kelasOptions[i];
      }
    }

    // ─── 8. Ekstraksi Semester (Ganjil / Genap) ──────────────────────────────
    let extractedSemester = hints?.semester || 'GANJIL';
    const semesterGanjil = sampleBubble(0.940, 0.244, 0.006);
    const semesterGenap = sampleBubble(0.985, 0.244, 0.006);
    if (semesterGenap.fillRatio > semesterGanjil.fillRatio && semesterGenap.fillRatio > 0.15) {
      extractedSemester = 'GENAP';
    } else if (semesterGanjil.fillRatio > 0.15) {
      extractedSemester = 'GANJIL';
    }

    // ─── 9. Mata Pelajaran ───────────────────────────────────────────────────
    const extractedMapel = hints?.mapel || 'Pendidikan Agama Islam';

    // ─── 10. Ekstraksi 25 Butir Soal Pilihan Ganda (A, B, C, D) ─────────────
    // Grid 2 kolom dalam area LJK:
    // Kolom Kiri : Nomor  1 s.d 13
    // Kolom Kanan: Nomor 14 s.d 25
    const options = ['A', 'B', 'C', 'D'];
    const jawaban: Record<string, string> = {};
    const ambiguities: number[] = [];
    let totalConfidenceSum = 0;

    // Koordinat terkalibrasi presisi dengan bilinear mapping
    const leftA_u = 0.3540;
    const leftOpt_spacing = 0.0405;
    const rightA_u = 0.8615;
    const rightOpt_spacing = 0.0405;
    const qStartY = 0.6607;
    const qRow_spacing = 0.02403;

    // Adaptive threshold untuk arsiran bulatan
    const FILL_THRESHOLD = 0.18;

    for (let q = 1; q <= 25; q++) {
      const isLeftCol = q <= 13;
      const rowIdx = isLeftCol ? q - 1 : q - 14;
      const startU = isLeftCol ? leftA_u : rightA_u;
      const optSp = isLeftCol ? leftOpt_spacing : rightOpt_spacing;
      const v = qStartY + rowIdx * qRow_spacing;

      const scoredOptions: { opt: string; ratio: number; intensity: number }[] = [];

      for (let oIdx = 0; oIdx < options.length; oIdx++) {
        const u = startU + oIdx * optSp;
        const r1 = sampleBubble(u, v, 0.007);
        const r2 = sampleBubble(u, v, 0.009);
        const { fillRatio, meanIntensity } = r1.fillRatio >= r2.fillRatio ? r1 : r2;

        scoredOptions.push({ opt: options[oIdx], ratio: fillRatio, intensity: meanIntensity });
      }

      // Urutkan dari arsiran tertinggi
      scoredOptions.sort((a, b) => b.ratio - a.ratio);

      const top = scoredOptions[0];
      const runnerUp = scoredOptions[1];

      if (top.ratio >= FILL_THRESHOLD) {
        jawaban[q.toString()] = top.opt;
        const margin = top.ratio - runnerUp.ratio;

        if (margin < 0.08 && runnerUp.ratio >= 0.12) {
          ambiguities.push(q);
          totalConfidenceSum += 0.5;
        } else {
          totalConfidenceSum += Math.min(1.0, 0.6 + margin * 2);
        }
      } else {
        jawaban[q.toString()] = '';
        totalConfidenceSum += 0.8;
      }
    }

    const overallConfidence = Number((totalConfidenceSum / 25).toFixed(2));

    // ─── 11. Log hasil ekstraksi untuk debugging ─────────────────────────────
    const detectedCount = Object.values(jawaban).filter(Boolean).length;
    this.logger.log(
      `OMR Result: Kode=${extractedKodeCabang} NISN=${extractedNisn} ` +
        `Kelas=${extractedKelas} Sem=${extractedSemester} ` +
        `Jawaban terdeteksi: ${detectedCount}/25 | Confidence: ${(overallConfidence * 100).toFixed(0)}%`,
    );
    this.logger.log(`OMR Jawaban: ${JSON.stringify(jawaban)}`);

    // ─── 12. Perhitungan Skor Otomatis jika ada Kunci Jawaban ────────────────
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
        ljkBounds: {
          left: detectedCorners.TL.x / width,
          top: detectedCorners.TL.y / height,
          right: detectedCorners.BR.x / width,
          bottom: detectedCorners.BR.y / height,
          detected: allMarkersFound,
        },
        corners: detectedCorners,
        allMarkersFound,
      },
    };
  }
}
