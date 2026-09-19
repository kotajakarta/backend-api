import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class IndisiplinerService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  // === STATS ===
  async getStats(user: any) {
    const scopeFilter = this.buildScopeFilter(user);

    const [totalPelanggaran, totalSp, totalPengeluaran, totalPoinAgg] = await Promise.all([
      (this.prisma as any).pelanggaranSantri.count({ where: scopeFilter }),
      (this.prisma as any).suratPeringatan.count({ where: scopeFilter }),
      (this.prisma as any).pengeluaranSantri.count({ where: scopeFilter }),
      (this.prisma as any).pelanggaranSantri.aggregate({
        _sum: { poin: true },
        where: scopeFilter,
      }),
    ]);

    const spAktifCount = await (this.prisma as any).suratPeringatan.count({
      where: {
        ...scopeFilter,
        status: { in: ['AKTIF', 'MASA_PEMBINAAN'] },
      },
    });

    return {
      totalPelanggaran,
      totalPoin: totalPoinAgg._sum.poin || 0,
      totalSp,
      spAktif: spAktifCount,
      totalPengeluaran,
    };
  }

  // === PELANGGARAN ===
  async getPelanggaran(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search, kategori } = query || {};

    const where: any = { ...scopeFilter };

    if (kategori && kategori !== 'ALL') {
      where.kategori = kategori.toUpperCase();
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
      include: {
        student: {
          include: {
            biodata: {
              select: {
                fullName: true,
                nisLokal: true,
                nisn: true,
              },
            },
            siswaFormal: {
              include: {
                kelas: {
                  select: { namaKelas: true },
                },
              },
            },
          },
        },
      },
      orderBy: { tanggal: 'desc' },
    });

    return items.map((p: any) => ({
      id: p.id,
      tanggal: p.tanggal.toISOString().split('T')[0],
      siswaId: p.studentId,
      namaSiswa: p.student?.biodata?.fullName || 'Santri',
      nisLokal: p.student?.biodata?.nisLokal || '-',
      nisn: p.student?.biodata?.nisn || undefined,
      kelas: p.student?.siswaFormal?.kelas?.namaKelas || 'Umum',
      jenisPelanggaran: p.jenisPelanggaran,
      kategori: p.kategori === 'RINGAN' ? 'Ringan' : p.kategori === 'BERAT' ? 'Berat' : 'Sedang',
      poin: p.poin,
      lokasi: p.lokasi,
      keterangan: p.keterangan,
      tindakanPembinaan: p.tindakanPembinaan,
      dicatatOleh: p.dicatatOleh,
      createdAt: p.createdAt,
    }));
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
        dicatatOleh: dto.dicatatOleh || user.name || 'Petugas Disiplin',
      },
    });

    return created;
  }

  async deletePelanggaran(id: string, user: any) {
    const record = await (this.prisma as any).pelanggaranSantri.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Catatan pelanggaran tidak ditemukan.');
    }
    if (user.scope === 'CABANG' && record.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return (this.prisma as any).pelanggaranSantri.delete({ where: { id } });
  }

  // === SURAT PERINGATAN (SP) ===
  async getSp(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search, tingkat } = query || {};

    const where: any = { ...scopeFilter };

    if (tingkat && tingkat !== 'ALL') {
      where.tingkatSp = tingkat.replace(/\s+/g, '_').toUpperCase();
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
      include: {
        student: {
          include: {
            biodata: {
              select: {
                fullName: true,
                nisLokal: true,
              },
            },
            siswaFormal: {
              include: {
                kelas: {
                  select: { namaKelas: true },
                },
              },
            },
          },
        },
      },
      orderBy: { tanggalTerbit: 'desc' },
    });

    return items.map((s: any) => {
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
        kelas: s.student?.siswaFormal?.kelas?.namaKelas || 'Umum',
        tingkatSp: s.tingkatSp === 'SP_3' ? 'SP 3' : s.tingkatSp === 'SP_2' ? 'SP 2' : 'SP 1',
        status: statusFormatted,
        alasan: s.alasan,
        berlakuHingga: s.berlakuHingga ? s.berlakuHingga.toISOString().split('T')[0] : '',
        poinAkumulasi: s.poinAkumulasi,
        tembusan: s.tembusan,
      };
    });
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

    const created = await (this.prisma as any).suratPeringatan.create({
      data: {
        studentId: student.id,
        cabangId: student.cabangId,
        wilayahId: student.wilayahId,
        nomorSp,
        tingkatSp: tingkatEnum,
        status: 'AKTIF',
        tanggalTerbit: new Date(dto.tanggalTerbit || new Date()),
        berlakuHingga: dto.berlakuHingga ? new Date(dto.berlakuHingga) : null,
        poinAkumulasi: parseInt(dto.poinAkumulasi, 10) || 0,
        alasan: dto.alasan || 'Pelanggaran tata tertib pesantren',
        tembusan: dto.tembusan || null,
      },
    });

    return created;
  }

  async updateSpStatus(id: string, status: string, user: any) {
    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');
    if (user.scope === 'CABANG' && record.cabangId !== user.cabangId) {
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

  async deleteSp(id: string, user: any) {
    const record = await (this.prisma as any).suratPeringatan.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('SP tidak ditemukan.');
    if (user.scope === 'CABANG' && record.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return (this.prisma as any).suratPeringatan.delete({ where: { id } });
  }

  // === PENGELUARAN SISWA ===
  async getPengeluaran(query: any, user: any) {
    const scopeFilter = this.buildScopeFilter(user);
    const { search } = query || {};

    const where: any = { ...scopeFilter };

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
      include: {
        student: {
          include: {
            biodata: {
              select: {
                fullName: true,
                nisLokal: true,
              },
            },
            siswaFormal: {
              include: {
                kelas: {
                  select: { namaKelas: true },
                },
              },
            },
          },
        },
      },
      orderBy: { tanggalKeluar: 'desc' },
    });

    return items.map((p: any) => {
      let katLabel = 'Akumulasi Poin Maksimal';
      if (p.kategoriAlasan === 'PELANGGARAN_BERAT') katLabel = 'Pelanggaran Berat Syariat / Asusila';
      else if (p.kategoriAlasan === 'MANGKIR_KABUR') katLabel = 'Mangkir / Kabur';
      else if (p.kategoriAlasan === 'KRIMINAL_NARKOBA') katLabel = 'Kriminal / Narkoba';
      else if (p.kategoriAlasan === 'LAINNYA') katLabel = 'Lainnya';

      return {
        id: p.id,
        tanggalKeluar: p.tanggalKeluar.toISOString().split('T')[0],
        siswaId: p.studentId,
        namaSiswa: p.student?.biodata?.fullName || 'Santri',
        nisLokal: p.student?.biodata?.nisLokal || '-',
        kelas: p.student?.siswaFormal?.kelas?.namaKelas || 'Umum',
        alasanPemberhentian: p.alasanPemberhentian,
        kategoriAlasan: katLabel,
        nomorSk: p.nomorSk,
        tanggalSk: p.tanggalSk.toISOString().split('T')[0],
        dokumenSkUrl: p.dokumenSkUrl || `/dokumen/sk/${p.nomorSk.replace(/[\/]/g, '-')}.pdf`,
        ukuranDokumen: p.ukuranDokumen || '320 KB',
        pejabatTtd: p.pejabatTtd,
        keteranganTambahan: p.keteranganTambahan,
      };
    });
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
        ukuranDokumen: dto.ukuranDokumen || '350 KB',
        pejabatTtd: dto.pejabatTtd || 'Pimpinan Pesantren',
        keteranganTambahan: dto.keteranganTambahan || null,
      },
    });

    // Update status santri menjadi DROP_OUT dan nonaktif
    await this.prisma.student.update({
      where: { id: student.id },
      data: {
        statusPool: 'DROP_OUT',
        isActive: false,
      },
    });

    return created;
  }

  async deletePengeluaran(id: string, user: any) {
    const record = await (this.prisma as any).pengeluaranSantri.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Data pengeluaran tidak ditemukan.');
    if (user.scope === 'CABANG' && record.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak.');
    }
    return (this.prisma as any).pengeluaranSantri.delete({ where: { id } });
  }
}
