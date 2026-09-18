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

    // 3. Deteksi Corner Markers (7x5mm, center di (9mm, 15mm) dan (139.5mm, 185mm))
    const zones = {
      TL: { x0: 0.000, x1: 0.160, y0: 0.020, y1: 0.160 },
      TR: { x0: 0.840, x1: 1.000, y0: 0.020, y1: 0.160 },
      BL: { x0: 0.000, x1: 0.160, y0: 0.780, y1: 0.980 },
      BR: { x0: 0.840, x1: 1.000, y0: 0.780, y1: 0.980 },
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

      for (let y = y0 + win; y <= y1 - win; y += 4) {
        for (let x = x0 + win; x <= x1 - win; x += 4) {
          let sum = 0;
          let count = 0;
          for (let dy = -win; dy <= win; dy += 4) {
            for (let dx = -win; dx <= win; dx += 4) {
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

    // Fine-tune deteksi marker sudut di area lokal (+/- 4px)
    for (const [name, corner] of Object.entries(detectedCorners)) {
      if (!corner.found) continue;
      let minVal = corner.intensity;
      let bestX = corner.x;
      let bestY = corner.y;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = corner.x + dx;
          const y = corner.y + dy;
          let sum = 0;
          let count = 0;
          for (let wy = -win; wy <= win; wy += 3) {
            for (let wx = -win; wx <= win; wx += 3) {
              sum += rawPixels[(y + wy) * width + (x + wx)];
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
      detectedCorners[name].x = bestX;
      detectedCorners[name].y = bestY;
    }

    // Parallelogram extrapolation jika 3 dari 4 marker ditemukan
    const foundCount = Object.values(detectedCorners).filter((c) => c.found).length;
    if (foundCount === 3) {
      if (!detectedCorners.TL.found) {
        detectedCorners.TL.x = detectedCorners.TR.x + detectedCorners.BL.x - detectedCorners.BR.x;
        detectedCorners.TL.y = detectedCorners.TR.y + detectedCorners.BL.y - detectedCorners.BR.y;
        detectedCorners.TL.found = true;
      } else if (!detectedCorners.TR.found) {
        detectedCorners.TR.x = detectedCorners.TL.x + detectedCorners.BR.x - detectedCorners.BL.x;
        detectedCorners.TR.y = detectedCorners.TL.y + detectedCorners.BR.y - detectedCorners.BL.y;
        detectedCorners.TR.found = true;
      } else if (!detectedCorners.BL.found) {
        detectedCorners.BL.x = detectedCorners.TL.x + detectedCorners.BR.x - detectedCorners.TR.x;
        detectedCorners.BL.y = detectedCorners.TL.y + detectedCorners.BR.y - detectedCorners.TR.y;
        detectedCorners.BL.found = true;
      } else if (!detectedCorners.BR.found) {
        detectedCorners.BR.x = detectedCorners.TR.x + detectedCorners.BL.x - detectedCorners.TL.x;
        detectedCorners.BR.y = detectedCorners.TR.y + detectedCorners.BL.y - detectedCorners.TL.y;
        detectedCorners.BR.found = true;
      }
    }

    const allMarkersFound =
      detectedCorners.TL.found &&
      detectedCorners.TR.found &&
      detectedCorners.BL.found &&
      detectedCorners.BR.found;

    this.logger.log(
      `OMR A5 Corners: ` +
        `TL=(${detectedCorners.TL.x},${detectedCorners.TL.y}) ` +
        `TR=(${detectedCorners.TR.x},${detectedCorners.TR.y}) ` +
        `BL=(${detectedCorners.BL.x},${detectedCorners.BL.y}) ` +
        `BR=(${detectedCorners.BR.x},${detectedCorners.BR.y}) | ` +
        `AllFound=${allMarkersFound}`,
    );

    // 4. Bilinear Mapping dari milimeter template (mmX, mmY) ke piksel
    // Posisi sudut marker A5 (148.5 x 210 mm):
    // TL=(9.0mm, 15.0mm), TR=(139.5mm, 15.0mm), BL=(9.0mm, 185.0mm), BR=(139.5mm, 185.0mm)
    const MARKER_TL_X = 9.0;
    const MARKER_TL_Y = 15.0;
    const MARKER_DX = 130.5; // 139.5 - 9.0
    const MARKER_DY = 170.0; // 185.0 - 15.0

    const getPointFromMm = (mmX: number, mmY: number): { x: number; y: number } => {
      if (allMarkersFound) {
        const tl = detectedCorners.TL;
        const tr = detectedCorners.TR;
        const bl = detectedCorners.BL;
        const br = detectedCorners.BR;
        const relU = (mmX - MARKER_TL_X) / MARKER_DX;
        const relV = (mmY - MARKER_TL_Y) / MARKER_DY;
        const x = (1 - relU) * (1 - relV) * tl.x + relU * (1 - relV) * tr.x + (1 - relU) * relV * bl.x + relU * relV * br.x;
        const y = (1 - relU) * (1 - relV) * tl.y + relU * (1 - relV) * tr.y + (1 - relU) * relV * bl.y + relU * relV * br.y;
        return { x, y };
      }
      return { x: (mmX / 148.5) * width, y: (mmY / 210.0) * height };
    };

    const sampleBubbleMm = (
      mmX: number,
      mmY: number,
      radiusMm: number = 1.6,
    ): { fillRatio: number; meanIntensity: number; darkPixels: number } => {
      const pt = getPointFromMm(mmX, mmY);
      const cx = Math.round(pt.x);
      const cy = Math.round(pt.y);
      const r = Math.max(5, Math.round((radiusMm / 148.5) * width));

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
    // x=[17.0, 22.2, 27.4, 32.6]mm, cy=33.5 + d*3.8mm
    let extractedKodeCabang = '';
    for (let col = 0; col < 4; col++) {
      const mmX = 17.0 + col * 5.2;
      let bestScore = -Infinity;
      let bestDigit = col === 0 ? '1' : '0';
      for (let digit = 0; digit <= 9; digit++) {
        const mmY = 33.5 + digit * 3.8;
        const { fillRatio, meanIntensity } = sampleBubbleMm(mmX, mmY);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) {
          bestScore = darkScore;
          bestDigit = digit.toString();
        }
      }
      extractedKodeCabang += bestDigit;
    }
    if (!extractedKodeCabang.startsWith('1')) {
      extractedKodeCabang = '1' + extractedKodeCabang.slice(1);
    }

    // 6. Kode Mapel (2 digit x 10 baris)
    // x=[40.6, 45.8]mm, cy=33.5 + d*3.8mm
    let extractedKodeMapelNum = '';
    for (let col = 0; col < 2; col++) {
      const mmX = 40.6 + col * 5.2;
      let bestScore = -Infinity;
      let bestDigit = '0';
      for (let digit = 0; digit <= 9; digit++) {
        const mmY = 33.5 + digit * 3.8;
        const { fillRatio, meanIntensity } = sampleBubbleMm(mmX, mmY);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) {
          bestScore = darkScore;
          bestDigit = digit.toString();
        }
      }
      extractedKodeMapelNum += bestDigit;
    }
    if (extractedKodeMapelNum === '00') extractedKodeMapelNum = '';

    // 7. NISN (10 digit x 10 baris)
    // x=54.8 + col*5.2mm, cy=33.5 + d*3.8mm
    let extractedNisn = '';
    for (let col = 0; col < 10; col++) {
      const mmX = 54.8 + col * 5.2;
      let bestScore = -Infinity;
      let bestDigit = (col % 10).toString();
      for (let digit = 0; digit <= 9; digit++) {
        const mmY = 33.5 + digit * 3.8;
        const { fillRatio, meanIntensity } = sampleBubbleMm(mmX, mmY);
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        if (darkScore > bestScore) {
          bestScore = darkScore;
          bestDigit = digit.toString();
        }
      }
      extractedNisn += bestDigit;
    }

    // 8. Kelas (7-12, 1 kolom vertikal di x=111.55mm, cy=33.5 + idx*3.8mm)
    const kelasOptions = ['7', '8', '9', '10', '11', '12'];
    const kelasMmX = 111.55;
    let extractedKelas = hints?.kelas ?? '10';
    let maxKelasScore = -Infinity;
    for (let i = 0; i < kelasOptions.length; i++) {
      const mmY = 33.5 + i * 3.8;
      const { fillRatio, meanIntensity } = sampleBubbleMm(kelasMmX, mmY);
      const score = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
      if (score > maxKelasScore && (fillRatio > 0.15 || score > 0.5)) {
        maxKelasScore = score;
        extractedKelas = kelasOptions[i];
      }
    }

    // 9. Semester (1 kolom vertikal di x=121.8mm, Ganjil di cy=33.5mm, Genap di cy=37.3mm)
    const semMmX = 121.8;
    let extractedSemester = hints?.semester ?? 'GANJIL';
    const semGanjilResult = sampleBubbleMm(semMmX, 33.5);
    const semGenapResult = sampleBubbleMm(semMmX, 37.3);
    const scoreGanjil = semGanjilResult.fillRatio * 3.0 + (avgPaperBrightness - semGanjilResult.meanIntensity) / 120;
    const scoreGenap = semGenapResult.fillRatio * 3.0 + (avgPaperBrightness - semGenapResult.meanIntensity) / 120;
    if (scoreGenap > scoreGanjil && (semGenapResult.fillRatio > 0.15 || scoreGenap > 0.5)) {
      extractedSemester = 'GENAP';
    } else if (semGanjilResult.fillRatio > 0.15 || scoreGanjil > 0.5) {
      extractedSemester = 'GANJIL';
    }

    const extractedMapel = hints?.mapel ?? '';

    // 10. Jawaban PG (3 Kolom: Col 1 = Q1-10, Col 2 = Q11-20, Col 3 = Q21-30)
    // Col 1 start A: 31.0mm, Col 2 start A: 70.5mm, Col 3 start A: 110.0mm
    // Option horizontal spacing = 5.5mm
    // Row 1 cy = 87.5mm, rowSpacing = 4.4mm
    const colStartsMm = [31.0, 70.5, 110.0];
    const optSpacingMm = 5.5;
    const qStartMm = 87.5;
    const qRowSpacingMm = 4.4;

    const options = ['A', 'B', 'C', 'D'];
    const jawaban: Record<string, string> = {};
    const ambiguities: number[] = [];
    let totalConfidenceSum = 0;

    for (let q = 1; q <= TOTAL_SOAL; q++) {
      const colIdx = Math.min(2, Math.floor((q - 1) / 10));
      const rowIdx = (q - 1) % 10;
      const startX = colStartsMm[colIdx];
      const cy = qStartMm + rowIdx * qRowSpacingMm;

      const scoredOptions: { opt: string; ratio: number; intensity: number; darkScore: number }[] = [];

      for (let oIdx = 0; oIdx < options.length; oIdx++) {
        const cx = startX + oIdx * optSpacingMm;
        const r1 = sampleBubbleMm(cx, cy, 1.6);
        const r2 = sampleBubbleMm(cx, cy, 2.0);
        const { fillRatio, meanIntensity } = r1.fillRatio >= r2.fillRatio ? r1 : r2;
        const darkScore = fillRatio * 3.0 + (avgPaperBrightness - meanIntensity) / 120;
        scoredOptions.push({ opt: options[oIdx], ratio: fillRatio, intensity: meanIntensity, darkScore });
      }

      scoredOptions.sort((a, b) => b.darkScore - a.darkScore);
      const top = scoredOptions[0];
      const runnerUp = scoredOptions[1];
      const margin = top.darkScore - runnerUp.darkScore;

      // Ambang batas: bubble yang dihitamkan pensil/pulpen memiliki fillRatio >= 0.58 dan darkScore >= 1.8,
      // dengan margin yang jelas terhadap pilihan lain
      const isFilled = (top.ratio >= 0.58 && top.darkScore >= 1.8) || (top.darkScore >= 2.0 && margin >= 0.35);

      if (isFilled) {
        jawaban[q.toString()] = top.opt;
        if (margin < 0.35 && runnerUp.ratio >= 0.50) {
          ambiguities.push(q);
          totalConfidenceSum += 0.7;
        } else {
          totalConfidenceSum += Math.min(1.0, 0.85 + Math.min(0.15, margin * 0.2));
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
