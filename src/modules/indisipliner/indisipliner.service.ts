import { Injectable, Inject, ForbiddenException, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { MinioService } from '../../common/minio/minio.service.js';
import { IndisiplinerTemplateService } from './indisipliner-template.service.js';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class IndisiplinerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(MinioService) private readonly minioService?: MinioService,
    @Optional() @Inject(IndisiplinerTemplateService) private readonly templateService?: IndisiplinerTemplateService,
  ) {}

  // Helper untuk membatasi filter berdasarkan scope pengguna
  private buildScopeFilter(user: any) {
    if (!user) return {};
    if (user.scope === 'CABANG') {
      return { cabangId: user.cabangId };
    }
    if (user.scope === 'WILAYAH') {
      return { wilayahId: user.wilayahId };
    }
    return {};
  }

  // Relasi student yang wajib disertakan agar hasil create() sama bentuknya dengan hasil list()
  private readonly studentInclude = {
    student: {
      include: {
        biodata: {
          select: { fullName: true, nisLokal: true, nisn: true },
        },
        siswaFormal: {
          include: {
            kelas: { select: { id: true, name: true } },
          },
        },
        cabang: {
          select: {
            id: true,
            name: true,
            kode: true,
            wilayah: {
              select: { id: true, name: true },
            },
          },
        },
        wilayah: {
          select: { id: true, name: true },
        },
      },
    },
  };

  private mapPelanggaran(p: any) {
    return {
      id: p.id,
      tanggal: p.tanggal.toISOString().split('T')[0],
      siswaId: p.studentId,
      namaSiswa: p.student?.biodata?.fullName || 'Santri',
      nisLokal: p.student?.biodata?.nisLokal || '-',
      nisn: p.student?.biodata?.nisn || undefined,
      kelas: p.student?.siswaFormal?.kelas?.name || 'Umum',
      wilayahId: p.wilayahId || p.student?.wilayahId || p.student?.cabang?.wilayah?.id || null,
      wilayahName: p.student?.wilayah?.name || p.student?.cabang?.wilayah?.name || '-',
      cabangId: p.cabangId || p.student?.cabangId || null,
      cabangName: p.student?.cabang?.name || '-',
      jenisPelanggaran: p.jenisPelanggaran,
      kategori: p.kategori === 'RINGAN' ? 'Ringan' : p.kategori === 'BERAT' ? 'Berat' : 'Sedang',
      poin: p.poin,
      lokasi: p.lokasi,
      keterangan: p.keterangan,
      tindakanPembinaan: p.tindakanPembinaan,
      dicatatOleh: p.dicatatOleh,
      status: p.status || 'PENDING',
      approvedBy: p.approvedBy || null,
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
      createdAt: p.createdAt,
    };
  }

  private mapSp(s: any) {
    let statusFormatted = 'Aktif';
    if (s.status === 'MASA_PEMBINAAN') statusFormatted = 'Masa Pembinaan';
    else if (s.status === 'SIDANG_DISIPLIN') statusFormatted = 'Sidang Disiplin';
    else if (s.status === 'SELESAI') statusFormatted = 'Selesai';
    else if (s.status === 'DITINGKATKAN') statusFormatted = 'Ditingkatkan';

    return {
      id: s.id,
      tanggalTerbit: s.tanggalTerbit.toISOString().split('T')[0],
      nomorSp: s.nomorSp,
      siswaId: s.studentId,
      namaSiswa: s.student?.biodata?.fullName || 'Santri',
      nisLokal: s.student?.biodata?.nisLokal || '-',
      kelas: s.student?.siswaFormal?.kelas?.name || 'Umum',
      wilayahId: s.wilayahId || s.student?.wilayahId || s.student?.cabang?.wilayah?.id || null,
      wilayahName: s.student?.wilayah?.name || s.student?.cabang?.wilayah?.name || '-',
      cabangId: s.cabangId || s.student?.cabangId || null,
      cabangName: s.student?.cabang?.name || '-',
      tingkatSp: s.tingkatSp === 'SP_3' ? 'SP 3' : s.tingkatSp === 'SP_2' ? 'SP 2' : 'SP 1',
      status: statusFormatted,
      statusApproval: s.statusApproval || 'DISETUJUI',
      approvedBy: s.approvedBy || null,
      approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
      alasan: s.alasan,
      berlakuHingga: s.berlakuHingga ? s.berlakuHingga.toISOString().split('T')[0] : '',
      poinAkumulasi: s.poinAkumulasi,
      tembusan: s.tembusan,
      dokumenSpUrl: s.dokumenSpUrl || null,
      ukuranDokumen: s.ukuranDokumen || null,
    };
  }

  private mapPengeluaran(p: any) {
    let katLabel = 'Akumulasi Poin Maksimal';
    if (p.kategoriAlasan === 'PELANGGARAN_BERAT') katLabel = 'Pelanggaran Berat Syariat / Asusila';
    else if (p.kategoriAlasan === 'MANGKIR_KABUR') katLabel = 'Mangkir / Kabur >30 Hari';
    else if (p.kategoriAlasan === 'KRIMINAL_NARKOBA') katLabel = 'Tindak Pidana / Kriminal / Narkoba';
    else if (p.kategoriAlasan === 'LAINNYA') katLabel = 'Lainnya';

    return {
      id: p.id,
      tanggalKeluar: p.tanggalKeluar.toISOString().split('T')[0],
      siswaId: p.studentId,
      namaSiswa: p.student?.biodata?.fullName || 'Santri',
      nisLokal: p.student?.biodata?.nisLokal || '-',
      kelas: p.student?.siswaFormal?.kelas?.name || 'Umum',
      wilayahId: p.wilayahId || p.student?.wilayahId || p.student?.cabang?.wilayah?.id || null,
      wilayahName: p.student?.wilayah?.name || p.student?.cabang?.wilayah?.name || '-',
      cabangId: p.cabangId || p.student?.cabangId || null,
      cabangName: p.student?.cabang?.name || '-',
      alasanPemberhentian: p.alasanPemberhentian,
      kategoriAlasan: katLabel,
      nomorSk: p.nomorSk,
      tanggalSk: p.tanggalSk.toISOString().split('T')[0],
      dokumenSkUrl: p.dokumenSkUrl || null,
      ukuranDokumen: p.ukuranDokumen || null,
      pejabatTtd: p.pejabatTtd,
      keteranganTambahan: p.keteranganTambahan,
      status: p.status || 'DISETUJUI',
      approvedBy: p.approvedBy || null,
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    };
  }

  // === STATS ===
  async getStats(user: any) {
    const scopeFilter = this.buildScopeFilter(user);

    const [
      totalPelanggaran,
      totalSp,
      totalPengeluaran,
      totalPoinAgg,
      pelanggaranPending,
      spPending,
      pengeluaranPending,
    ] = await Promise.all([
      (this.prisma as any).pelanggaranSantri.count({
        where: {
          ...scopeFilter,
          status: { in: ['DISETUJUI', 'APPROVED'] },
        },
      }),
      (this.prisma as any).suratPeringatan.count({
        where: {
          ...scopeFilter,
          statusApproval: { in: ['DISETUJUI', 'APPROVED'] },
        },
      }),
      (this.prisma as any).pengeluaranSantri.count({
        where: {
          ...scopeFilter,
          status: { in: ['DISETUJUI', 'APPROVED'] },
        },
      }),
      (this.prisma as any).pelanggaranSantri.aggregate({
        _sum: { poin: true },
        where: {
          ...scopeFilter,
          status: { in: ['DISETUJUI', 'APPROVED'] },
        },
      }),
      (this.prisma as any).pelanggaranSantri.count({
        where: {
          ...scopeFilter,
          status: 'PENDING',
        },
      }),
      (this.prisma as any).suratPeringatan.count({
        where: {
          ...scopeFilter,
          statusApproval: 'PENDING',
        },
      }),
      (this.prisma as any).pengeluaranSantri.count({
        where: {
          ...scopeFilter,
          status: 'PENDING',
        },
      }),
    ]);

    const spAktifCount = await (this.prisma as any).suratPeringatan.count({
      where: {
        ...scopeFilter,
        status: { in: ['AKTIF', 'MASA_PEMBINAAN'] },
        statusApproval: { in: ['DISETUJUI', 'APPROVED'] },
      },
    });

    return {
      totalPelanggaran,
      totalPoin: totalPoinAgg._sum?.poin || 0,
      totalSp,
      spAktif: spAktifCount,
      totalPengeluaran,
      pelanggaranPending,
      spPending,
      pengeluaranPending,
    };
  }

  // === PELANGGARAN ===
  async getPelanggaran(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search, kategori, status, wilayahId, cabangId, kelasId } = query || {};

    const where: any = { ...scopeFilter };

    if (kategori && kategori !== 'ALL') {
      where.kategori = kategori.toUpperCase();
    }

    if (status && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    if (wilayahId && wilayahId !== 'ALL' && user?.scope === 'GLOBAL') {
      where.wilayahId = wilayahId;
    }

    if (cabangId && cabangId !== 'ALL' && (user?.scope === 'GLOBAL' || user?.scope === 'WILAYAH')) {
      where.cabangId = cabangId;
    }

    if (kelasId && kelasId !== 'ALL') {
      where.student = {
        ...where.student,
        siswaFormal: {
          kelasId: kelasId,
        },
      };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { jenisPelanggaran: { contains: q, mode: 'insensitive' } },
        { keterangan: { contains: q, mode: 'insensitive' } },
        {
          student: {
            biodata: {
              fullName: { contains: q, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const items = await (this.prisma as any).pelanggaranSantri.findMany({
      where,
      include: this.studentInclude,
      orderBy: { tanggal: 'desc' },
    });

    return items.map((p: any) => this.mapPelanggaran(p));
  }

  async createPelanggaran(dto: any, user: any) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.siswaId || dto.studentId },
      select: { id: true, cabangId: true, wilayahId: true },
    });

    if (!student) {
      throw new NotFoundException('Data santri tidak ditemukan.');
    }

    if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak: Santri bukan dari cabang Anda.');
    }

    const kategoriUpper = (dto.kategori || 'Ringan').toUpperCase();
    const kategoriEnum = ['RINGAN', 'SEDANG', 'BERAT'].includes(kategoriUpper)
      ? kategoriUpper
      : 'RINGAN';

    const isAdmin = user.scope === 'GLOBAL' || user.scope === 'WILAYAH';
    const status = isAdmin ? 'DISETUJUI' : 'PENDING';
    const approvedBy = isAdmin ? (user.operatorName || user.name || user.username || 'Admin') : null;
    const approvedAt = isAdmin ? new Date() : null;

    const created = await (this.prisma as any).pelanggaranSantri.create({
      data: {
        studentId: student.id,
        cabangId: student.cabangId,
        wilayahId: student.wilayahId,
        tanggal: new Date(dto.tanggal || new Date()),
        jenisPelanggaran: dto.jenisPelanggaran || 'Pelanggaran Tata Tertib',
        kategori: kategoriEnum,
        poin: parseInt(dto.poin, 10) || 5,
        lokasi: dto.lokasi || null,
        keterangan: dto.keterangan || null,
        tindakanPembinaan: dto.tindakanPembinaan || null,
        dicatatOleh: dto.dicatatOleh || user.operatorName || user.name || 'Petugas Disiplin',
        status,
        approvedBy,
        approvedAt,
      },
      include: this.studentInclude,
    });

    return this.mapPelanggaran(created);
  }

  async updatePelanggaranStatus(id: string, status: string, user: any) {
    if (user.scope !== 'GLOBAL' && user.scope !== 'WILAYAH') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin yang dapat menyetujui atau menolak pelanggaran.');
    }

    const record = await (this.prisma as any).pelanggaranSantri.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Catatan pelanggaran tidak ditemukan.');
    }

    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: Pelanggaran bukan di wilayah Anda.');
    }

    const normalizedStatus = status?.toUpperCase() === 'DISETUJUI' ? 'DISETUJUI'
      : status?.toUpperCase() === 'DITOLAK' ? 'DITOLAK'
      : 'PENDING';

    const updated = await (this.prisma as any).pelanggaranSantri.update({
      where: { id },
      data: {
        status: normalizedStatus,
        approvedBy: user.operatorName || user.name || user.username || 'Admin',
        approvedAt: new Date(),
      },
      include: this.studentInclude,
    });

    return this.mapPelanggaran(updated);
  }

  async updatePelanggaran(id: string, dto: any, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan mengubah catatan pelanggaran. Hubungi Admin.');
    }

    const record = await (this.prisma as any).pelanggaranSantri.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Catatan pelanggaran tidak ditemukan.');
    }

    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: Pelanggaran bukan di wilayah Anda.');
    }

    const kategoriUpper = (dto.kategori || record.kategori).toUpperCase();
    const kategoriEnum = ['RINGAN', 'SEDANG', 'BERAT'].includes(kategoriUpper)
      ? kategoriUpper
      : record.kategori;

    const data: any = {};
    if (dto.tanggal) data.tanggal = new Date(dto.tanggal);
    if (dto.jenisPelanggaran) data.jenisPelanggaran = dto.jenisPelanggaran;
    if (dto.kategori) data.kategori = kategoriEnum;
    if (dto.poin !== undefined) data.poin = parseInt(dto.poin, 10) || record.poin;
    if (dto.lokasi !== undefined) data.lokasi = dto.lokasi;
    if (dto.keterangan !== undefined) data.keterangan = dto.keterangan;
    if (dto.tindakanPembinaan !== undefined) data.tindakanPembinaan = dto.tindakanPembinaan;
    if (dto.dicatatOleh !== undefined) data.dicatatOleh = dto.dicatatOleh;

    const updated = await (this.prisma as any).pelanggaranSantri.update({
      where: { id },
      data,
      include: this.studentInclude,
    });

    return this.mapPelanggaran(updated);
  }

  async deletePelanggaran(id: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan menghapus catatan pelanggaran. Hubungi Admin.');
    }

    const record = await (this.prisma as any).pelanggaranSantri.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Catatan pelanggaran tidak ditemukan.');
    }

    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: Pelanggaran bukan di wilayah Anda.');
    }

    return (this.prisma as any).pelanggaranSantri.delete({ where: { id } });
  }

  // === SURAT PERINGATAN (SP) ===
  async getSp(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search, tingkat, statusApproval, wilayahId, cabangId, kelasId } = query || {};

    const where: any = { ...scopeFilter };

    if (tingkat && tingkat !== 'ALL') {
      where.tingkatSp = tingkat.replace(/\s+/g, '_').toUpperCase();
    }

    if (statusApproval && statusApproval !== 'ALL') {
      where.statusApproval = statusApproval.toUpperCase();
    }

    if (wilayahId && wilayahId !== 'ALL' && user?.scope === 'GLOBAL') {
      where.wilayahId = wilayahId;
    }

    if (cabangId && cabangId !== 'ALL' && (user?.scope === 'GLOBAL' || user?.scope === 'WILAYAH')) {
      where.cabangId = cabangId;
    }

    if (kelasId && kelasId !== 'ALL') {
      where.student = {
        ...where.student,
        siswaFormal: {
          kelasId: kelasId,
        },
      };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { nomorSp: { contains: q, mode: 'insensitive' } },
        { alasan: { contains: q, mode: 'insensitive' } },
        {
          student: {
            biodata: {
              fullName: { contains: q, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const items = await (this.prisma as any).suratPeringatan.findMany({
      where,
      include: this.studentInclude,
      orderBy: { tanggalTerbit: 'desc' },
    });

    return items.map((s: any) => this.mapSp(s));
  }

  async createSp(dto: any, user: any) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.siswaId || dto.studentId },
      select: { id: true, cabangId: true, wilayahId: true },
    });

    if (!student) {
      throw new NotFoundException('Data santri tidak ditemukan.');
    }

    if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak: Santri bukan dari cabang Anda.');
    }

    const tingkatEnum = dto.tingkatSp === 'SP 3' || dto.tingkatSp === 'SP_3' ? 'SP_3'
      : dto.tingkatSp === 'SP 2' || dto.tingkatSp === 'SP_2' ? 'SP_2'
      : 'SP_1';

    const nomorSp = dto.nomorSp?.trim() || `SP/${Date.now().toString().slice(-4)}/KDS/YTS/${new Date().getFullYear()}`;

    const isAdmin = user.scope === 'GLOBAL' || user.scope === 'WILAYAH';
    const statusApproval = isAdmin ? 'DISETUJUI' : 'PENDING';
    const approvedBy = isAdmin ? (user.operatorName || user.name || user.username || 'Admin') : null;
    const approvedAt = isAdmin ? new Date() : null;

    const created = await (this.prisma as any).suratPeringatan.create({
      data: {
        studentId: student.id,
        cabangId: student.cabangId,
        wilayahId: student.wilayahId,
        nomorSp,
        tingkatSp: tingkatEnum,
        status: 'AKTIF',
        statusApproval,
        approvedBy,
        approvedAt,
        tanggalTerbit: new Date(dto.tanggalTerbit || new Date()),
        berlakuHingga: dto.berlakuHingga ? new Date(dto.berlakuHingga) : null,
        poinAkumulasi: parseInt(dto.poinAkumulasi, 10) || 0,
        alasan: dto.alasan || 'Pelanggaran tata tertib pesantren',
        tembusan: dto.tembusan || null,
        dokumenSpUrl: dto.dokumenSpUrl || null,
        ukuranDokumen: dto.ukuranDokumen || null,
      },
      include: this.studentInclude,
    });

    return this.mapSp(created);
  }

  async updateSpStatusApproval(id: string, statusApproval: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin yang berhak menyetujui atau menolak Surat Peringatan.');
    }

    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');

    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: SP bukan di wilayah Anda.');
    }

    const stUpper = statusApproval.toUpperCase();
    if (!['DISETUJUI', 'DITOLAK', 'PENDING'].includes(stUpper)) {
      throw new BadRequestException('Status approval tidak valid. Gunakan DISETUJUI atau DITOLAK.');
    }

    const updated = await (this.prisma as any).suratPeringatan.update({
      where: { id },
      data: {
        statusApproval: stUpper,
        approvedBy: user.operatorName || user.name || user.username || 'Admin',
        approvedAt: new Date(),
      },
      include: this.studentInclude,
    });

    return this.mapSp(updated);
  }

  async updateSpStatus(id: string, status: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan mengubah status SP. Hubungi Admin.');
    }

    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');
    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak.');
    }

    let statusEnum = 'AKTIF';
    const s = status.toUpperCase().replace(/\s+/g, '_');
    if (['AKTIF', 'MASA_PEMBINAAN', 'SELESAI', 'DITINGKATKAN', 'SIDANG_DISIPLIN'].includes(s)) {
      statusEnum = s;
    }

    return (this.prisma as any).suratPeringatan.update({
      where: { id },
      data: { status: statusEnum },
    });
  }

  async updateSp(id: string, dto: any, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan mengubah data SP. Hubungi Admin.');
    }

    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');
    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: SP bukan di wilayah Anda.');
    }

    const data: any = {};
    if (dto.tanggalTerbit) data.tanggalTerbit = new Date(dto.tanggalTerbit);
    if (dto.berlakuHingga) data.berlakuHingga = new Date(dto.berlakuHingga);
    if (dto.nomorSp) data.nomorSp = dto.nomorSp;
    if (dto.alasan) data.alasan = dto.alasan;
    if (dto.tembusan !== undefined) data.tembusan = dto.tembusan;
    if (dto.poinAkumulasi !== undefined) data.poinAkumulasi = parseInt(dto.poinAkumulasi, 10) || record.poinAkumulasi;

    const updated = await (this.prisma as any).suratPeringatan.update({
      where: { id },
      data,
      include: this.studentInclude,
    });

    return this.mapSp(updated);
  }

  async deleteSp(id: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan menghapus data SP. Hubungi Admin.');
    }

    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');
    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return (this.prisma as any).suratPeringatan.delete({ where: { id } });
  }

  // === PENGELUARAN SISWA ===
  async getPengeluaran(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search, status, wilayahId, cabangId, kelasId } = query || {};

    const where: any = { ...scopeFilter };

    if (status && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    if (wilayahId && wilayahId !== 'ALL' && user?.scope === 'GLOBAL') {
      where.wilayahId = wilayahId;
    }

    if (cabangId && cabangId !== 'ALL' && (user?.scope === 'GLOBAL' || user?.scope === 'WILAYAH')) {
      where.cabangId = cabangId;
    }

    if (kelasId && kelasId !== 'ALL') {
      where.student = {
        ...where.student,
        siswaFormal: {
          kelasId: kelasId,
        },
      };
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { nomorSk: { contains: q, mode: 'insensitive' } },
        { alasanPemberhentian: { contains: q, mode: 'insensitive' } },
        {
          student: {
            biodata: {
              fullName: { contains: q, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const items = await (this.prisma as any).pengeluaranSantri.findMany({
      where,
      include: this.studentInclude,
      orderBy: { tanggalKeluar: 'desc' },
    });

    return items.map((p: any) => this.mapPengeluaran(p));
  }

  async createPengeluaran(dto: any, user: any) {
    const student = await this.prisma.student.findUnique({
      where: { id: dto.siswaId || dto.studentId },
      select: { id: true, cabangId: true, wilayahId: true },
    });

    if (!student) {
      throw new NotFoundException('Data santri tidak ditemukan.');
    }

    if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak: Santri bukan dari cabang Anda.');
    }

    let katEnum = 'AKUMULASI_POIN';
    if (dto.kategoriAlasan?.includes('Berat') || dto.kategoriAlasan === 'PELANGGARAN_BERAT') katEnum = 'PELANGGARAN_BERAT';
    else if (dto.kategoriAlasan?.includes('Mangkir') || dto.kategoriAlasan === 'MANGKIR_KABUR') katEnum = 'MANGKIR_KABUR';
    else if (dto.kategoriAlasan?.includes('Kriminal') || dto.kategoriAlasan === 'KRIMINAL_NARKOBA') katEnum = 'KRIMINAL_NARKOBA';
    else if (dto.kategoriAlasan === 'LAINNYA') katEnum = 'LAINNYA';

    const nomorSk = dto.nomorSk?.trim() || `SK/DO/YTS/${new Date().getFullYear()}/${Date.now().toString().slice(-4)}`;

    const isAdmin = user.scope === 'GLOBAL' || user.scope === 'WILAYAH';
    const status = isAdmin ? 'DISETUJUI' : 'PENDING';
    const approvedBy = isAdmin ? (user.operatorName || user.name || user.username || 'Admin') : null;
    const approvedAt = isAdmin ? new Date() : null;

    const created = await (this.prisma as any).pengeluaranSantri.create({
      data: {
        studentId: student.id,
        cabangId: student.cabangId,
        wilayahId: student.wilayahId,
        tanggalKeluar: new Date(dto.tanggalKeluar || new Date()),
        alasanPemberhentian: dto.alasanPemberhentian || 'Keputusan Sidang Disiplin',
        kategoriAlasan: katEnum,
        nomorSk,
        tanggalSk: new Date(dto.tanggalSk || dto.tanggalKeluar || new Date()),
        dokumenSkUrl: dto.dokumenSkUrl || null,
        ukuranDokumen: dto.ukuranDokumen || null,
        pejabatTtd: dto.pejabatTtd || 'Pimpinan Pesantren',
        keteranganTambahan: dto.keteranganTambahan || null,
        status,
        approvedBy,
        approvedAt,
      },
      include: this.studentInclude,
    });

    // Update status santri menjadi DROP_OUT HANYA jika disetujui Admin
    if (isAdmin) {
      await this.prisma.student.update({
        where: { id: student.id },
        data: {
          statusPool: 'DROP_OUT',
          isActive: false,
        },
      });
    }

    return this.mapPengeluaran(created);
  }

  async updatePengeluaranStatus(id: string, status: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Hanya Admin yang berhak menyetujui atau menolak pengeluaran santri.');
    }

    const record = await (this.prisma as any).pengeluaranSantri.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Data pengeluaran tidak ditemukan.');
    }

    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: Data bukan di wilayah Anda.');
    }

    const stUpper = status.toUpperCase();
    if (!['DISETUJUI', 'DITOLAK', 'PENDING'].includes(stUpper)) {
      throw new BadRequestException('Status tidak valid. Gunakan DISETUJUI atau DITOLAK.');
    }

    const updated = await (this.prisma as any).pengeluaranSantri.update({
      where: { id },
      data: {
        status: stUpper,
        approvedBy: user.operatorName || user.name || user.username || 'Admin',
        approvedAt: new Date(),
      },
      include: this.studentInclude,
    });

    // Jika DISETUJUI, nonaktifkan santri menjadi DROP_OUT
    if (stUpper === 'DISETUJUI') {
      await this.prisma.student.update({
        where: { id: record.studentId },
        data: {
          statusPool: 'DROP_OUT',
          isActive: false,
        },
      });
    } else if (stUpper === 'DITOLAK') {
      // Jika DITOLAK, aktifkan kembali santri
      await this.prisma.student.update({
        where: { id: record.studentId },
        data: {
          statusPool: 'AKTIF_CABANG',
          isActive: true,
        },
      });
    }

    return this.mapPengeluaran(updated);
  }

  async updatePengeluaran(id: string, dto: any, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan mengubah data pengeluaran santri. Hubungi Admin.');
    }

    const record = await (this.prisma as any).pengeluaranSantri.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data pengeluaran tidak ditemukan.');
    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: Data bukan di wilayah Anda.');
    }

    const data: any = {};
    if (dto.tanggalKeluar) data.tanggalKeluar = new Date(dto.tanggalKeluar);
    if (dto.alasanPemberhentian) data.alasanPemberhentian = dto.alasanPemberhentian;
    if (dto.nomorSk) data.nomorSk = dto.nomorSk;
    if (dto.tanggalSk) data.tanggalSk = new Date(dto.tanggalSk);
    if (dto.pejabatTtd) data.pejabatTtd = dto.pejabatTtd;
    if (dto.keteranganTambahan !== undefined) data.keteranganTambahan = dto.keteranganTambahan;

    const updated = await (this.prisma as any).pengeluaranSantri.update({
      where: { id },
      data,
      include: this.studentInclude,
    });

    return this.mapPengeluaran(updated);
  }

  async deletePengeluaran(id: string, user: any) {
    if (user.scope === 'CABANG') {
      throw new ForbiddenException('Akses ditolak: Cabang tidak diizinkan menghapus data pengeluaran santri. Hubungi Admin.');
    }

    const record = await (this.prisma as any).pengeluaranSantri.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data pengeluaran tidak ditemukan.');
    if (user.scope === 'WILAYAH' && record.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak.');
    }

    // Jika data pengeluaran dihapus, kembalikan status santri ke AKTIF
    await this.prisma.student.update({
      where: { id: record.studentId },
      data: {
        statusPool: 'AKTIF_CABANG',
        isActive: true,
      },
    });

    return (this.prisma as any).pengeluaranSantri.delete({ where: { id } });
  }

  // === UPLOAD BERKAS SP & PENGELUARAN (PDF / GAMBAR) ===
  async uploadDokumen(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File berkas harus disertakan.');

    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    if (!allowed.includes(ext)) {
      throw new BadRequestException(`Format berkas tidak didukung (${ext}). Harap gunakan file PDF atau Gambar (JPG/PNG).`);
    }

    const filename = `indisipliner_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const objectKey = `indisipliner/${filename}`;

    if (this.minioService) {
      try {
        await this.minioService.uploadBuffer(objectKey, file.buffer, file.mimetype);
      } catch (err) {
        console.warn('MinIO upload warning, falling back to local storage:', err);
        const localDir = path.resolve(process.cwd(), 'uploads/indisipliner');
        if (!fs.existsSync(localDir)) {
          fs.mkdirSync(localDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localDir, filename), file.buffer);
      }
    } else {
      const localDir = path.resolve(process.cwd(), 'uploads/indisipliner');
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      fs.writeFileSync(path.join(localDir, filename), file.buffer);
    }

    const sizeKb = Math.round(file.size / 1024);
    const ukuranDokumen = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;

    return {
      url: `/uploads/indisipliner/${filename}`,
      filename: file.originalname,
      ukuranDokumen,
    };
  }

  // === TEMPLATE DOCX SP & PENGELUARAN ===
  async getSpTemplateDocx(tingkat: string, spId?: string) {
    if (!this.templateService) {
      throw new BadRequestException('Layanan template DOCX tidak tersedia.');
    }

    let templateData: any = { tingkatSp: tingkat };

    if (spId) {
      const spRecord = await (this.prisma as any).suratPeringatan.findUnique({
        where: { id: spId },
        include: {
          student: {
            include: {
              biodata: true,
              siswaFormal: { include: { kelas: true } },
              cabang: true,
            },
          },
        },
      });
      if (spRecord) {
        templateData = {
          nomorSp: spRecord.nomorSp,
          tingkatSp: spRecord.tingkatSp.replace('_', ' '),
          namaSiswa: spRecord.student?.biodata?.fullName,
          nis: spRecord.student?.biodata?.nisLokal || spRecord.student?.siswaFormal?.nis,
          kelas: spRecord.student?.siswaFormal?.kelas?.name,
          cabang: spRecord.student?.cabang?.name,
          tanggalTerbit: spRecord.tanggalTerbit.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          berlakuHingga: spRecord.berlakuHingga ? spRecord.berlakuHingga.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
          poinAkumulasi: spRecord.poinAkumulasi,
          alasan: spRecord.alasan,
        };
      }
    }

    return this.templateService.generateSpDocx(templateData);
  }

  async getPengeluaranTemplateDocx(pengeluaranId?: string) {
    if (!this.templateService) {
      throw new BadRequestException('Layanan template DOCX tidak tersedia.');
    }

    let templateData: any = {};

    if (pengeluaranId) {
      const pRecord = await (this.prisma as any).pengeluaranSantri.findUnique({
        where: { id: pengeluaranId },
        include: {
          student: {
            include: {
              biodata: true,
              siswaFormal: { include: { kelas: true } },
              cabang: true,
            },
          },
        },
      });
      if (pRecord) {
        let katLabel = 'Akumulasi Poin Maksimal';
        if (pRecord.kategoriAlasan === 'PELANGGARAN_BERAT') katLabel = 'Pelanggaran Berat Syariat / Asusila';
        else if (pRecord.kategoriAlasan === 'MANGKIR_KABUR') katLabel = 'Mangkir / Kabur >30 Hari';
        else if (pRecord.kategoriAlasan === 'KRIMINAL_NARKOBA') katLabel = 'Tindak Pidana / Kriminal / Narkoba';
        else if (pRecord.kategoriAlasan === 'LAINNYA') katLabel = 'Lainnya';

        templateData = {
          nomorSk: pRecord.nomorSk,
          namaSiswa: pRecord.student?.biodata?.fullName,
          nis: pRecord.student?.biodata?.nisLokal || pRecord.student?.siswaFormal?.nis,
          kelas: pRecord.student?.siswaFormal?.kelas?.name,
          cabang: pRecord.student?.cabang?.name,
          tanggalKeluar: pRecord.tanggalKeluar.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          tanggalSk: pRecord.tanggalSk.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          alasanPemberhentian: pRecord.alasanPemberhentian,
          kategoriAlasan: katLabel,
          pejabatTtd: pRecord.pejabatTtd,
        };
      }
    }

    return this.templateService.generatePengeluaranDocx(templateData);
  }
}
