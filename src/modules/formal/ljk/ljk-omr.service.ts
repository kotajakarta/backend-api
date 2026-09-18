import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface OmrExtractionResult {
  kodeCabang: string;
  kodeMapelNum: string; // '01'–'99', '' jika tidak terisi
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
   * Memproses buffer gambar LJK A5 menggunakan Sharp untuk Optical Mark Recognition.
   *
   * Format baru (A5 portrait, hasil split dari A4 landscape):
   *   - 4 kotak hitam 5x5mm di pojok (fiducial markers, 2mm dari tepi)
   *   - Kode Cabang 4 digit, Kode Mapel 2 digit, Kelas, Semester
   *   - NISN 10 digit
   *   - Jawaban PG: 25/30/40/50 butir soal (via hints.totalSoal)
   *
   * Koordinat normalized: u=x/148mm, v=y/210mm
   */
  async processLjkImage(
    buffer: Buffer,
    hints?: {
      mapel?: string;
      kelas?: string;
      semester?: string;
      questionBankId?: string;
      answerKey?: Record<string, string>;
      totalSoal?: 25 | 30 | 40 | 50;
    },
  ): Promise<OmrExtractionResult> {
    const TOTAL_SOAL = (hints?.totalSoal ?? 25) as 25 | 30 | 40 | 50;
    const TARGET_WIDTH = 1000;
    const TARGET_HEIGHT = 1419; // 210/148 * 1000

    // 1. Normalisasi, Deteksi Orientasi, & Grayscale
    let pipeline = sharp(buffer).rotate();
    const meta = await pipeline.metadata();
    // Jika scan lembar A5 dalam posisi horizontal/landscape (lebar > tinggi), rotasikan 90° agar menjadi portrait A5
    if (meta.width && meta.height && meta.width > meta.height) {
      pipeline = pipeline.rotate(90);
    }
    const { data: rawPixels, info } = await pipeline
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'fill' })
      .grayscale()
      .normalize()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // 2. Adaptive Threshold
    let totalBrightness = 0;
    const sampleStep = 10;
    let sampleCount = 0;
    for (let i = 0; i < rawPixels.length; i += sampleStep) {
      totalBrightness += rawPixels[i];
      sampleCount++;
    }
    const avgPaperBrightness = totalBrightness / sampleCount;
    const darkThreshold = Math.max(60, Math.min(140, avgPaperBrightness - 45));

    // 3. Deteksi Corner Markers (5x5mm, center di 4.5mm dari tepi)
    const zones = {
      TL: { x0: 0.000, x1: 0.130, y0: 0.000, y1: 0.090 },
      TR: { x0: 0.870, x1: 1.000, y0: 0.000, y1: 0.090 },
      BL: { x0: 0.000, x1: 0.130, y0: 0.910, y1: 1.000 },
      BR: { x0: 0.870, x1: 1.000, y0: 0.910, y1: 1.000 },
    };

    const win = Math.max(10, Math.round(width * 0.018));
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

      const found = minVal < avgPaperBrightness - 20;
      detectedCorners[name] = { x: bestX, y: bestY, intensity: minVal, found };
    }

    const allMarkersFound =
      detectedCorners.TL.found &&
      detectedCorners.TR.found &&
      detectedCorners.BL.found &&
      detectedCorners.BR.found;

    this.logger.log(
      `OMR A5 Corners: ` +
        `TL=(${detectedCorners.TL.x},${detectedCorners.TL.y},i=${detectedCorners.TL.intensity.toFixed(1)}) ` +
        `TR=(${detectedCorners.TR.x},${detectedCorners.TR.y},i=${detectedCorners.TR.intensity.toFixed(1)}) ` +
        `BL=(${detectedCorners.BL.x},${detectedCorners.BL.y},i=${detectedCorners.BL.intensity.toFixed(1)}) ` +
        `BR=(${detectedCorners.BR.x},${detectedCorners.BR.y},i=${detectedCorners.BR.intensity.toFixed(1)}) | ` +
        `AllFound=${allMarkersFound}`,
    );

    // 4. Bilinear Mapping (u,v) ke piksel
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

    const sampleBubble = (
      u: number,
      v: number,
      normRadius: number,
    ): { fillRatio: number; meanIntensity: number; darkPixels: number } => {
      const pt = getPoint(u, v);
      const cx = Math.round(pt.x);
      const cy = Math.round(pt.y);
      const r = Math.max(5, Math.round(normRadius * width));

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

    // 5. Kode Cabang (4 digit x 10 baris)
    // x=[12,17.5,23,28.5]mm, y=30+n*4.5mm, bubble 3.5mm -> normRadius=0.013
    const DIGIT_RADIUS = 0.013;
    const cabStartU = 12 / 148;
    const cabColSpacing = 5.5 / 148;
    const kodeStartV = 30 / 210;
    const kodeRowSpacing = 4.5 / 210;

    let extractedKodeCabang = '';
    for (let col = 0; col < 4; col++) {
      let bestScore = -Infinity;
      let bestDigit = col === 0 ? '1' : '0';
      for (let digit = 0; digit <= 9; digit++) {
        const u = cabStartU + col * cabColSpacing;
        const v = kodeStartV + digit * kodeRowSpacing;
        const { fillRatio, meanIntensity } = sampleBubble(u, v, DIGIT_RADIUS);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) { bestScore = darkScore; bestDigit = digit.toString(); }
      }
      extractedKodeCabang += bestDigit;
    }
    if (!extractedKodeCabang.startsWith('1')) {
      extractedKodeCabang = '1' + extractedKodeCabang.slice(1);
    }

    // 6. Kode Mapel (2 digit x 10 baris)
    // x=[40,45.5]mm, y sama dengan kode cabang
    const mapelStartU = 40 / 148;
    const mapelColSpacing = 5.5 / 148;

    let extractedKodeMapelNum = '';
    for (let col = 0; col < 2; col++) {
      let bestScore = -Infinity;
      let bestDigit = '0';
      for (let digit = 0; digit <= 9; digit++) {
        const u = mapelStartU + col * mapelColSpacing;
        const v = kodeStartV + digit * kodeRowSpacing;
        const { fillRatio, meanIntensity } = sampleBubble(u, v, DIGIT_RADIUS);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) { bestScore = darkScore; bestDigit = digit.toString(); }
      }
      extractedKodeMapelNum += bestDigit;
    }
    if (extractedKodeMapelNum === '00') extractedKodeMapelNum = '';

    // 7. Kelas (7-12, satu baris di y=32mm)
    // x=[64,70.5,77,83.5,90,96.5]mm, v=32/210
    const kelasOptions = ['7', '8', '9', '10', '11', '12'];
    const kelasUOptions = [64, 70.5, 77, 83.5, 90, 96.5].map((x) => x / 148);
    const kelasV = 32 / 210;

    let extractedKelas = hints?.kelas ?? '12';
    let maxKelasScore = -Infinity;
    for (let i = 0; i < kelasOptions.length; i++) {
      const { fillRatio, meanIntensity } = sampleBubble(kelasUOptions[i], kelasV, DIGIT_RADIUS);
      const score = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
      if (score > maxKelasScore && (fillRatio > 0.15 || score > 0.5)) {
        maxKelasScore = score;
        extractedKelas = kelasOptions[i];
      }
    }

    // 8. Semester (Ganjil/Genap di y=42mm)
    // Ganjil x=110mm, Genap x=126mm
    const semV = 42 / 210;
    const semGanjilU = 110 / 148;
    const semGenapU = 126 / 148;

    let extractedSemester = hints?.semester ?? 'GANJIL';
    const semGanjilResult = sampleBubble(semGanjilU, semV, DIGIT_RADIUS);
    const semGenapResult = sampleBubble(semGenapU, semV, DIGIT_RADIUS);
    const scoreGanjil = semGanjilResult.fillRatio * 3.0 + (avgPaperBrightness - semGanjilResult.meanIntensity) / 120;
    const scoreGenap = semGenapResult.fillRatio * 3.0 + (avgPaperBrightness - semGenapResult.meanIntensity) / 120;
    if (scoreGenap > scoreGanjil && (semGenapResult.fillRatio > 0.15 || scoreGenap > 0.5)) {
      extractedSemester = 'GENAP';
    } else if (semGanjilResult.fillRatio > 0.15 || scoreGanjil > 0.5) {
      extractedSemester = 'GANJIL';
    }

    const extractedMapel = hints?.mapel ?? '';

    // 10. NISN (10 digit x 10 baris)
    // x=11+col*14mm, y=90+n*4.5mm, bubble 3.5mm -> normRadius=0.013
    const nisnStartU = 11 / 148;
    const nisnColSpacing = 14 / 148;
    const nisnStartV = 90 / 210;
    const nisnRowSpacing = 4.5 / 210;

    let extractedNisn = '';
    for (let col = 0; col < 10; col++) {
      let bestScore = -Infinity;
      let bestDigit = (col % 10).toString();
      for (let digit = 0; digit <= 9; digit++) {
        const u = nisnStartU + col * nisnColSpacing;
        const v = nisnStartV + digit * nisnRowSpacing;
        const { fillRatio, meanIntensity } = sampleBubble(u, v, DIGIT_RADIUS);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) { bestScore = darkScore; bestDigit = digit.toString(); }
      }
      extractedNisn += bestDigit;
    }

    // 11. Jawaban PG (25/30/40/50 butir)
    // Left col A: x=24mm, Right col A: x=85mm, spacing=9mm
    // Row 1: y=141mm, spacing tergantung totalSoal
    const OPT_RADIUS = 0.015; // bubble 4.5mm -> r=2.25mm/148=0.015
    const leftA_U = 24 / 148;
    const rightA_U = 85 / 148;
    const optSpacingU = 9 / 148;
    const qStartV = 141 / 210;

    const qRowSpacingMap: Record<number, number> = {
      25: 4.0 / 210,
      30: 3.5 / 210,
      40: 2.8 / 210,
      50: 2.3 / 210,
    };
    const leftRowsMap: Record<number, number> = {
      25: 13,
      30: 15,
      40: 20,
      50: 25,
    };

    const qRowSpacing = qRowSpacingMap[TOTAL_SOAL] ?? (4.0 / 210);
    const LEFT_ROWS = leftRowsMap[TOTAL_SOAL] ?? 13;

    const options = ['A', 'B', 'C', 'D'];
    const jawaban: Record<string, string> = {};
    const ambiguities: number[] = [];
    let totalConfidenceSum = 0;
    const FILL_THRESHOLD = 0.18;

    for (let q = 1; q <= TOTAL_SOAL; q++) {
      const isLeftCol = q <= LEFT_ROWS;
      const rowIdx = isLeftCol ? q - 1 : q - LEFT_ROWS - 1;
      const startU = isLeftCol ? leftA_U : rightA_U;
      const v = qStartV + rowIdx * qRowSpacing;

      const scoredOptions: { opt: string; ratio: number; intensity: number; darkScore: number }[] = [];

      for (let oIdx = 0; oIdx < options.length; oIdx++) {
        const u = startU + oIdx * optSpacingU;
        const r1 = sampleBubble(u, v, OPT_RADIUS);
        const r2 = sampleBubble(u, v, OPT_RADIUS * 1.25);
        const { fillRatio, meanIntensity } = r1.fillRatio >= r2.fillRatio ? r1 : r2;
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        scoredOptions.push({ opt: options[oIdx], ratio: fillRatio, intensity: meanIntensity, darkScore });
      }

      scoredOptions.sort((a, b) => b.darkScore - a.darkScore);
      const top = scoredOptions[0];
      const runnerUp = scoredOptions[1];

      if (top.ratio >= FILL_THRESHOLD || top.darkScore >= 0.55) {
        jawaban[q.toString()] = top.opt;
        const margin = top.darkScore - runnerUp.darkScore;
        if (margin < 0.25 && runnerUp.ratio >= 0.20) {
          ambiguities.push(q);
          totalConfidenceSum += 0.7;
        } else {
          totalConfidenceSum += Math.min(1.0, 0.85 + Math.min(0.15, margin * 0.3));
        }
      } else {
        jawaban[q.toString()] = '';
        totalConfidenceSum += 0.9;
      }
    }

    const overallConfidence = Number((totalConfidenceSum / TOTAL_SOAL).toFixed(2));

    const detectedCount = Object.values(jawaban).filter(Boolean).length;
    this.logger.log(
      `OMR A5 Result: Kode=${extractedKodeCabang} MapelKode=${extractedKodeMapelNum || '-'} ` +
        `NISN=${extractedNisn} Kelas=${extractedKelas} Sem=${extractedSemester} ` +
        `Jawaban=${detectedCount}/${TOTAL_SOAL} Conf=${(overallConfidence * 100).toFixed(0)}%`,
    );
    this.logger.log(`OMR Jawaban: ${JSON.stringify(jawaban)}`);

    // 13. Hitung Skor
    let jumlahBenar = 0;
    let jumlahSalah = 0;
    let jumlahKosong = 0;
    let skor: number | undefined = undefined;

    if (hints?.answerKey && Object.keys(hints.answerKey).length > 0) {
      for (let q = 1; q <= TOTAL_SOAL; q++) {
        const studentAns = (jawaban[q.toString()] ?? '').toUpperCase().trim();
        const keyAns = (hints.answerKey[q.toString()] ?? '').toUpperCase().trim();
        if (!studentAns) {
          jumlahKosong++;
        } else if (keyAns && studentAns === keyAns) {
          jumlahBenar++;
        } else {
          jumlahSalah++;
        }
      }
      skor = Math.round((jumlahBenar / TOTAL_SOAL) * 100);
    }

    return {
      kodeCabang: extractedKodeCabang,
      kodeMapelNum: extractedKodeMapelNum,
      nisn: extractedNisn,
      kelas: extractedKelas,
      semester: extractedSemester,
      mapel: extractedMapel,
      jawaban,
      confidence: overallConfidence,
      ambiguities,
      totalSoal: TOTAL_SOAL,
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
