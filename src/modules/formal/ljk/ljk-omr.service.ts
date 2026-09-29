import { Injectable, Logger } from '@nestjs/common';
import { Worker } from 'node:worker_threads';

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

type LjkOmrHints = {
  mapel?: string;
  kelas?: string;
  semester?: string;
  questionBankId?: string;
  answerKey?: Record<string, string>;
  totalSoal?: 25 | 30 | 40 | 50;
};

type WorkerResponse =
  | { ok: true; result: OmrExtractionResult }
  | { ok: false; error: string };

@Injectable()
export class LjkOmrService {
  private readonly logger = new Logger(LjkOmrService.name);

  /**
   * Memproses buffer gambar LJK A5 menggunakan Sharp untuk Optical Mark Recognition.
   *
   * Perhitungan piksel-per-piksel (deteksi corner marker + sampling ratusan bubble)
   * bersifat CPU-bound dan sepenuhnya sinkron, sehingga dijalankan di worker thread
   * terpisah (lihat ljk-omr.worker.ts) agar tidak memblokir event loop utama —
   * request lain (termasuk health check) tetap responsif selama scan berlangsung.
   */
  async processLjkImage(buffer: Buffer, hints?: LjkOmrHints): Promise<OmrExtractionResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./ljk-omr.worker.js', import.meta.url), {
        workerData: { buffer, hints },
      });

      let settled = false;

      worker.once('message', (msg: WorkerResponse) => {
        settled = true;
        worker.terminate();
        if (msg.ok) {
          resolve(msg.result);
        } else {
          this.logger.error(`LJK OMR worker error: ${msg.error}`);
          reject(new Error(msg.error));
        }
      });

      worker.once('error', (err) => {
        if (settled) return;
        settled = true;
        this.logger.error(`LJK OMR worker crashed: ${err.message}`, err.stack);
        reject(err);
      });

      worker.once('exit', (code) => {
        if (settled) return;
        if (code !== 0) {
          settled = true;
          reject(new Error(`LJK OMR worker berhenti tak terduga dengan exit code ${code}`));
        }
      });
    });
  }
}
