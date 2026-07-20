import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CreateKegiatanDto, UpdateKegiatanDto, CreateJenisKegiatanDto, UpdateJenisKegiatanDto, CreateTemplateKegiatanDto, UpdateTemplateKegiatanDto } from './dto/kegiatan.dto.js';

@Injectable()
export class KegiatanService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // === CRUD JENIS KEGIATAN ===

  async findJenisAll() {
    return this.prisma.jenisKegiatan.findMany({
      orderBy: { nama: 'asc' }
    });
  }

  async createJenis(data: CreateJenisKegiatanDto) {
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

  async updateJenis(id: string, data: UpdateJenisKegiatanDto) {
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

    // Check if used in any template
    const used = await this.prisma.templateKegiatan.findFirst({ where: { jenisId: id } });
    if (used) {
      throw new BadRequestException('Jenis kegiatan tidak bisa dihapus karena sedang digunakan dalam template kegiatan.');
    }

    return this.prisma.jenisKegiatan.delete({ where: { id } });
  }


  // === CRUD TEMPLATE KEGIATAN ===

  async findTemplateAll() {
    return this.prisma.templateKegiatan.findMany({
      include: { jenis: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createTemplate(data: CreateTemplateKegiatanDto) {
    return this.prisma.templateKegiatan.create({
      data: {
        judul: data.judul,
        deskripsi: data.deskripsi,
        deadline: new Date(data.deadline),
        jenisId: data.jenisId
      },
      include: { jenis: true }
    });
  }

  async updateTemplate(id: string, data: UpdateTemplateKegiatanDto) {
    const exists = await this.prisma.templateKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template kegiatan tidak ditemukan.');

    return this.prisma.templateKegiatan.update({
      where: { id },
      data: {
        judul: data.judul,
        deskripsi: data.deskripsi,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
        jenisId: data.jenisId
      },
      include: { jenis: true }
    });
  }

  async removeTemplate(id: string) {
    const exists = await this.prisma.templateKegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Template kegiatan tidak ditemukan.');

    return this.prisma.templateKegiatan.delete({ where: { id } });
  }


  // === TRANSAKSI BAP KEGIATAN CABANG ===

  async create(data: CreateKegiatanDto, files: any[], user: any) {
    let effectiveCabangId = data.cabangId || user.cabangId;
    if (!effectiveCabangId) {
      throw new BadRequestException('Cabang ID is required to submit Kegiatan BAP');
    }

    // Check template exists
    const template = await this.prisma.templateKegiatan.findUnique({ where: { id: data.templateId } });
    if (!template) {
      throw new NotFoundException('Template kegiatan tidak ditemukan.');
    }

    // Check if BAP for this template and branch already exists
    const existingBAP = await this.prisma.kegiatan.findFirst({
      where: {
        templateId: data.templateId,
        cabangId: effectiveCabangId
      }
    });
    if (existingBAP) {
      throw new BadRequestException('Cabang Anda sudah mengirimkan laporan BAP untuk kegiatan ini.');
    }

    return this.prisma.$transaction(async (tx) => {
      const kegiatan = await tx.kegiatan.create({
        data: {
          templateId: data.templateId,
          cabangId: effectiveCabangId,
          asramaId: data.asramaId || null,
          deskripsi: data.deskripsi,
        }
      });

      await tx.panitia.create({
        data: {
          kegiatanId: kegiatan.id,
          userId: data.ketuaPanitiaId,
          jabatan: 'KETUA'
        }
      });

      if (files && files.length > 0) {
        for (const file of files) {
          const isPhoto = file.mimetype.startsWith('image/');
          await tx.dokumenKegiatan.create({
            data: {
              kegiatanId: kegiatan.id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: isPhoto ? 'PHOTO' : 'DOCUMENT'
            }
          });
        }
      }

      return tx.kegiatan.findUnique({
        where: { id: kegiatan.id },
        include: {
          template: { include: { jenis: true } },
          panitia: { include: { user: true } },
          dokumen: true,
          cabang: true,
          asrama: true
        }
      });
    });
  }

  async findAll(user: any) {
    const whereClause: any = {};
    
    // Filter by branch if user scope is CABANG
    if (user?.scope === 'CABANG') {
      whereClause.cabangId = user.cabangId;
    }

    return this.prisma.kegiatan.findMany({
      where: whereClause,
      include: {
        template: {
          include: { jenis: true }
        },
        panitia: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                operatorName: true
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
          include: { jenis: true }
        },
        panitia: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                operatorName: true
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

    // Access restriction for CABANG scope
    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to this BAP');
    }

    return kegiatan;
  }

  async update(id: string, data: UpdateKegiatanDto, files?: any[], user?: any) {
    const kegiatan = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!kegiatan) throw new NotFoundException('Laporan BAP kegiatan tidak ditemukan');

    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to modify this BAP');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.kegiatan.update({
        where: { id },
        data: {
          deskripsi: data.deskripsi,
          asramaId: data.asramaId !== undefined ? data.asramaId : undefined,
        }
      });

      if (data.ketuaPanitiaId) {
        await tx.panitia.deleteMany({
          where: { kegiatanId: id, jabatan: 'KETUA' }
        });
        await tx.panitia.create({
          data: {
            kegiatanId: id,
            userId: data.ketuaPanitiaId,
            jabatan: 'KETUA'
          }
        });
      }

      if (files && files.length > 0) {
        for (const file of files) {
          const isPhoto = file.mimetype.startsWith('image/');
          await tx.dokumenKegiatan.create({
            data: {
              kegiatanId: id,
              filePath: `/kegiatan/uploads/${file.filename}`,
              fileName: file.originalname,
              fileType: isPhoto ? 'PHOTO' : 'DOCUMENT'
            }
          });
        }
      }

      return tx.kegiatan.findUnique({
        where: { id },
        include: {
          template: { include: { jenis: true } },
          panitia: { include: { user: true } },
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

    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to delete this BAP');
    }

    return this.prisma.kegiatan.delete({ where: { id } });
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
        template: { include: { jenis: true } },
        cabang: true,
        asrama: true,
        confirmedByUser: {
          select: { id: true, username: true, operatorName: true }
        }
      }
    });
  }
}
