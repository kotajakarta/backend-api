import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class KegiatanService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // CABANG hanya boleh akses BAP kegiatan cabangnya sendiri, WILAYAH hanya di wilayahnya
  private async checkKegiatanScope(user: any, kegiatan: { cabangId: string }) {
    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('Anda tidak memiliki akses ke BAP kegiatan ini.');
    }
    if (user?.scope === 'WILAYAH') {
      const cabang = await this.prisma.cabang.findUnique({ where: { id: kegiatan.cabangId }, select: { wilayahId: true } });
      if (!cabang || cabang.wilayahId !== user.wilayahId) {
        throw new BadRequestException('Anda tidak memiliki akses ke BAP kegiatan ini.');
      }
    }
  }

  // === CRUD JENIS KEGIATAN ===

  async findJenisAll() {
    return this.prisma.jenisKegiatan.findMany({
      orderBy: { nama: 'asc' }
    });
  }

  async createJenis(data: { nama: string }) {
    const existing = await this.prisma.jenisKegiatan.findUnique({
      where: { nama: data.nama }
    });
    if (existing) {
      throw new BadRequestException('Jenis kegiatan dengan nama tersebut sudah ada.');
    }
    return this.prisma.jenisKegiatan.create({
      data: { nama: data.nama }
    });
  }

  async updateJenis(id: string, data: { nama: string }) {
    const exists = await this.prisma.jenisKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Jenis kegiatan tidak ditemukan.');

    const duplicate = await this.prisma.jenisKegiatan.findFirst({
      where: { nama: data.nama, id: { not: id } }
    });
    if (duplicate) {
      throw new BadRequestException('Jenis kegiatan dengan nama tersebut sudah digunakan.');
    }

    return this.prisma.jenisKegiatan.update({
      where: { id },
      data: { nama: data.nama }
    });
  }

  async removeJenis(id: string) {
    const exists = await this.prisma.jenisKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Jenis kegiatan tidak ditemukan.');

    const used = await this.prisma.templateKegiatan.findFirst({ where: { jenisId: id } });
    if (used) {
      throw new BadRequestException('Jenis kegiatan tidak bisa dihapus karena sedang digunakan dalam template kegiatan.');
    }

    return this.prisma.jenisKegiatan.delete({ where: { id } });
  }


  // === CRUD TEMPLATE KEGIATAN (Dengan Multi-Upload File dari Pusat) ===

  async findTemplateAll() {
    return this.prisma.templateKegiatan.findMany({
      include: {
        jenis: true,
        dokumen: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createTemplate(data: any, files: any[]) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.templateKegiatan.create({
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi || null,
          deadline: new Date(data.deadline),
          jenisId: data.jenisId,
          tanggalKegiatan: data.tanggalKegiatan ? new Date(data.tanggalKegiatan) : null,
          waktuKegiatan: data.waktuKegiatan || null,
          tujuanKegiatan: data.tujuanKegiatan || null,
          tema: data.tema || null,
          latarBelakang: data.latarBelakang || null,
          bentukKegiatan: data.bentukKegiatan || null,
          rangkaianKegiatan: data.rangkaianKegiatan || null,
          hasilPelaksanaan: data.hasilPelaksanaan || null,
          penutup: data.penutup || null,
        }
      });

      if (files && files.length > 0) {
        for (const file of files) {
          const isPhoto = file.mimetype.startsWith('image/');
          await tx.dokumenTemplate.create({
            data: {
              templateId: template.id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: isPhoto ? 'PHOTO' : 'DOCUMENT'
            }
          });
        }
      }

      return tx.templateKegiatan.findUnique({
        where: { id: template.id },
        include: {
          jenis: true,
          dokumen: true
        }
      });
    });
  }

  async updateTemplate(id: string, data: any, files?: any[]) {
    const exists = await this.prisma.templateKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template kegiatan tidak ditemukan.');

    return this.prisma.$transaction(async (tx) => {
      await tx.templateKegiatan.update({
        where: { id },
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi !== undefined ? data.deskripsi : undefined,
          deadline: data.deadline ? new Date(data.deadline) : undefined,
          jenisId: data.jenisId,
          tanggalKegiatan: data.tanggalKegiatan !== undefined ? (data.tanggalKegiatan ? new Date(data.tanggalKegiatan) : null) : undefined,
          waktuKegiatan: data.waktuKegiatan !== undefined ? data.waktuKegiatan : undefined,
          tujuanKegiatan: data.tujuanKegiatan !== undefined ? data.tujuanKegiatan : undefined,
          tema: data.tema !== undefined ? data.tema : undefined,
          latarBelakang: data.latarBelakang !== undefined ? data.latarBelakang : undefined,
          bentukKegiatan: data.bentukKegiatan !== undefined ? data.bentukKegiatan : undefined,
          rangkaianKegiatan: data.rangkaianKegiatan !== undefined ? data.rangkaianKegiatan : undefined,
          hasilPelaksanaan: data.hasilPelaksanaan !== undefined ? data.hasilPelaksanaan : undefined,
          penutup: data.penutup !== undefined ? data.penutup : undefined,
        }
      });

      if (files && files.length > 0) {
        for (const file of files) {
          const isPhoto = file.mimetype.startsWith('image/');
          await tx.dokumenTemplate.create({
            data: {
              templateId: id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: isPhoto ? 'PHOTO' : 'DOCUMENT'
            }
          });
        }
      }

      return tx.templateKegiatan.findUnique({
        where: { id },
        include: {
          jenis: true,
          dokumen: true
        }
      });
    });
  }

  async removeTemplate(id: string) {
    const exists = await this.prisma.templateKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template kegiatan tidak ditemukan.');

    return this.prisma.templateKegiatan.delete({ where: { id } });
  }

  async removeTemplateDokumen(id: string) {
    return this.prisma.dokumenTemplate.delete({ where: { id } });
  }

  async getDashboardStats(user: any) {
    const totalTemplates = await this.prisma.templateKegiatan.count();
    const totalCabang = await this.prisma.cabang.count();
    const totalBapSubmitted = await this.prisma.kegiatan.count();
    const totalBapConfirmed = await this.prisma.kegiatan.count({ where: { isConfirmed: true } });
    const totalBapPending = Math.max(0, totalBapSubmitted - totalBapConfirmed);

    const baps = await this.prisma.kegiatan.findMany({
      include: {
        cabang: { select: { id: true, name: true } },
        template: { include: { jenis: true } }
      }
    });

    let totalSantriTerjangkau = 0;
    let totalGuruTerjangkau = 0;
    let totalPesertaTerjangkau = 0;

    const cabangMap: Record<string, { cabangName: string; totalBap: number; totalPeserta: number }> = {};
    const templateMap: Record<string, {
      templateId: string;
      judul: string;
      jenisNama: string;
      deadline: Date;
      totalReported: number;
      totalConfirmed: number;
      totalSantri: number;
      totalGuru: number;
    }> = {};

    baps.forEach(b => {
      const santri = b.totalSantri || 0;
      const guru = b.totalGuru || 0;
      const peserta = b.jumlahPeserta || (santri + guru);

      totalSantriTerjangkau += santri;
      totalGuruTerjangkau += guru;
      totalPesertaTerjangkau += peserta;

      if (b.cabang) {
        if (!cabangMap[b.cabang.id]) {
          cabangMap[b.cabang.id] = { cabangName: b.cabang.name, totalBap: 0, totalPeserta: 0 };
        }
        cabangMap[b.cabang.id].totalBap += 1;
        cabangMap[b.cabang.id].totalPeserta += peserta;
      }

      if (b.template) {
        if (!templateMap[b.template.id]) {
          templateMap[b.template.id] = {
            templateId: b.template.id,
            judul: b.template.judul,
            jenisNama: b.template.jenis?.nama || 'Lainnya',
            deadline: b.template.deadline,
            totalReported: 0,
            totalConfirmed: 0,
            totalSantri: 0,
            totalGuru: 0
          };
        }
        templateMap[b.template.id].totalReported += 1;
        if (b.isConfirmed) templateMap[b.template.id].totalConfirmed += 1;
        templateMap[b.template.id].totalSantri += santri;
        templateMap[b.template.id].totalGuru += guru;
      }
    });

    const jenisList = await this.prisma.jenisKegiatan.findMany({
      include: {
        templates: {
          include: {
            kegiatan: true
          }
        }
      }
    });

    const byJenis = jenisList.map(j => {
      let bapCount = 0;
      let confirmedCount = 0;
      j.templates.forEach(t => {
        bapCount += t.kegiatan.length;
        confirmedCount += t.kegiatan.filter(k => k.isConfirmed).length;
      });

      return {
        id: j.id,
        jenisName: j.nama,
        templateCount: j.templates.length,
        bapCount,
        confirmedCount
      };
    });

    const topCabang = Object.values(cabangMap)
      .sort((a, b) => b.totalBap - a.totalBap)
      .slice(0, 10);

    const expectedTotalSubmissions = totalTemplates * Math.max(totalCabang, 1);
    const completionRate = expectedTotalSubmissions > 0
      ? Math.min(100, Math.round((totalBapSubmitted / expectedTotalSubmissions) * 100))
      : 0;

    // Aggregation by Wilayah and by Cabang
    const allWilayah = await this.prisma.wilayah.findMany({
      include: {
        cabangs: {
          select: {
            id: true,
            name: true,
            wilayahId: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const allCabang = await this.prisma.cabang.findMany({
      include: {
        wilayah: { select: { id: true, name: true } },
        kegiatan: {
          select: {
            id: true,
            isConfirmed: true,
            totalSantri: true,
            totalGuru: true,
            jumlahPeserta: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // 1. Cabang progress breakdown
    const byCabangProgress = allCabang.map(c => {
      const submitted = c.kegiatan.length;
      const confirmed = c.kegiatan.filter(k => k.isConfirmed).length;
      let santri = 0;
      let guru = 0;
      let totalPeserta = 0;

      c.kegiatan.forEach(k => {
        const s = k.totalSantri || 0;
        const g = k.totalGuru || 0;
        santri += s;
        guru += g;
        totalPeserta += k.jumlahPeserta || (s + g);
      });

      const rate = totalTemplates > 0 ? Math.min(100, Math.round((submitted / totalTemplates) * 100)) : 0;
      let status = 'BELUM_ADA';
      if (rate >= 100) status = 'SELESAI';
      else if (submitted > 0) status = 'SEBAGIAN';

      return {
        cabangId: c.id,
        cabangName: c.name,
        wilayahId: c.wilayahId || 'tanpa-wilayah',
        wilayahName: c.wilayah?.name || 'Tanpa Wilayah',
        totalBapSubmitted: submitted,
        totalBapConfirmed: confirmed,
        totalSantri: santri,
        totalGuru: guru,
        totalPeserta: totalPeserta,
        completionRate: rate,
        status: status
      };
    });

    // 2. Wilayah progress breakdown
    const byWilayah = allWilayah.map(w => {
      const cabangInWilayah = byCabangProgress.filter(c => c.wilayahId === w.id);
      const totalCabangInWilayah = cabangInWilayah.length;

      let submittedBap = 0;
      let confirmedBap = 0;
      let santri = 0;
      let guru = 0;
      let totalPeserta = 0;
      let activeCabangCount = 0;

      cabangInWilayah.forEach(c => {
        if (c.totalBapSubmitted > 0) activeCabangCount += 1;
        submittedBap += c.totalBapSubmitted;
        confirmedBap += c.totalBapConfirmed;
        santri += c.totalSantri;
        guru += c.totalGuru;
        totalPeserta += c.totalPeserta;
      });

      const expectedWilayahBaps = totalTemplates * Math.max(totalCabangInWilayah, 1);
      const rate = expectedWilayahBaps > 0
        ? Math.min(100, Math.round((submittedBap / expectedWilayahBaps) * 100))
        : 0;

      return {
        wilayahId: w.id,
        wilayahName: w.name,
        totalCabang: totalCabangInWilayah,
        activeCabangCount,
        totalBapSubmitted: submittedBap,
        totalBapConfirmed: confirmedBap,
        totalSantri: santri,
        totalGuru: guru,
        totalPeserta: totalPeserta,
        completionRate: rate
      };
    });

    return {
      summary: {
        totalTemplates,
        totalCabang,
        totalBapSubmitted,
        totalBapConfirmed,
        totalBapPending,
        totalSantriTerjangkau,
        totalGuruTerjangkau,
        totalPesertaTerjangkau,
        completionRate
      },
      charts: {
        byJenis,
        topCabang,
        byTemplate: Object.values(templateMap),
        byWilayah,
        byCabangProgress,
        byStatus: {
          confirmed: totalBapConfirmed,
          pending: totalBapPending,
          expectedMissing: Math.max(0, expectedTotalSubmissions - totalBapSubmitted)
        }
      }
    };
  }


  // === TRANSAKSI BAP KEGIATAN CABANG (Dengan Multi-Upload File dari Cabang) ===

  private getFileType(file: any): string {
    if (file.fieldname === 'photoFiles') {
      return 'PHOTO';
    }
    if (file.fieldname === 'suratPengantarFiles') {
      return 'SURAT_PENGANTAR';
    }
    if (file.fieldname === 'docFiles') {
      return 'DOCUMENT';
    }
    return file.mimetype?.startsWith('image/') ? 'PHOTO' : 'DOCUMENT';
  }

  async create(data: any, files: any[], user: any) {
    let cabangId = user.cabangId;
    if (user.scope === 'GLOBAL' && data.cabangId) {
      cabangId = data.cabangId;
    }
    if (!cabangId && user.scope === 'CABANG') {
      throw new ForbiddenException('User cabang tidak memiliki cabangId yang valid');
    }

    const template = await this.prisma.templateKegiatan.findUnique({
      where: { id: data.templateId }
    });
    if (!template) throw new NotFoundException('Template kegiatan tidak ditemukan');

    const totalSantri = data.totalSantri !== undefined ? Number(data.totalSantri) : null;
    const totalGuru = data.totalGuru !== undefined ? Number(data.totalGuru) : null;
    const jumlahPeserta = data.jumlahPeserta !== undefined ? Number(data.jumlahPeserta) : (totalSantri || 0) + (totalGuru || 0);

    return this.prisma.$transaction(async (tx) => {
      const kegiatan = await tx.kegiatan.create({
        data: {
          templateId: data.templateId,
          cabangId: cabangId,
          asramaId: data.asramaId || null,
          deskripsi: data.deskripsi || template.bentukKegiatan || template.judul,
          tanggalKegiatan: data.tanggalKegiatan ? new Date(data.tanggalKegiatan) : null,
          waktuKegiatan: data.waktuKegiatan || null,
          tempatKegiatan: data.tempatKegiatan || null,
          totalSantri: totalSantri,
          totalGuru: totalGuru,
          jumlahPeserta: jumlahPeserta,
          bentukKegiatan: data.bentukKegiatan || null,
          rangkaianKegiatan: data.rangkaianKegiatan || null,
          hasilPelaksanaan: data.hasilPelaksanaan || null,
          evaluasiBaik: data.evaluasiBaik || null,
          evaluasiPerbaikan: data.evaluasiPerbaikan || null,
          ringkasanKegiatan: data.ringkasanKegiatan || null,
          kesimpulan: data.kesimpulan || null,
        }
      });

      if (data.ketuaPanitiaId) {
        await tx.panitia.create({
          data: {
            kegiatanId: kegiatan.id,
            staffId: data.ketuaPanitiaId,
            jabatan: 'KETUA'
          }
        });
      }
      if (data.sekretarisPanitiaId) {
        await tx.panitia.create({
          data: {
            kegiatanId: kegiatan.id,
            staffId: data.sekretarisPanitiaId,
            jabatan: 'SEKRETARIS'
          }
        });
      }
      if (data.bendaharaPanitiaId) {
        await tx.panitia.create({
          data: {
            kegiatanId: kegiatan.id,
            staffId: data.bendaharaPanitiaId,
            jabatan: 'BENDAHARA'
          }
        });
      }

      if (files && files.length > 0) {
        for (const file of files) {
          const fileType = this.getFileType(file);
          await tx.dokumenKegiatan.create({
            data: {
              kegiatanId: kegiatan.id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: fileType
            }
          });
        }
      }

      return tx.kegiatan.findUnique({
        where: { id: kegiatan.id },
        include: {
          template: {
            include: {
              jenis: true,
              dokumen: true
            }
          },
          panitia: { include: { staff: true } },
          dokumen: true,
          cabang: true,
          asrama: true
        }
      });
    });
  }

  async findAll(user: any) {
    const whereClause: any = {};
    if (user?.scope === 'CABANG') {
      whereClause.cabangId = user.cabangId;
    } else if (user?.scope === 'WILAYAH') {
      whereClause.cabang = { wilayahId: user.wilayahId };
    }

    return this.prisma.kegiatan.findMany({
      where: whereClause,
      include: {
        template: {
          include: {
            jenis: true,
            dokumen: true
          }
        },
        panitia: {
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                position: true
              }
            }
          }
        },
        dokumen: true,
        cabang: true,
        asrama: true,
        confirmedByUser: {
          select: {
            id: true,
            username: true,
            operatorName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string, user: any) {
    const kegiatan = await this.prisma.kegiatan.findUnique({
      where: { id },
      include: {
        template: {
          include: {
            jenis: true,
            dokumen: true
          }
        },
        panitia: {
          include: {
            staff: {
              select: {
                id: true,
                name: true,
                position: true
              }
            }
          }
        },
        dokumen: true,
        cabang: true,
        asrama: true,
        confirmedByUser: {
          select: {
            id: true,
            username: true,
            operatorName: true
          }
        }
      }
    });

    if (!kegiatan) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    await this.checkKegiatanScope(user, kegiatan);

    return kegiatan;
  }

  async update(id: string, data: any, files?: any[], user?: any) {
    const kegiatan = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!kegiatan) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    await this.checkKegiatanScope(user, kegiatan);

    if (user?.scope === 'CABANG' && kegiatan.isConfirmed) {
      throw new ForbiddenException('Laporan BAP yang telah diterima/disetujui oleh Pusat tidak dapat diubah lagi oleh Cabang.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.kegiatan.update({
        where: { id },
        data: {
          deskripsi: data.deskripsi !== undefined ? data.deskripsi : undefined,
          asramaId: data.asramaId !== undefined ? data.asramaId : undefined,
          tanggalKegiatan: data.tanggalKegiatan !== undefined ? (data.tanggalKegiatan ? new Date(data.tanggalKegiatan) : null) : undefined,
          waktuKegiatan: data.waktuKegiatan !== undefined ? data.waktuKegiatan : undefined,
          tempatKegiatan: data.tempatKegiatan !== undefined ? data.tempatKegiatan : undefined,
          jumlahPeserta: data.jumlahPeserta !== undefined ? (data.jumlahPeserta ? Number(data.jumlahPeserta) : null) : undefined,
          totalSantri: data.totalSantri !== undefined ? (data.totalSantri ? Number(data.totalSantri) : null) : undefined,
          totalGuru: data.totalGuru !== undefined ? (data.totalGuru ? Number(data.totalGuru) : null) : undefined,
          evaluasiBaik: data.evaluasiBaik !== undefined ? data.evaluasiBaik : undefined,
          evaluasiPerbaikan: data.evaluasiPerbaikan !== undefined ? data.evaluasiPerbaikan : undefined,
          bentukKegiatan: data.bentukKegiatan !== undefined ? data.bentukKegiatan : undefined,
          rangkaianKegiatan: data.rangkaianKegiatan !== undefined ? data.rangkaianKegiatan : undefined,
          hasilPelaksanaan: data.hasilPelaksanaan !== undefined ? data.hasilPelaksanaan : undefined,
          ringkasanKegiatan: data.ringkasanKegiatan !== undefined ? data.ringkasanKegiatan : undefined,
          kesimpulan: data.kesimpulan !== undefined ? data.kesimpulan : undefined,
        }
      });

      if (data.ketuaPanitiaId || data.sekretarisPanitiaId || data.bendaharaPanitiaId) {
        await tx.panitia.deleteMany({
          where: { kegiatanId: id }
        });
        if (data.ketuaPanitiaId) {
          await tx.panitia.create({
            data: {
              kegiatanId: id,
              staffId: data.ketuaPanitiaId,
              jabatan: 'KETUA'
            }
          });
        }
        if (data.sekretarisPanitiaId) {
          await tx.panitia.create({
            data: {
              kegiatanId: id,
              staffId: data.sekretarisPanitiaId,
              jabatan: 'SEKRETARIS'
            }
          });
        }
        if (data.bendaharaPanitiaId) {
          await tx.panitia.create({
            data: {
              kegiatanId: id,
              staffId: data.bendaharaPanitiaId,
              jabatan: 'BENDAHARA'
            }
          });
        }
      }

      if (files && files.length > 0) {
        for (const file of files) {
          const fileType = this.getFileType(file);
          await tx.dokumenKegiatan.create({
            data: {
              kegiatanId: id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: fileType
            }
          });
        }
      }

      return tx.kegiatan.findUnique({
        where: { id },
        include: {
          template: {
            include: {
              jenis: true,
              dokumen: true
            }
          },
          panitia: { include: { staff: true } },
          dokumen: true,
          cabang: true,
          asrama: true
        }
      });
    });
  }

  async remove(id: string, user: any) {
    const kegiatan = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!kegiatan) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    await this.checkKegiatanScope(user, kegiatan);

    if (user?.scope === 'CABANG' && kegiatan.isConfirmed) {
      throw new ForbiddenException('Laporan BAP yang telah diterima/disetujui oleh Pusat tidak dapat dihapus.');
    }

    return this.prisma.kegiatan.delete({ where: { id } });
  }

  async removeKegiatanDokumen(dokumenId: string, user: any) {
    const doc = await this.prisma.dokumenKegiatan.findUnique({
      where: { id: dokumenId },
      include: { kegiatan: { select: { cabangId: true, isConfirmed: true } } }
    });
    if (!doc) throw new NotFoundException('Dokumen tidak ditemukan.');

    await this.checkKegiatanScope(user, doc.kegiatan);
    if (user.scope === 'CABANG' && doc.kegiatan.isConfirmed) {
      throw new ForbiddenException('Dokumen BAP yang telah diterima/disetujui oleh Pusat tidak dapat dihapus.');
    }

    // Try to remove the physical file
    try {
      const uploadDir = path.join(process.cwd(), 'uploads/kegiatan');
      const filename = path.basename(doc.filePath);
      const fullPath = path.join(uploadDir, filename);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (_) {
      // Ignore file system errors
    }

    return this.prisma.dokumenKegiatan.delete({ where: { id: dokumenId } });
  }

  async confirmKegiatan(id: string, userId: string) {
    const exists = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    return this.prisma.kegiatan.update({
      where: { id },
      data: {
        isConfirmed: true,
        confirmedAt: new Date(),
        confirmedByUserId: userId
      },
      include: {
        template: {
          include: {
            jenis: true,
            dokumen: true
          }
        },
        cabang: true,
        asrama: true,
        confirmedByUser: {
          select: { id: true, username: true, operatorName: true }
        }
      }
    });
  }

  async unconfirmKegiatan(id: string) {
    const exists = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    return this.prisma.kegiatan.update({
      where: { id },
      data: {
        isConfirmed: false,
        confirmedAt: null,
        confirmedByUserId: null
      },
      include: {
        template: {
          include: {
            jenis: true,
            dokumen: true
          }
        },
        cabang: true,
        asrama: true,
        panitia: { include: { staff: true } },
        dokumen: true
      }
    });
  }
}
