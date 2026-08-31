import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { StatusPool } from '@prisma/client';

export interface StudentFilterDto {
  cabangId?: string;
  wilayahId?: string;
  grupDaimi?: string;
  kelasDaimiId?: string;
  statusPool?: string;
  status?: 'AKTIF' | 'NONAKTIF' | 'ALL';
  search?: string;
  updatedAfter?: string;
  page?: number | string;
  limit?: number | string;
}

@Injectable()
export class PesantrenExternalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ping() {
    return {
      status: 'OK',
      service: 'eSantri - Pesantren Division Master Data API',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  async getStudents(query: StudentFilterDto) {
    const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
    const rawLimit = String(query.limit ?? '50').toLowerCase();
    const isFetchAll = rawLimit === '0' || rawLimit === 'all';
    const limit = isFetchAll ? 5000 : Math.min(500, Math.max(1, parseInt(rawLimit, 10) || 50));
    const skip = isFetchAll ? 0 : (page - 1) * limit;

    const where: any = {};

    // 1. Status Aktif
    if (query.status === 'AKTIF') {
      where.isActive = true;
    } else if (query.status === 'NONAKTIF') {
      where.isActive = false;
    }

    // 2. Status Pool (default: exclude TERSEDIA / pool bebas jika tidak dispesifikasikan)
    if (query.statusPool) {
      where.statusPool = query.statusPool as StatusPool;
    } else {
      where.statusPool = { not: 'TERSEDIA' };
    }

    // 3. Filter Cabang / Wilayah
    if (query.cabangId) {
      where.cabangId = query.cabangId;
    }
    if (query.wilayahId) {
      where.wilayahId = query.wilayahId;
    }

    // 4. Filter Grup / Kelas Daimi
    if (query.grupDaimi) {
      where.OR = [
        { grupDaimi: { contains: query.grupDaimi, mode: 'insensitive' } },
        { dataDaimi: { grup: { name: { contains: query.grupDaimi, mode: 'insensitive' } } } }
      ];
    }
    if (query.kelasDaimiId) {
      where.dataDaimi = { kelasId: query.kelasDaimiId };
    }

    // 5. Search by Nama, NIK, NISN, noGlodemy, nisLokal
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.biodata = {
        OR: [
          { fullName: { contains: s, mode: 'insensitive' } },
          { nik: { contains: s } },
          { nisn: { contains: s } },
          { noGlodemy: { contains: s, mode: 'insensitive' } },
          { nisLokal: { contains: s, mode: 'insensitive' } }
        ]
      };
    }

    // 6. Incremental Sync (updatedAfter)
    if (query.updatedAfter) {
      const date = new Date(query.updatedAfter);
      if (!isNaN(date.getTime())) {
        where.OR = [
          ...(where.OR || []),
          { daftarUlangAt: { gte: date } }
        ];
      }
    }

    const [total, rawStudents] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { cabang: { name: 'asc' } },
          { biodata: { fullName: 'asc' } }
        ],
        include: {
          biodata: true,
          cabang: {
            include: {
              wilayah: { select: { id: true, name: true } }
            }
          },
          wilayah: { select: { id: true, name: true } },
          siswaFormal: {
            include: {
              kelas: { select: { id: true, name: true, tingkat: true } }
            }
          },
          dataDaimi: {
            include: {
              grup: { select: { id: true, name: true, jenis: true } },
              kelas: { select: { id: true, name: true } }
            }
          }
        }
      })
    ]);

    const formattedData = rawStudents.map(s => this.formatStudentData(s));

    return {
      success: true,
      meta: {
        total,
        page: isFetchAll ? 1 : page,
        limit: isFetchAll ? total : limit,
        totalPages: isFetchAll ? 1 : Math.ceil(total / limit),
        timestamp: new Date().toISOString()
      },
      data: formattedData
    };
  }

  async getStudentById(identifier: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [
          { id: identifier },
          { biodata: { nik: identifier } },
          { biodata: { nisn: identifier } },
          { biodata: { noGlodemy: identifier } }
        ]
      },
      include: {
        biodata: true,
        cabang: {
          include: {
            wilayah: { select: { id: true, name: true } }
          }
        },
        wilayah: { select: { id: true, name: true } },
        siswaFormal: {
          include: {
            kelas: { select: { id: true, name: true, tingkat: true } }
          }
        },
        dataDaimi: {
          include: {
            grup: { select: { id: true, name: true, jenis: true } },
            kelas: { select: { id: true, name: true } }
          }
        },
        riwayatPendidikan: {
          include: { cabang: { select: { id: true, name: true } } },
          orderBy: { tanggalMasuk: 'desc' }
        }
      }
    });

    if (!student) {
      throw new NotFoundException(`Data siswa dengan identitas '${identifier}' tidak ditemukan.`);
    }

    return {
      success: true,
      data: this.formatStudentData(student)
    };
  }

  async getCabangList() {
    const cabangs = await this.prisma.cabang.findMany({
      orderBy: [{ wilayah: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        nameResmi: true,
        nameGlodemy: true,
        alamatProvName: true,
        alamatKabName: true,
        alamatKecName: true,
        wilayahId: true,
        wilayah: {
          select: { id: true, name: true }
        }
      }
    });

    return {
      success: true,
      total: cabangs.length,
      data: cabangs
    };
  }

  async getGrupDaimiList() {
    const [grups, kelas] = await Promise.all([
      this.prisma.grupDaimi.findMany({
        orderBy: { name: 'asc' },
        include: {
          cabang: { select: { id: true, name: true } }
        }
      }),
      this.prisma.kelasDaimi.findMany({
        orderBy: { name: 'asc' },
        include: {
          grup: { select: { id: true, name: true } },
          cabang: { select: { id: true, name: true } }
        }
      })
    ]);

    return {
      success: true,
      data: {
        grupDaimi: grups,
        kelasDaimi: kelas
      }
    };
  }

  private formatStudentData(s: any) {
    const b = s.biodata || {};
    return {
      id: s.id,
      nik: b.nik || null,
      nisn: b.nisn || null,
      nisLokal: b.nisLokal || null,
      noGlodemy: b.noGlodemy || null,
      namaLengkap: b.fullName || '',
      tempatLahir: b.tempatLahir || null,
      tanggalLahir: b.tanggalLahir ? b.tanggalLahir.toISOString().split('T')[0] : null,
      jenisKelamin: b.jenisKelamin || null,
      kewarganegaraan: b.kewarganegaraan || 'Indonesia',
      
      // Data Pesantren / Daimi
      daimi: {
        jenisSiswa: s.jenisSiswa || null,
        grupDaimi: s.grupDaimi || s.dataDaimi?.grup?.name || null,
        grupId: s.dataDaimi?.grupId || null,
        grupName: s.dataDaimi?.grup?.name || null,
        kelasId: s.dataDaimi?.kelasId || null,
        kelasName: s.dataDaimi?.kelas?.name || null,
        nisDaimi: s.dataDaimi?.nis || null,
        statusHafidz: s.statusHafidz || null
      },

      // Cabang & Wilayah Penempatan
      cabang: s.cabang ? {
        id: s.cabang.id,
        name: s.cabang.name,
        nameResmi: s.cabang.nameResmi || null,
        nameGlodemy: s.cabang.nameGlodemy || null,
        wilayahId: s.cabang.wilayahId || null,
        wilayahName: s.cabang.wilayah?.name || s.wilayah?.name || null
      } : null,

      // Data Sekolah Formal (jika ada)
      formal: s.siswaFormal ? {
        kelasId: s.siswaFormal.kelasId || null,
        kelasName: s.siswaFormal.kelas?.name || null,
        tingkat: s.siswaFormal.tingkat || null,
        nis: s.siswaFormal.nis || null,
        nisn: s.siswaFormal.nisn || null,
        isVerval: s.siswaFormal.isVerval || false
      } : null,

      // Orang Tua / Kontak
      orangTua: {
        namaAyah: b.namaAyah || null,
        nikAyah: b.nikAyah || null,
        pekerjaanAyah: b.pekerjaanAyah || null,
        statusHidupAyah: b.statusHidupAyah || null,
        namaIbu: b.namaIbu || null,
        nikIbu: b.nikIbu || null,
        pekerjaanIbu: b.pekerjaanIbu || null,
        statusHidupIbu: b.statusHidupIbu || null,
        phone: b.phone || null,
        kontakDaruratNama: b.kontakDaruratNama || null,
        kontakDaruratTelp: b.kontakDaruratTelp || null,
        kontakDaruratHubungan: b.kontakDaruratHubungan || null
      },

      // Alamat
      alamat: {
        jalan: b.alamatJalan || b.address || null,
        provinsi: b.alamatProvName || null,
        kabupaten: b.alamatKabName || null,
        kecamatan: b.alamatKecName || null,
        kelurahan: b.alamatKelName || null
      },

      // Status Akademik
      status: {
        isActive: s.isActive,
        statusPool: s.statusPool,
        daftarUlangAt: s.daftarUlangAt ? s.daftarUlangAt.toISOString() : null,
        daftarUlangTahunAjaran: s.daftarUlangTahunAjaran || null,
        daftarUlangSemester: s.daftarUlangSemester || null
      },

      fotoUrl: b.fotoUrl || null
    };
  }
}
