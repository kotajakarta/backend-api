import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { MinioService } from '../../../common/minio/minio.service.js';
import { LjkOmrService } from './ljk-omr.service.js';
import { ScanLjkDto } from './dto/scan-ljk.dto.js';
import { ConfirmLjkDto } from './dto/confirm-ljk.dto.js';
import { UpdateLjkDto } from './dto/update-ljk.dto.js';
import path from 'path';

@Injectable()
export class LjkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minioService: MinioService,
    @Inject(LjkOmrService) private readonly omrService: LjkOmrService,
  ) {}

  /**
   * Memproses unggahan file LJK, mengekstrak data OMR, dan mencocokkan dengan data master
   */
  async scanLjkFile(file: any, hints: ScanLjkDto, user: any) {
    if (!file || !file.buffer) {
      throw new BadRequestException('File gambar LJK wajib diunggah.');
    }

    // 1. Simpan file gambar ke MinIO / Storage
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    const filename = `ljk_${Date.now()}_${Math.round(Math.random() * 1e8)}${ext}`;
    const objectKey = `ljk/${filename}`;

    try {
      await this.minioService.uploadBuffer(objectKey, file.buffer, file.mimetype || 'image/jpeg');
    } catch (err) {
      console.warn('Gagal upload gambar LJK ke MinIO:', err);
    }
    const fileUrl = `/api/v1/formal/ljk/image/${filename}`;

    // 2. Cari Naskah Soal Resmi jika ada atau gunakan questionBankId spesifik
    let questionBank: any = null;
    let answerKey: Record<string, string> = {};

    let mapelHint = hints.mapel;
    if (!mapelHint && hints.mataPelajaranId) {
      const mp = await this.prisma.mataPelajaran.findUnique({
        where: { id: hints.mataPelajaranId },
        select: { name: true },
      });
      if (mp) mapelHint = mp.name;
    }

    let kelasHint = hints.kelas;
    if (!kelasHint && hints.kelasId) {
      const kl = await this.prisma.kelas.findUnique({
        where: { id: hints.kelasId },
        select: { name: true, tingkat: true },
      });
      if (kl) kelasHint = kl.tingkat ? `Kelas ${kl.tingkat}` : kl.name;
    }

    if (hints.questionBankId) {
      questionBank = await this.prisma.questionBank.findUnique({
        where: { id: hints.questionBankId },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            include: { options: true },
          },
        },
      });
    } else if (mapelHint && kelasHint) {
      // Cari soal ujian resmi (isOfficial = true)
      questionBank = await this.prisma.questionBank.findFirst({
        where: {
          subject: { contains: mapelHint, mode: 'insensitive' },
          gradeLevel: { contains: kelasHint, mode: 'insensitive' },
          ...(hints.semester ? { semester: hints.semester } : {}),
          ...(hints.tahunAjaran ? { academicYear: hints.tahunAjaran } : {}),
          isOfficial: true,
        },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            include: { options: true },
          },
        },
      });
    }

    if (questionBank && questionBank.questions) {
      questionBank.questions.forEach((q: any, idx: number) => {
        const qNum = (idx + 1).toString();
        // Cari kunci jawaban dari opsi isCorrect = true atau field answerKey
        const correctOpt = q.options?.find((o: any) => o.isCorrect);
        if (correctOpt) {
          answerKey[qNum] = correctOpt.label.toUpperCase();
        } else if (q.answerKey) {
          answerKey[qNum] = q.answerKey.toUpperCase();
        }
      });
    }

    // 3. Ekstraksi OMR menggunakan Sharp
    const omrResult = await this.omrService.processLjkImage(file.buffer, {
      mapel: questionBank?.subject || mapelHint,
      kelas: questionBank?.gradeLevel || kelasHint,
      semester: questionBank?.semester || hints.semester,
      questionBankId: questionBank?.id,
      answerKey: Object.keys(answerKey).length > 0 ? answerKey : undefined,
      totalSoal: (hints as any).totalSoal,
    });

    // 3.5. Auto-lookup Mata Pelajaran dari Kode Mapel yang terdeteksi OMR
    // Jika kodeMapelNum terdeteksi (mis. '02') DAN belum ada questionBank dari hints,
    // cari mataPelajaran dengan kodeMapel = kodeMapelNum, lalu cari questionBank-nya.
    if (omrResult.kodeMapelNum && !questionBank) {
      const detectedMapel = await this.prisma.mataPelajaran.findFirst({
        where: { kodeMapel: omrResult.kodeMapelNum },
        select: { id: true, name: true, kodeMapel: true },
      });

      if (detectedMapel) {
        omrResult.mapel = detectedMapel.name;
        // Cari questionBank resmi untuk mataPelajaran ini
        const autoBank = await this.prisma.questionBank.findFirst({
          where: {
            subject: { contains: detectedMapel.name, mode: 'insensitive' },
            ...(omrResult.kelas ? { gradeLevel: { contains: omrResult.kelas, mode: 'insensitive' } } : {}),
            ...(hints.semester ? { semester: hints.semester } : {}),
            ...(hints.tahunAjaran ? { academicYear: hints.tahunAjaran } : {}),
            isOfficial: true,
          },
          include: {
            questions: {
              orderBy: { orderIndex: 'asc' },
              include: { options: true },
            },
          },
        });
        if (autoBank) {
          questionBank = autoBank;
          // Bangun kunci jawaban dari questionBank yang ditemukan
          answerKey = {};
          const bankQuestions = (autoBank as any).questions ?? [];
          bankQuestions.forEach((q: any, idx: number) => {
            const qNum = (idx + 1).toString();
            const correctOpt = q.options?.find((o: any) => o.isCorrect);
            if (correctOpt) answerKey[qNum] = correctOpt.label.toUpperCase();
            else if (q.answerKey) answerKey[qNum] = q.answerKey.toUpperCase();
          });
          // Hitung ulang skor dengan kunci baru
          if (Object.keys(answerKey).length > 0) {
            let benar = 0, salah = 0, kosong = 0;
            const totalSoal = omrResult.totalSoal;
            for (let i = 1; i <= totalSoal; i++) {
              const siswa = (omrResult.jawaban[i.toString()] || '').toUpperCase().trim();
              const kunci = (answerKey[i.toString()] || '').toUpperCase().trim();
              if (!siswa) kosong++;
              else if (kunci && siswa === kunci) benar++;
              else salah++;
            }
            omrResult.jumlahBenar = benar;
            omrResult.jumlahSalah = salah;
            omrResult.jumlahKosong = kosong;
            omrResult.skor = Math.round((benar / totalSoal) * 100);
          }
        }
      }
    }

    // 4. Resolusi Cabang berdasarkan Kode Cabang
    let matchedCabang: any = null;
    if (omrResult.kodeCabang) {
      matchedCabang = await this.prisma.cabang.findFirst({
        where: {
          OR: [
            { kode: omrResult.kodeCabang },
            { name: { contains: omrResult.kodeCabang, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, kode: true },
      });
    }

    // 5. Resolusi Data Santri berdasarkan NISN
    let matchedStudent: any = null;
    if (omrResult.nisn) {
      matchedStudent = await this.prisma.student.findFirst({
        where: {
          OR: [
            { biodata: { nisn: omrResult.nisn } },
            { siswaFormal: { nisn: omrResult.nisn } },
          ],
        },
        include: {
          biodata: { select: { fullName: true, nisn: true } },
          cabang: { select: { id: true, name: true, kode: true } },
        },
      });
    }

    return {
      ...omrResult,
      fileUrl,
      cabang: matchedCabang,
      student: matchedStudent
        ? {
            id: matchedStudent.id,
            namaLengkap: matchedStudent.biodata?.fullName || 'Siswa Terdaftar',
            nisn: matchedStudent.biodata?.nisn || omrResult.nisn,
            cabangName: matchedStudent.cabang?.name,
          }
        : null,
      questionBank: questionBank
        ? {
            id: questionBank.id,
            title: questionBank.title,
            subject: questionBank.subject,
            gradeLevel: questionBank.gradeLevel,
            academicYear: questionBank.academicYear,
            semester: questionBank.semester,
            totalQuestions: questionBank.questions?.length || 25,
            isOfficial: questionBank.isOfficial,
            answerKey: Object.keys(answerKey).length > 0 ? answerKey : undefined,
          }
        : null,
      answerKey: Object.keys(answerKey).length > 0 ? answerKey : undefined,
    };
  }

  /**
   * Menyimpan hasil ekstraksi LJK yang sudah diverifikasi / diedit oleh user
   */
  async confirmLjkResult(dto: ConfirmLjkDto, user: any) {
    // 1. Validasi / Resolusi Cabang
    let cabangId = dto.cabangId;
    if (!cabangId && dto.kodeCabang) {
      const c = await this.prisma.cabang.findFirst({
        where: { kode: dto.kodeCabang },
        select: { id: true },
      });
      if (c) cabangId = c.id;
    }

    // 2. Validasi / Resolusi Siswa
    let studentId = dto.studentId;
    if (!studentId && dto.nisn) {
      const s = await this.prisma.student.findFirst({
        where: {
          OR: [
            { biodata: { nisn: dto.nisn } },
            { siswaFormal: { nisn: dto.nisn } },
          ],
        },
        select: { id: true },
      });
      if (s) studentId = s.id;
    }

    // Resolusi Mata Pelajaran ID & Kelas ID
    let mataPelajaranId = dto.mataPelajaranId;
    if (!mataPelajaranId && dto.mapel) {
      const mp = await this.prisma.mataPelajaran.findFirst({
        where: {
          OR: [
            { name: { contains: dto.mapel, mode: 'insensitive' } },
            { kodeMapel: { contains: dto.mapel, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (mp) mataPelajaranId = mp.id;
    }

    let kelasId = dto.kelasId;
    if (!kelasId && dto.kelas) {
      const kl = await this.prisma.kelas.findFirst({
        where: {
          name: { contains: dto.kelas, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (kl) kelasId = kl.id;
    }

    // 3. Hitung Ulang Skor jika ada questionBankId
    let jumlahBenar = dto.jumlahBenar;
    let jumlahSalah = dto.jumlahSalah;
    let jumlahKosong = dto.jumlahKosong;
    let skor = dto.skor;

    if (dto.questionBankId && (skor === undefined || skor === null)) {
      const qb = await this.prisma.questionBank.findUnique({
        where: { id: dto.questionBankId },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            include: { options: true },
          },
        },
      });

      if (qb && qb.questions.length > 0) {
        let benar = 0;
        let salah = 0;
        let kosong = 0;

        qb.questions.forEach((q, idx) => {
          const qNum = (idx + 1).toString();
          const studentAns = (dto.jawaban[qNum] || '').toUpperCase().trim();
          const correctOpt = q.options?.find((o) => o.isCorrect);
          const keyAns = (correctOpt?.label || q.answerKey || '').toUpperCase().trim();

          if (!studentAns) {
            kosong++;
          } else if (keyAns && studentAns === keyAns) {
            benar++;
          } else {
            salah++;
          }
        });

        jumlahBenar = benar;
        jumlahSalah = salah;
        jumlahKosong = kosong;
        // Formula: benar × 4 (25 soal × 4 = 100 poin maks)
        skor = benar * 4;
      }
    }

    // 4. Simpan ke database LjkResult
    const created = await this.prisma.ljkResult.create({
      data: {
        kodeCabang: dto.kodeCabang,
        cabangId,
        mapel: dto.mapel,
        mataPelajaranId,
        semester: dto.semester,
        kelas: dto.kelas,
        kelasId,
        nisn: dto.nisn,
        studentId,
        jawaban: dto.jawaban as any,
        totalSoal: dto.totalSoal || 25,
        jumlahBenar,
        jumlahSalah,
        jumlahKosong,
        skor,
        fileUrl: dto.fileUrl,
        confidence: dto.confidence,
        status: dto.status || 'VERIFIED',
        questionBankId: dto.questionBankId,
        createdById: user?.id,
      },
      include: {
        cabang: { select: { id: true, name: true, kode: true } },
        student: {
          include: {
            biodata: { select: { fullName: true, nisn: true } },
          },
        },
        questionBank: { select: { id: true, title: true, isOfficial: true } },
      },
    });

    // 5. Otomatis Sinkronisasi ke Nilai Formal e-Rapor Siswa
    let syncedToRapor = false;
    let syncedNilaiId: string | null = null;
    const shouldSync = dto.syncToNilaiRapor !== false;

    if (shouldSync && studentId && mataPelajaranId && kelasId && skor !== undefined && skor !== null) {
      try {
        const tahunAjaran = dto.tahunAjaran || '2024/2025';
        const semesterNorm = dto.semester?.toLowerCase().includes('genap') ? 'Genap' : 'Ganjil';

        let predikat = 'C+';
        if (skor >= 90) predikat = 'A';
        else if (skor >= 81) predikat = 'B+';
        else if (skor >= 76) predikat = 'B';

        // Pastikan RiwayatKelasFormal ada
        let riwayat = await this.prisma.riwayatKelasFormal.findUnique({
          where: {
            studentId_tahunAjaran_semester: {
              studentId,
              tahunAjaran,
              semester: semesterNorm,
            },
          },
        });

        if (!riwayat) {
          riwayat = await this.prisma.riwayatKelasFormal.create({
            data: {
              studentId,
              kelasId,
              tahunAjaran,
              semester: semesterNorm,
            },
          });
        }

        // Upsert NilaiFormal
        const updatedNilai = await this.prisma.nilaiFormal.upsert({
          where: {
            studentId_mataPelajaranId_tahunAjaran_semester: {
              studentId,
              mataPelajaranId,
              tahunAjaran,
              semester: semesterNorm,
            },
          },
          update: {
            kelasId,
            riwayatKelasId: riwayat.id,
            nilaiAkhir: skor,
            nilaiPas: skor,
            predikat,
          },
          create: {
            studentId,
            mataPelajaranId,
            kelasId,
            riwayatKelasId: riwayat.id,
            tahunAjaran,
            semester: semesterNorm,
            nilaiAkhir: skor,
            nilaiPas: skor,
            predikat,
          },
        });

        syncedToRapor = true;
        syncedNilaiId = updatedNilai.id;
      } catch (syncErr) {
        console.error('Gagal otomatis sinkronkan nilai LJK ke e-Rapor:', syncErr);
      }
    }

    return {
      success: true,
      message: syncedToRapor
        ? `Hasil pemeriksaan LJK disimpan dan otomatis disinkronkan ke Nilai e-Rapor (Skor: ${skor}).`
        : 'Hasil pemeriksaan LJK berhasil disimpan.',
      data: created,
      syncedToRapor,
      syncedNilaiId,
    };
  }

  /**
   * Menyimpan hasil koreksi LJK masal dari upload PDF multi-page
   */
  async confirmBulkLjkResults(items: ConfirmLjkDto[], user: any) {
    if (!items || items.length === 0) {
      throw new BadRequestException('Daftar lembar LJK masal tidak boleh kosong.');
    }

    const results: any[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (const item of items) {
      try {
        const res = await this.confirmLjkResult(item, user);
        results.push({
          nisn: item.nisn,
          success: true,
          data: res.data,
          syncedToRapor: res.syncedToRapor,
        });
        successCount++;
      } catch (err: any) {
        results.push({
          nisn: item.nisn,
          success: false,
          error: err.message || 'Gagal menyimpan lembar LJK',
        });
        failedCount++;
      }
    }

    return {
      success: failedCount === 0,
      message: `Berhasil memproses ${successCount} dari ${items.length} lembar LJK masal.${failedCount > 0 ? ` (${failedCount} gagal)` : ''}`,
      totalProcessed: items.length,
      successCount,
      failedCount,
      results,
    };
  }

  /**
   * Mengambil riwayat hasil koreksi LJK dengan filter & pagination
   */
  async getLjkResults(
    query: {
      kodeCabang?: string;
      mapel?: string;
      kelas?: string;
      semester?: string;
      nisn?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    user: any,
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.kodeCabang) {
      where.kodeCabang = query.kodeCabang;
    } else if (user?.scope === 'CABANG' && user.cabangId) {
      where.cabangId = user.cabangId;
    }

    if (query.mapel) where.mapel = { contains: query.mapel, mode: 'insensitive' };
    if (query.kelas) where.kelas = query.kelas;
    if (query.semester) where.semester = query.semester;
    if (query.nisn) where.nisn = { contains: query.nisn };

    if (query.search) {
      where.OR = [
        { nisn: { contains: query.search } },
        { kodeCabang: { contains: query.search } },
        { mapel: { contains: query.search, mode: 'insensitive' } },
        { student: { biodata: { fullName: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.ljkResult.count({ where }),
      this.prisma.ljkResult.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          cabang: { select: { id: true, name: true, kode: true } },
          student: {
            include: {
              biodata: { select: { fullName: true, nisn: true } },
            },
          },
          questionBank: { select: { id: true, title: true, isOfficial: true } },
        },
      }),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Mengupdate data koreksi LJK jika ada perbaikan manual
   */
  async updateLjkResult(id: string, dto: UpdateLjkDto, user: any) {
    const existing = await this.prisma.ljkResult.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Data LJK tidak ditemukan.');

    const updateData: any = { ...dto };

    // Hitung ulang jika jawaban diubah
    if (dto.jawaban && (dto.questionBankId || existing.questionBankId)) {
      const qbId = dto.questionBankId || existing.questionBankId;
      const qb = await this.prisma.questionBank.findUnique({
        where: { id: qbId! },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            include: { options: true },
          },
        },
      });

      if (qb && qb.questions.length > 0) {
        let benar = 0;
        let salah = 0;
        let kosong = 0;

        qb.questions.forEach((q, idx) => {
          const qNum = (idx + 1).toString();
          const studentAns = (dto.jawaban![qNum] || '').toUpperCase().trim();
          const correctOpt = q.options?.find((o) => o.isCorrect);
          const keyAns = (correctOpt?.label || q.answerKey || '').toUpperCase().trim();

          if (!studentAns) {
            kosong++;
          } else if (keyAns && studentAns === keyAns) {
            benar++;
          } else {
            salah++;
          }
        });

        updateData.jumlahBenar = benar;
        updateData.jumlahSalah = salah;
        updateData.jumlahKosong = kosong;
        updateData.skor = Number(((benar / 25) * 100).toFixed(1));
      }
    }

    const updated = await this.prisma.ljkResult.update({
      where: { id },
      data: updateData,
      include: {
        cabang: { select: { id: true, name: true, kode: true } },
        student: {
          include: {
            biodata: { select: { fullName: true, nisn: true } },
          },
        },
        questionBank: { select: { id: true, title: true } },
      },
    });

    return {
      success: true,
      message: 'Hasil pemeriksaan LJK berhasil diperbarui.',
      data: updated,
    };
  }

  /**
   * Menghapus data koreksi LJK
   */
  async deleteLjkResult(id: string, user: any) {
    const existing = await this.prisma.ljkResult.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Data LJK tidak ditemukan.');

    await this.prisma.ljkResult.delete({ where: { id } });
    return { success: true, message: 'Data LJK berhasil dihapus.' };
  }
}
