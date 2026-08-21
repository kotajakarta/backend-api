import { Injectable, Inject, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { FormalService } from '../formal/formal.service.js';
import { AuthService } from '../auth/auth.service.js';
import { CreatePermohonanIzinDto } from './dto/create-permohonan-izin.dto.js';
import { encryptStreamUrl, decryptStreamUrl, decryptStoredStreamUrl } from '../../common/utils/cctv-crypto.js';

@Injectable()
export class PortalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FormalService) private readonly formalService: FormalService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  // Shared include shape for a wali-facing student profile: biodata, cabang/wilayah,
  // formal-track class placement, and daimi group placement.
  private readonly studentInclude = {
    biodata: true,
    cabang: true,
    wilayah: true,
    siswaFormal: { include: { kelas: true } },
    dataDaimi: {
      include: {
        grup: {
          include: {
            ketua: true
          }
        },
        kelas: true
      }
    }
  };

  // Ownership gate — every wali-facing method that touches a specific studentId must
  // call this FIRST, before doing anything else. Not covered by the guard (which only
  // checks scope, not per-resource ownership).
  async assertOwnsStudent(userId: string, studentId: string): Promise<void> {
    const link = await this.prisma.waliSantri.findUnique({
      where: { userId_studentId: { userId, studentId } }
    });
    if (!link) throw new ForbiddenException('Anda tidak memiliki akses ke data santri ini');
  }

  // --- WALI-FACING ---

  async getStudents(userId: string) {
    return this.prisma.waliSantri.findMany({
      where: { userId },
      include: { student: { include: this.studentInclude } }
    });
  }

  async getStudentById(userId: string, studentId: string) {
    await this.assertOwnsStudent(userId, studentId);
    return this.prisma.student.findUnique({
      where: { id: studentId },
      include: this.studentInclude
    });
  }

  async getRiwayatKelas(userId: string, studentId: string) {
    await this.assertOwnsStudent(userId, studentId);
    // FormalService.getRiwayatKelasByStudent does its own internal scope filtering via
    // checkStudentScope(studentId, user) for staff callers. We've already asserted WALI
    // ownership above, so we pass a synthesized GLOBAL user to bypass that internal
    // check (checkStudentScope short-circuits/returns immediately for GLOBAL scope).
    return this.formalService.getRiwayatKelasByStudent(studentId, { scope: 'GLOBAL' });
  }

  async getRaporRiwayat(userId: string, studentId: string) {
    await this.assertOwnsStudent(userId, studentId);
    return this.formalService.getNilaiHistoryByStudent(studentId, { scope: 'GLOBAL' });
  }

  async getRaporCetak(userId: string, studentId: string, tahunAjaran: string, semester: string) {
    await this.assertOwnsStudent(userId, studentId);
    // getERaporCetak takes no user param at all (no internal scope filtering) — call directly.
    return this.formalService.getERaporCetak(studentId, tahunAjaran, semester);
  }

  async getHafalan(userId: string, studentId: string, tahunAjaran: string, semester: string) {
    await this.assertOwnsStudent(userId, studentId);
    // getHafalanByStudent also takes no user param — call directly.
    return this.formalService.getHafalanByStudent(studentId, tahunAjaran, semester);
  }

  async getKehadiran(userId: string, studentId: string, startDate?: string, endDate?: string) {
    await this.assertOwnsStudent(userId, studentId);

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(`${endDate}T23:59:59`);

    const records = await this.prisma.kehadiran.findMany({
      where: {
        studentId,
        ...(Object.keys(dateFilter).length > 0 ? { program: { date: dateFilter } } : {})
      },
      include: { program: true },
      orderBy: { program: { date: 'desc' } }
    });

    const tally = { hadir: 0, sakit: 0, izin: 0, alpa: 0 };
    for (const record of records) {
      if (record.status === 'HADIR') tally.hadir++;
      else if (record.status === 'SAKIT') tally.sakit++;
      else if (record.status === 'IZIN') tally.izin++;
      else if (record.status === 'ALPA') tally.alpa++;
    }

    // Absensi Kontrol Silabus / Mata Pelajaran
    const mapelDateFilter: any = {};
    if (startDate) mapelDateFilter.gte = new Date(startDate);
    if (endDate) mapelDateFilter.lte = new Date(`${endDate}T23:59:59`);

    const mapelRecords = await this.prisma.absensiMapel.findMany({
      where: {
        studentId,
        ...(Object.keys(mapelDateFilter).length > 0 ? { tanggal: mapelDateFilter } : {})
      },
      include: {
        mataPelajaran: { select: { id: true, name: true, kodeMapel: true } },
        silabus: { select: { id: true, bab: true, section: true, tingkat: true, semester: true, tahunAjaran: true } },
        kelas: { select: { id: true, name: true } }
      },
      orderBy: { tanggal: 'desc' }
    });

    const mapelTally = { hadir: 0, sakit: 0, izin: 0, alpa: 0 };
    for (const record of mapelRecords) {
      if (record.status === 'HADIR') mapelTally.hadir++;
      else if (record.status === 'SAKIT') mapelTally.sakit++;
      else if (record.status === 'IZIN') mapelTally.izin++;
      else if (record.status === 'ALPA') mapelTally.alpa++;
    }

    return {
      records,
      tally,
      harian: { records, tally },
      silabus: { records: mapelRecords, tally: mapelTally }
    };
  }

  async getPembelajaranSilabus(userId: string, studentId: string) {
    await this.assertOwnsStudent(userId, studentId);

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        siswaFormal: { include: { kelas: true } }
      }
    });

    if (!student) {
      throw new NotFoundException('Data santri tidak ditemukan');
    }

    const kelasId = student.siswaFormal?.kelasId;

    // Log absensi santri pada mapel silabus
    const absensiRecords = await this.prisma.absensiMapel.findMany({
      where: { studentId },
      include: {
        mataPelajaran: { select: { id: true, name: true, kodeMapel: true } },
        silabus: { select: { id: true, bab: true, section: true, tingkat: true, semester: true, tahunAjaran: true } },
        kelas: { select: { id: true, name: true } }
      },
      orderBy: { tanggal: 'desc' }
    });

    // Pelaksanaan silabus di kelas santri
    let pelaksanaanRecords: any[] = [];
    if (kelasId) {
      pelaksanaanRecords = await this.prisma.pelaksanaanSilabus.findMany({
        where: {
          kelasId,
          status: 'COMPLETED',
          tanggalDiajar: { not: null }
        },
        include: {
          mataPelajaran: { select: { id: true, name: true, kodeMapel: true } },
          silabus: { select: { id: true, bab: true, section: true, tingkat: true, semester: true, tahunAjaran: true } },
          guru: { select: { id: true, name: true } },
          kelas: { select: { id: true, name: true } }
        },
        orderBy: { tanggalDiajar: 'desc' },
        take: 50
      });
    }

    const absensiMap = new Map<string, any>();
    absensiRecords.forEach((a) => {
      const key = `${a.mataPelajaranId}_${a.silabusId}_${new Date(a.tanggal).toISOString().split('T')[0]}`;
      absensiMap.set(key, a);
    });

    const combined = pelaksanaanRecords.map((p) => {
      const dateStr = p.tanggalDiajar ? new Date(p.tanggalDiajar).toISOString().split('T')[0] : '';
      const key = `${p.mataPelajaranId}_${p.silabusId}_${dateStr}`;
      const abs = absensiMap.get(key);

      const statusKehadiran = abs ? abs.status : 'HADIR';
      const catatan = abs?.catatan || p.catatan || null;

      return {
        id: p.id,
        tanggal: p.tanggalDiajar,
        mataPelajaran: p.mataPelajaran,
        silabus: p.silabus,
        guru: p.guru,
        kelas: p.kelas,
        statusKehadiran,
        isMengikuti: statusKehadiran === 'HADIR',
        keterangan: statusKehadiran === 'HADIR' ? 'Hadir Mengikuti' : (statusKehadiran === 'SAKIT' ? 'Sakit' : statusKehadiran === 'IZIN' ? 'Izin' : 'Tidak Hadir (Alpa)'),
        catatan
      };
    });

    if (combined.length === 0 && absensiRecords.length > 0) {
      return absensiRecords.map((a) => ({
        id: a.id,
        tanggal: a.tanggal,
        mataPelajaran: a.mataPelajaran,
        silabus: a.silabus,
        guru: null,
        kelas: a.kelas,
        statusKehadiran: a.status,
        isMengikuti: a.status === 'HADIR',
        keterangan: a.status === 'HADIR' ? 'Hadir Mengikuti' : (a.status === 'SAKIT' ? 'Sakit' : a.status === 'IZIN' ? 'Izin' : 'Tidak Hadir (Alpa)'),
        catatan: a.catatan
      }));
    }

    return combined;
  }

  async getPengumuman(userId?: string, studentId?: string) {
    let cabangId: string | undefined;

    if (userId && studentId) {
      const link = await this.prisma.waliSantri.findUnique({
        where: { userId_studentId: { userId, studentId } },
        include: { student: true }
      });
      if (link && link.student.cabangId) {
        cabangId = link.student.cabangId;
      }
    } else if (userId) {
      const link = await this.prisma.waliSantri.findFirst({
        where: { userId },
        include: { student: true }
      });
      if (link && link.student.cabangId) {
        cabangId = link.student.cabangId;
      }
    }

    const where: any = {
      isActive: true,
      OR: [
        { scope: 'GLOBAL' },
        ...(cabangId ? [{ scope: 'CABANG', cabangId }] : [])
      ]
    };

    return this.prisma.pengumumanWalsan.findMany({
      where,
      include: {
        cabang: { select: { id: true, name: true } },
        createdBy: { select: { id: true, operatorName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getPermohonanIzinList(userId: string, studentId?: string) {
    return this.prisma.permohonanIzinSantri.findMany({
      where: {
        createdById: userId,
        ...(studentId ? { studentId } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createPermohonanIzin(userId: string, dto: CreatePermohonanIzinDto) {
    await this.assertOwnsStudent(userId, dto.studentId);

    const tanggalMulai = new Date(dto.tanggalMulai);
    const tanggalSelesai = new Date(dto.tanggalSelesai);
    if (tanggalSelesai < tanggalMulai) {
      throw new BadRequestException('Tanggal selesai tidak boleh sebelum tanggal mulai');
    }

    return this.prisma.permohonanIzinSantri.create({
      data: {
        studentId: dto.studentId,
        createdById: userId,
        jenisIzin: dto.jenisIzin,
        keterangan: dto.keterangan,
        tanggalMulai,
        tanggalSelesai,
        status: 'PENDING'
      }
    });
  }

  async getPermohonanIzinById(userId: string, id: string) {
    const record = await this.prisma.permohonanIzinSantri.findUnique({ where: { id } });
    // Not found and not-owned are reported identically to avoid leaking whether a
    // given id exists to a wali who doesn't own it.
    if (!record || record.createdById !== userId) {
      throw new NotFoundException('Permohonan izin tidak ditemukan');
    }
    return record;
  }

  async updateProfile(userId: string, data: any) {
    // isGlobalAdmin is always false here — wali accounts are never GLOBAL scope, and
    // AuthService.updateProfile uses this flag to gate username changes.
    return this.authService.updateProfile(userId, data, false);
  }

  // --- STAFF-FACING ---

  // Pattern-A scope filter on the student's cabang/wilayah, following the same style
  // as FormalService.getKelas/getPermohonanKelas. PermohonanIzinSantri has no cabangId/
  // wilayahId of its own, so the filter goes through the `student` relation.
  async listPermohonanIzinStaff(user: any) {
    let where: any = {};
    if (user.scope === 'CABANG') {
      where = { student: { cabangId: user.cabangId } };
    } else if (user.scope === 'WILAYAH') {
      where = { student: { wilayahId: user.wilayahId } };
    }
    return this.prisma.permohonanIzinSantri.findMany({
      where,
      include: {
        student: { include: { biodata: true } },
        createdBy: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async approvePermohonanIzin(id: string, user: any, catatanAdmin?: string) {
    const record = await this.prisma.permohonanIzinSantri.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Permohonan izin tidak ditemukan');
    if (record.status !== 'PENDING') throw new BadRequestException('Permohonan ini sudah diproses.');
    // Reuse FormalService's own scope check as the ownership assertion for staff callers.
    await this.formalService.checkStudentScope(record.studentId, user);

    return this.prisma.permohonanIzinSantri.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: user.id,
        catatanAdmin: catatanAdmin || null
      }
    });
  }

  async rejectPermohonanIzin(id: string, user: any, catatanAdmin: string) {
    const record = await this.prisma.permohonanIzinSantri.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Permohonan izin tidak ditemukan');
    if (record.status !== 'PENDING') throw new BadRequestException('Permohonan ini sudah diproses.');
    await this.formalService.checkStudentScope(record.studentId, user);

    return this.prisma.permohonanIzinSantri.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: user.id,
        catatanAdmin
      }
    });
  }

  async getCctvChannelsForWali(userId: string, studentId?: string) {
    let cabangId: string | undefined;
    if (studentId) {
      await this.assertOwnsStudent(userId, studentId);
      const student = await this.prisma.student.findUnique({ where: { id: studentId } });
      cabangId = student?.cabangId || undefined;
    } else {
      const link = await this.prisma.waliSantri.findFirst({
        where: { userId },
        include: { student: true }
      });
      cabangId = link?.student?.cabangId || undefined;
    }

    const channels = await this.prisma.cctvChannel.findMany({
      where: {
        ...(cabangId ? { cabangId } : {}),
        isActive: true
      },
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });

    return channels.map((c: any) => {
      let raw = decryptStoredStreamUrl(c.streamUrl);
      if (!raw || (!raw.startsWith('http://') && !raw.startsWith('https://'))) {
        raw = 'https://its.binamarga.pu.go.id:8989/play/hls/CT-02/index.m3u8';
      }
      const encrypted = encryptStreamUrl(raw);
      return {
        ...c,
        streamUrl: `/api/v1/cctv/stream-proxy/playlist?token=${encodeURIComponent(encrypted)}`,
      };
    });
  }

  // --- EDIT BIODATA SISWA OLEH WALI SANTRI ---

  async updateStudentBiodata(userId: string, studentId: string, data: any) {
    await this.assertOwnsStudent(userId, studentId);

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { biodata: true }
    });

    if (!student || !student.biodataId) {
      throw new NotFoundException('Data santri atau biodata tidak ditemukan');
    }

    // Mapping compatibility (e.g. aktaUrl -> akteUrl)
    if (data.aktaUrl !== undefined && data.akteUrl === undefined) {
      data.akteUrl = data.aktaUrl;
    }

    // Allowed editable fields matching Prisma schema `Biodata`
    const allowedFields = [
      'fullName', 'nik', 'noKk', 'nisn', 'nisLokal', 'noGlodemy',
      'tempatLahir', 'tanggalLahir', 'jenisKelamin', 'kewarganegaraan',
      'anakKe', 'jumlahSaudara',
      'namaAyah', 'statusHidupAyah', 'nikAyah', 'tempatLahirAyah', 'tanggalLahirAyah', 'pekerjaanAyah', 'pendidikanAyah', 'penghasilanAyah',
      'namaIbu', 'statusHidupIbu', 'nikIbu', 'tempatLahirIbu', 'tanggalLahirIbu', 'pekerjaanIbu', 'pendidikanIbu', 'penghasilanIbu',
      'address', 'phone', 'kontakDaruratNama', 'kontakDaruratTelp', 'kontakDaruratHubungan',
      'alamatJalan', 'alamatProvId', 'alamatProvName', 'alamatKabId', 'alamatKabName', 'alamatKecId', 'alamatKecName', 'alamatKelId', 'alamatKelName',
      'fotoUrl', 'ijazahUrl', 'kkUrl', 'akteUrl', 'suratMutasiUrl', 'raporUrl', 'skhunUrl', 'suratKesehatanUrl', 'suratDomisiliUrl', 'dokumenLainUrl'
    ];

    const updateData: any = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        if (['tanggalLahir', 'tanggalLahirAyah', 'tanggalLahirIbu'].includes(key)) {
          updateData[key] = (data[key] && !isNaN(new Date(data[key]).getTime())) ? new Date(data[key]) : null;
        } else if (['anakKe', 'jumlahSaudara'].includes(key)) {
          updateData[key] = (data[key] !== null && data[key] !== '' && !isNaN(Number(data[key]))) ? Number(data[key]) : null;
        } else if (key === 'fullName') {
          if (data[key] && String(data[key]).trim() !== '') {
            updateData[key] = String(data[key]).trim();
          }
        } else {
          updateData[key] = data[key] === '' ? null : data[key];
        }
      }
    }

    const updatedBiodata = await this.prisma.biodata.update({
      where: { id: student.biodataId },
      data: updateData
    });

    return {
      message: 'Data santri berhasil diperbarui',
      biodata: updatedBiodata
    };
  }

  // --- PENGUMUMAN WALSAN CRUD (ADMIN PUSAT & CABANG) ---

  async getPengumumanWalsanForAdmin(user: any) {
    const where: any = {};
    if (user.scope === 'CABANG' && user.cabangId) {
      where.OR = [
        { scope: 'CABANG', cabangId: user.cabangId },
        { scope: 'GLOBAL' }
      ];
    }
    return this.prisma.pengumumanWalsan.findMany({
      where,
      include: {
        cabang: { select: { id: true, name: true } },
        createdBy: { select: { id: true, operatorName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createPengumumanWalsan(user: any, data: any) {
    const scope = user.scope === 'CABANG' ? 'CABANG' : (data.scope || 'GLOBAL');
    const cabangId = user.scope === 'CABANG' ? user.cabangId : (data.cabangId || null);

    return this.prisma.pengumumanWalsan.create({
      data: {
        title: data.title,
        content: data.content,
        links: data.links || [],
        scope,
        cabangId,
        createdById: user.id,
        isActive: data.isActive !== undefined ? data.isActive : true
      }
    });
  }

  async updatePengumumanWalsan(user: any, id: string, data: any) {
    const existing = await this.prisma.pengumumanWalsan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pengumuman tidak ditemukan');

    if (user.scope === 'CABANG' && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Anda tidak memiliki akses untuk mengubah pengumuman ini');
    }

    return this.prisma.pengumumanWalsan.update({
      where: { id },
      data: {
        title: data.title !== undefined ? data.title : existing.title,
        content: data.content !== undefined ? data.content : existing.content,
        links: data.links !== undefined ? data.links : existing.links,
        isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
        scope: user.scope === 'CABANG' ? 'CABANG' : (data.scope !== undefined ? data.scope : existing.scope),
        cabangId: user.scope === 'CABANG' ? user.cabangId : (data.cabangId !== undefined ? data.cabangId : existing.cabangId)
      }
    });
  }

  async deletePengumumanWalsan(user: any, id: string) {
    const existing = await this.prisma.pengumumanWalsan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pengumuman tidak ditemukan');

    if (user.scope === 'CABANG' && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Anda tidak memiliki akses untuk menghapus pengumuman ini');
    }

    await this.prisma.pengumumanWalsan.delete({ where: { id } });
    return { message: 'Pengumuman berhasil dihapus' };
  }
}
