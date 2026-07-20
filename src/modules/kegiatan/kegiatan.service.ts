import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateKegiatanDto, UpdateKegiatanDto } from './dto/kegiatan.dto.js';
import { KegiatanStatus } from '@prisma/client';

@Injectable()
export class KegiatanService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDeadlineCleanup() {
    const now = new Date();
    try {
      const expired = await this.prisma.kegiatan.updateMany({
        where: {
          deadline: {
            lt: now
          },
          status: KegiatanStatus.ACTIVE
        },
        data: {
          status: KegiatanStatus.CLOSED
        }
      });
      if (expired.count > 0) {
        console.log(`[Cron] Automatically closed ${expired.count} expired BAP kegiatan.`);
      }
    } catch (err) {
      console.error('[Cron] Error running handleDeadlineCleanup:', err);
    }
  }

  async create(data: CreateKegiatanDto, files: any[], user: any) {
    let effectiveCabangId = data.cabangId || user.cabangId;
    if (!effectiveCabangId) {
      throw new BadRequestException('Cabang ID is required to create Kegiatan BAP');
    }

    return this.prisma.$transaction(async (tx) => {
      const kegiatan = await tx.kegiatan.create({
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi,
          ringkasan: data.ringkasan,
          jenis: data.jenis,
          deadline: new Date(data.deadline),
          status: KegiatanStatus.ACTIVE,
          cabangId: effectiveCabangId,
          asramaId: data.asramaId || null,
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
          panitia: { include: { user: true } },
          dokumen: true,
          cabang: true,
          asrama: true
        }
      });
    });
  }

  async findAll(user: any, status?: KegiatanStatus) {
    const whereClause: any = {};
    if (status) {
      whereClause.status = status;
    }
    
    // Filter by branch if user scope is CABANG
    if (user?.scope === 'CABANG') {
      whereClause.cabangId = user.cabangId;
    }

    return this.prisma.kegiatan.findMany({
      where: whereClause,
      include: {
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

    if (!kegiatan) throw new NotFoundException('Kegiatan BAP not found');

    // Access restriction for CABANG scope
    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to this BAP');
    }

    return kegiatan;
  }

  async update(id: string, data: UpdateKegiatanDto, files?: any[], user?: any) {
    const kegiatan = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!kegiatan) throw new NotFoundException('Kegiatan BAP not found');

    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to modify this BAP');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.kegiatan.update({
        where: { id },
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi,
          ringkasan: data.ringkasan,
          jenis: data.jenis,
          deadline: data.deadline ? new Date(data.deadline) : undefined,
          status: data.status,
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
    if (!kegiatan) throw new NotFoundException('Kegiatan BAP not found');

    if (user?.scope === 'CABANG' && kegiatan.cabangId !== user.cabangId) {
      throw new BadRequestException('You do not have access to delete this BAP');
    }

    return this.prisma.kegiatan.delete({ where: { id } });
  }

  async confirmKegiatan(id: string, userId: string) {
    const exists = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Kegiatan BAP not found');

    return this.prisma.kegiatan.update({
      where: { id },
      data: {
        isConfirmed: true,
        confirmedAt: new Date(),
        confirmedByUserId: userId
      },
      include: {
        cabang: true,
        asrama: true,
        confirmedByUser: {
          select: { id: true, username: true, operatorName: true }
        }
      }
    });
  }
}
