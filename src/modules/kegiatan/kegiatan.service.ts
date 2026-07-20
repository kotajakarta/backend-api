import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateKegiatanDto, UpdateKegiatanDto } from './dto/kegiatan.dto.js';
import { KegiatanStatus } from '@prisma/client';

@Injectable()
export class KegiatanService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Cron Job to automatically close expired activities every minute
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
        console.log(`[Cron] Automatically closed ${expired.count} expired kegiatan.`);
      }
    } catch (err) {
      console.error('[Cron] Error running handleDeadlineCleanup:', err);
    }
  }

  async create(data: CreateKegiatanDto, files: any[]) {
    return this.prisma.$transaction(async (tx) => {
      const kegiatan = await tx.kegiatan.create({
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi,
          ringkasan: data.ringkasan,
          jenis: data.jenis,
          deadline: new Date(data.deadline),
          status: KegiatanStatus.ACTIVE
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

      if (data.asramaIds && data.asramaIds.length > 0) {
        for (const asramaId of data.asramaIds) {
          await tx.notifikasiAsrama.create({
            data: {
              kegiatanId: kegiatan.id,
              asramaId: asramaId,
              isConfirmed: false
            }
          });
        }
      }

      return tx.kegiatan.findUnique({
        where: { id: kegiatan.id },
        include: {
          panitia: { include: { user: true } },
          dokumen: true,
          notifikasi: { include: { asrama: true } }
        }
      });
    });
  }

  async findAll(status?: KegiatanStatus) {
    return this.prisma.kegiatan.findMany({
      where: status ? { status } : undefined,
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
        notifikasi: {
          include: {
            asrama: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
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
        notifikasi: {
          include: {
            asrama: true,
            confirmedByUser: {
              select: {
                id: true,
                username: true,
                operatorName: true
              }
            }
          }
        }
      }
    });

    if (!kegiatan) throw new NotFoundException('Kegiatan not found');
    return kegiatan;
  }

  async update(id: string, data: UpdateKegiatanDto, files?: any[]) {
    const kegiatan = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!kegiatan) throw new NotFoundException('Kegiatan not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.kegiatan.update({
        where: { id },
        data: {
          judul: data.judul,
          deskripsi: data.deskripsi,
          ringkasan: data.ringkasan,
          jenis: data.jenis,
          deadline: data.deadline ? new Date(data.deadline) : undefined,
          status: data.status
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

      if (data.asramaIds) {
        await tx.notifikasiAsrama.deleteMany({
          where: { kegiatanId: id, isConfirmed: false }
        });
        
        for (const asramaId of data.asramaIds) {
          const exists = await tx.notifikasiAsrama.findFirst({
            where: { kegiatanId: id, asramaId }
          });
          if (!exists) {
            await tx.notifikasiAsrama.create({
              data: {
                kegiatanId: id,
                asramaId,
                isConfirmed: false
              }
            });
          }
        }
      }

      return tx.kegiatan.findUnique({
        where: { id },
        include: {
          panitia: { include: { user: true } },
          dokumen: true,
          notifikasi: { include: { asrama: true } }
        }
      });
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.kegiatan.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Kegiatan not found');
    return this.prisma.kegiatan.delete({ where: { id } });
  }

  async getNotifikasiAsrama(asramaId?: string) {
    return this.prisma.notifikasiAsrama.findMany({
      where: asramaId ? { asramaId } : undefined,
      include: {
        kegiatan: {
          include: {
            panitia: {
              include: {
                user: {
                  select: { id: true, username: true, operatorName: true }
                }
              }
            },
            dokumen: true
          }
        },
        asrama: true,
        confirmedByUser: {
          select: { id: true, username: true, operatorName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async confirmNotifikasi(notifikasiId: string, userId: string) {
    const exists = await this.prisma.notifikasiAsrama.findUnique({ where: { id: notifikasiId } });
    if (!exists) throw new NotFoundException('Notifikasi not found');

    return this.prisma.notifikasiAsrama.update({
      where: { id: notifikasiId },
      data: {
        isConfirmed: true,
        confirmedAt: new Date(),
        confirmedByUserId: userId
      },
      include: {
        kegiatan: true,
        asrama: true,
        confirmedByUser: {
          select: { id: true, username: true, operatorName: true }
        }
      }
    });
  }
}
