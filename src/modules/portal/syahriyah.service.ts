import { Injectable, Inject, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class SyahriyahService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get p(): any {
    return this.prisma as any;
  }

  // Helper ownership assertion
  async assertOwnsStudent(userId: string, studentId: string): Promise<void> {
    const link = await this.p.waliSantri.findUnique({
      where: { userId_studentId: { userId, studentId } }
    });
    if (!link) throw new ForbiddenException('Anda tidak memiliki akses ke data santri ini');
  }

  // ═══════════════════════════════════════════════════════════
  // 1. MASTER TARIF BIAYA
  // ═══════════════════════════════════════════════════════════

  async getTarifList(user: any) {
    const where: any = { isActive: true };
    if (user.scope === 'CABANG') {
      where.OR = [{ cabangId: user.cabangId }, { cabangId: null }];
    } else if (user.scope === 'WILAYAH') {
      where.OR = [{ cabang: { wilayahId: user.wilayahId } }, { cabangId: null }];
    }
    return this.p.syahriyahTarif.findMany({
      where,
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: [{ kategori: 'asc' }, { name: 'asc' }]
    });
  }

  async createTarif(data: any, user: any) {
    const cabangId = user.scope === 'CABANG' ? user.cabangId : (data.cabangId || null);
    return this.p.syahriyahTarif.create({
      data: {
        name: data.name,
        kategori: data.kategori || 'BULANAN',
        nominal: Number(data.nominal || 0),
        cabangId,
        tahunAjaran: data.tahunAjaran || null,
        tingkat: data.tingkat || null,
        deskripsi: data.deskripsi || null,
        isActive: data.isActive ?? true
      },
      include: { cabang: { select: { id: true, name: true } } }
    });
  }

  async updateTarif(id: string, data: any, user: any) {
    const existing = await this.p.syahriyahTarif.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tarif tidak ditemukan');
    if (user.scope === 'CABANG' && existing.cabangId && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses mengubah tarif cabang lain');
    }

    return this.p.syahriyahTarif.update({
      where: { id },
      data: {
        name: data.name ?? existing.name,
        kategori: data.kategori ?? existing.kategori,
        nominal: data.nominal !== undefined ? Number(data.nominal) : existing.nominal,
        cabangId: user.scope === 'CABANG' ? user.cabangId : (data.cabangId !== undefined ? data.cabangId : existing.cabangId),
        tahunAjaran: data.tahunAjaran !== undefined ? data.tahunAjaran : existing.tahunAjaran,
        tingkat: data.tingkat !== undefined ? data.tingkat : existing.tingkat,
        deskripsi: data.deskripsi !== undefined ? data.deskripsi : existing.deskripsi,
        isActive: data.isActive ?? existing.isActive
      },
      include: { cabang: { select: { id: true, name: true } } }
    });
  }

  async deleteTarif(id: string, user: any) {
    const existing = await this.p.syahriyahTarif.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tarif tidak ditemukan');
    if (user.scope === 'CABANG' && existing.cabangId && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses menghapus tarif cabang lain');
    }

    return this.p.syahriyahTarif.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════
  // 2. MASTER REKENING PEMBAYARAN
  // ═══════════════════════════════════════════════════════════

  async getRekeningList(user: any) {
    const where: any = { isActive: true };
    if (user.scope === 'CABANG') {
      where.OR = [{ cabangId: user.cabangId }, { cabangId: null }];
    } else if (user.scope === 'WILAYAH') {
      where.OR = [{ cabang: { wilayahId: user.wilayahId } }, { cabangId: null }];
    }
    return this.p.rekeningPembayaran.findMany({
      where,
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createRekening(data: any, user: any) {
    const cabangId = user.scope === 'CABANG' ? user.cabangId : (data.cabangId || null);
    return this.p.rekeningPembayaran.create({
      data: {
        bankName: data.bankName,
        nomorRekening: data.nomorRekening,
        atasNama: data.atasNama,
        cabangId,
        qrisUrl: data.qrisUrl || null,
        catatan: data.catatan || null,
        isActive: data.isActive ?? true
      },
      include: { cabang: { select: { id: true, name: true } } }
    });
  }

  async updateRekening(id: string, data: any, user: any) {
    const existing = await this.p.rekeningPembayaran.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rekening tidak ditemukan');
    if (user.scope === 'CABANG' && existing.cabangId && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses mengubah rekening cabang lain');
    }

    return this.p.rekeningPembayaran.update({
      where: { id },
      data: {
        bankName: data.bankName ?? existing.bankName,
        nomorRekening: data.nomorRekening ?? existing.nomorRekening,
        atasNama: data.atasNama ?? existing.atasNama,
        cabangId: user.scope === 'CABANG' ? user.cabangId : (data.cabangId !== undefined ? data.cabangId : existing.cabangId),
        qrisUrl: data.qrisUrl !== undefined ? data.qrisUrl : existing.qrisUrl,
        catatan: data.catatan !== undefined ? data.catatan : existing.catatan,
        isActive: data.isActive ?? existing.isActive
      },
      include: { cabang: { select: { id: true, name: true } } }
    });
  }

  async deleteRekening(id: string, user: any) {
    const existing = await this.p.rekeningPembayaran.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rekening tidak ditemukan');
    if (user.scope === 'CABANG' && existing.cabangId && existing.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses menghapus rekening cabang lain');
    }

    return this.p.rekeningPembayaran.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════
  // 3. TAGIHAN SANTRI & STATISTIK (ADMIN)
  // ═══════════════════════════════════════════════════════════

  private buildTagihanWhere(query: any, user: any) {
    const where: any = {};

    // Scope check
    if (user.scope === 'CABANG') {
      where.student = { cabangId: user.cabangId };
    } else if (user.scope === 'WILAYAH') {
      where.student = { cabang: { wilayahId: user.wilayahId } };
    }

    if (query.cabangId) {
      where.student = { ...(where.student || {}), cabangId: query.cabangId };
    }

    if (query.studentId) {
      where.studentId = query.studentId;
    }

    if (query.kategori) {
      where.kategori = query.kategori;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.bulan) {
      where.bulan = Number(query.bulan);
    }

    if (query.tahun) {
      where.tahun = Number(query.tahun);
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { judul: { contains: search, mode: 'insensitive' } },
        { student: { biodata: { fullName: { contains: search, mode: 'insensitive' } } } },
        { student: { biodata: { nik: { contains: search, mode: 'insensitive' } } } },
        { student: { biodata: { nisn: { contains: search, mode: 'insensitive' } } } }
      ];
    }

    return where;
  }

  async getTagihanList(query: any, user: any) {
    const where = this.buildTagihanWhere(query, user);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.p.tagihanSantri.count({ where }),
      this.p.tagihanSantri.findMany({
        where,
        include: {
          student: {
            include: {
              biodata: true,
              cabang: { select: { id: true, name: true } },
              siswaFormal: { include: { kelas: true } }
            }
          },
          tarif: true,
          pembayaran: {
            include: {
              waliUser: { select: { id: true, username: true, operatorName: true, phone: true } },
              verifiedBy: { select: { id: true, username: true, operatorName: true } }
            },
            orderBy: { createdAt: 'desc' }
          }
        },
        orderBy: [{ tahun: 'desc' }, { bulan: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      })
    ]);

    return {
      data: items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  async getSyahriyahStats(query: any, user: any) {
    const where = this.buildTagihanWhere(query, user);

    const list = await this.p.tagihanSantri.findMany({
      where,
      select: {
        id: true,
        nominal: true,
        status: true
      }
    });

    let totalNominal = 0;
    let lunasCount = 0;
    let lunasNominal = 0;
    let pendingCount = 0;
    let pendingNominal = 0;
    let belumLunasCount = 0;
    let belumLunasNominal = 0;

    for (const item of list) {
      totalNominal += item.nominal;
      if (item.status === 'LUNAS') {
        lunasCount++;
        lunasNominal += item.nominal;
      } else if (item.status === 'PENDING') {
        pendingCount++;
        pendingNominal += item.nominal;
      } else {
        belumLunasCount++;
        belumLunasNominal += item.nominal;
      }
    }

    return {
      totalCount: list.length,
      totalNominal,
      lunasCount,
      lunasNominal,
      pendingCount,
      pendingNominal,
      belumLunasCount,
      belumLunasNominal
    };
  }

  async createTagihan(data: any, user: any) {
    const student = await this.p.student.findUnique({
      where: { id: data.studentId },
      include: { cabang: true }
    });
    if (!student) throw new NotFoundException('Santri tidak ditemukan');

    if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses membuat tagihan untuk santri cabang lain');
    }

    const nominal = Number(data.nominal || 0);
    return this.p.tagihanSantri.create({
      data: {
        studentId: data.studentId,
        tarifId: data.tarifId || null,
        cabangId: student.cabangId || null,
        judul: data.judul,
        kategori: data.kategori || 'BULANAN',
        bulan: data.bulan ? Number(data.bulan) : null,
        tahun: Number(data.tahun || new Date().getFullYear()),
        nominal,
        sisaBayar: nominal,
        status: 'BELUM_LUNAS',
        jatuhTempo: data.jatuhTempo ? new Date(data.jatuhTempo) : null,
        keterangan: data.keterangan || null
      },
      include: {
        student: { include: { biodata: true, cabang: true } },
        tarif: true
      }
    });
  }

  async generateTagihanBulanan(data: { bulan: number; tahun: number; cabangId?: string; tingkat?: string; nominal?: number; jatuhTempo?: string }, user: any) {
    const bulan = Number(data.bulan);
    const tahun = Number(data.tahun);
    const targetCabangId = user.scope === 'CABANG' ? user.cabangId : (data.cabangId || undefined);

    const bulanNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const namaBulan = bulanNames[bulan - 1] || `Bulan ${bulan}`;

    // Cari tarif default bulanan jika nominal belum ditentukan
    let defaultNominal = data.nominal;
    let defaultTarifId: string | null = null;

    if (!defaultNominal) {
      const tarif = await this.p.syahriyahTarif.findFirst({
        where: {
          kategori: 'BULANAN',
          isActive: true,
          ...(targetCabangId ? { OR: [{ cabangId: targetCabangId }, { cabangId: null }] } : {})
        },
        orderBy: { cabangId: 'desc' } // Prioritaskan tarif spesifik cabang
      });
      if (tarif) {
        defaultNominal = tarif.nominal;
        defaultTarifId = tarif.id;
      } else {
        defaultNominal = 0;
      }
    }

    // Ambil santri aktif
    const students = await this.p.student.findMany({
      where: {
        isActive: true,
        ...(targetCabangId ? { cabangId: targetCabangId } : {}),
        ...(user.scope === 'WILAYAH' ? { cabang: { wilayahId: user.wilayahId } } : {})
      },
      include: {
        cabang: true,
        tagihan: {
          where: {
            kategori: 'BULANAN',
            bulan,
            tahun
          }
        }
      }
    });

    let createdCount = 0;
    const jatuhTempoDate = data.jatuhTempo ? new Date(data.jatuhTempo) : new Date(tahun, bulan - 1, 10); // default tanggal 10

    for (const student of students) {
      // Jika belum ada tagihan untuk bulan & tahun ini
      if (!student.tagihan || student.tagihan.length === 0) {
        await this.p.tagihanSantri.create({
          data: {
            studentId: student.id,
            tarifId: defaultTarifId,
            cabangId: student.cabangId,
            judul: `Syahriyah ${namaBulan} ${tahun}`,
            kategori: 'BULANAN',
            bulan,
            tahun,
            nominal: defaultNominal,
            sisaBayar: defaultNominal,
            status: 'BELUM_LUNAS',
            jatuhTempo: jatuhTempoDate,
            keterangan: `Iuran bulanan Syahriyah santri periode ${namaBulan} ${tahun}`
          }
        });
        createdCount++;
      }
    }

    return {
      message: `Berhasil men-generate ${createdCount} tagihan Syahriyah ${namaBulan} ${tahun}`,
      createdCount,
      totalEligibleStudents: students.length
    };
  }

  async bayarLangsungKasir(tagihanId: string, data: { nominal?: number; metode?: 'TUNAI' | 'TRANSFER'; catatan?: string }, user: any) {
    const tagihan = await this.p.tagihanSantri.findUnique({
      where: { id: tagihanId },
      include: { student: true }
    });
    if (!tagihan) throw new NotFoundException('Tagihan tidak ditemukan');

    if (user.scope === 'CABANG' && tagihan.student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses tagihan cabang lain');
    }

    const bayarNominal = Number(data.nominal || tagihan.nominal);

    // Catat pembayaran lunas
    const pembayaran = await this.p.pembayaranSantri.create({
      data: {
        tagihanId,
        studentId: tagihan.studentId,
        nominal: bayarNominal,
        tanggalBayar: new Date(),
        metode: data.metode || 'TUNAI',
        status: 'LUNAS',
        catatanAdmin: data.catatan || 'Pembayaran langsung di Kasir/Kantor Cabang',
        verifiedById: user.id,
        verifiedAt: new Date()
      }
    });

    // Update status tagihan -> LUNAS
    const updatedTagihan = await this.p.tagihanSantri.update({
      where: { id: tagihanId },
      data: {
        status: 'LUNAS',
        sisaBayar: 0
      }
    });

    return { tagihan: updatedTagihan, pembayaran };
  }

  async verifikasiPembayaran(pembayaranId: string, data: { action: 'APPROVE' | 'REJECT'; catatanAdmin?: string }, user: any) {
    const pembayaran = await this.p.pembayaranSantri.findUnique({
      where: { id: pembayaranId },
      include: { tagihan: { include: { student: true } } }
    });
    if (!pembayaran) throw new NotFoundException('Data pembayaran tidak ditemukan');

    if (user.scope === 'CABANG' && pembayaran.tagihan.student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Tidak memiliki akses verifikasi pembayaran cabang lain');
    }

    if (data.action === 'APPROVE') {
      await this.p.pembayaranSantri.update({
        where: { id: pembayaranId },
        data: {
          status: 'LUNAS',
          catatanAdmin: data.catatanAdmin || 'Pembayaran disetujui & diverifikasi valid',
          verifiedById: user.id,
          verifiedAt: new Date()
        }
      });

      await this.p.tagihanSantri.update({
        where: { id: pembayaran.tagihanId },
        data: {
          status: 'LUNAS',
          sisaBayar: 0
        }
      });
    } else {
      await this.p.pembayaranSantri.update({
        where: { id: pembayaranId },
        data: {
          status: 'BELUM_LUNAS',
          catatanAdmin: data.catatanAdmin || 'Bukti transfer tidak valid / pembayaran ditolak',
          verifiedById: user.id,
          verifiedAt: new Date()
        }
      });

      await this.p.tagihanSantri.update({
        where: { id: pembayaran.tagihanId },
        data: {
          status: 'BELUM_LUNAS'
        }
      });
    }

    return { success: true, action: data.action };
  }

  // ═══════════════════════════════════════════════════════════
  // 4. PORTAL WALI SANTRI (WALI)
  // ═══════════════════════════════════════════════════════════

  async getWaliTagihan(userId: string, studentId: string, query?: any) {
    await this.assertOwnsStudent(userId, studentId);

    const where: any = { studentId };
    if (query?.kategori) where.kategori = query.kategori;
    if (query?.status) where.status = query.status;
    if (query?.tahun) where.tahun = Number(query.tahun);

    const tagihanList = await this.p.tagihanSantri.findMany({
      where,
      include: {
        tarif: true,
        pembayaran: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: [{ tahun: 'desc' }, { bulan: 'asc' }, { createdAt: 'desc' }]
    });

    let totalTagihan = 0;
    let totalLunas = 0;
    let totalPending = 0;
    let totalBelumLunas = 0;

    for (const t of tagihanList) {
      totalTagihan += t.nominal;
      if (t.status === 'LUNAS') totalLunas += t.nominal;
      else if (t.status === 'PENDING') totalPending += t.nominal;
      else totalBelumLunas += t.nominal;
    }

    return {
      tagihan: tagihanList,
      summary: {
        totalTagihan,
        totalLunas,
        totalPending,
        totalBelumLunas,
        count: tagihanList.length
      }
    };
  }

  async getWaliRekening(userId: string, studentId: string) {
    await this.assertOwnsStudent(userId, studentId);

    const student = await this.p.student.findUnique({
      where: { id: studentId }
    });

    const where: any = { isActive: true };
    if (student?.cabangId) {
      where.OR = [{ cabangId: student.cabangId }, { cabangId: null }];
    }

    return this.p.rekeningPembayaran.findMany({
      where,
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: [{ cabangId: 'desc' }, { bankName: 'asc' }]
    });
  }

  async submitWaliPembayaran(
    userId: string,
    studentId: string,
    data: { tagihanId: string; nominal?: number; metode?: 'TRANSFER' | 'QRIS'; buktiUrl?: string; catatanWali?: string }
  ) {
    await this.assertOwnsStudent(userId, studentId);

    const tagihan = await this.p.tagihanSantri.findUnique({
      where: { id: data.tagihanId }
    });
    if (!tagihan || tagihan.studentId !== studentId) {
      throw new NotFoundException('Tagihan santri tidak ditemukan');
    }

    if (tagihan.status === 'LUNAS') {
      throw new BadRequestException('Tagihan ini sudah lunas');
    }

    const bayarNominal = Number(data.nominal || tagihan.nominal);

    const pembayaran = await this.p.pembayaranSantri.create({
      data: {
        tagihanId: data.tagihanId,
        studentId,
        waliUserId: userId,
        nominal: bayarNominal,
        tanggalBayar: new Date(),
        metode: data.metode || 'TRANSFER',
        buktiUrl: data.buktiUrl || null,
        status: 'PENDING',
        catatanWali: data.catatanWali || null
      }
    });

    // Update status tagihan menjadi PENDING
    await this.p.tagihanSantri.update({
      where: { id: data.tagihanId },
      data: { status: 'PENDING' }
    });

    return pembayaran;
  }
}
