import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class PesantrenService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async getGrupDaimi() {
    return this.prisma.grupDaimi.findMany({
      orderBy: { name: 'asc' },
      include: {
        ketua: true,
        dataDaimi: {
          include: {
            student: {
              include: {
                biodata: true
              }
            }
          }
        }
      }
    });
  }

  async createGrupDaimi(data: { name: string; jenis?: string; ketuaId?: string }) {
    return this.prisma.grupDaimi.create({
      data: {
        name: data.name,
        jenis: data.jenis || null,
        ketuaId: data.ketuaId || null,
      }
    });
  }

  async updateGrupDaimi(id: string, data: { name: string; jenis?: string; ketuaId?: string }) {
    const existing = await this.prisma.grupDaimi.findUnique({ where: { id } });
    const result = await this.prisma.grupDaimi.update({
      where: { id },
      data: {
        name: data.name,
        jenis: data.jenis !== undefined ? data.jenis : undefined,
        ketuaId: data.ketuaId !== undefined ? data.ketuaId : undefined,
      }
    });

    if (existing && existing.name !== data.name) {
      const studentRelations = await this.prisma.dataDaimi.findMany({
        where: { grupId: id }
      });
      const studentIds = studentRelations.map(sr => sr.studentId);
      if (studentIds.length > 0) {
        await this.prisma.student.updateMany({
          where: { id: { in: studentIds } },
          data: { grupDaimi: data.name }
        });
      }
    }

    return result;
  }

  async deleteGrupDaimi(id: string) {
    return this.prisma.grupDaimi.delete({
      where: { id }
    });
  }

  // Student Assignment APIs for Daimi Group
  async getStudentsInGrupDaimi(grupId: string) {
    const dataDaimiList = await this.prisma.dataDaimi.findMany({
      where: { grupId },
      include: {
        student: {
          include: {
            biodata: true,
            cabang: true
          }
        }
      }
    });
    return dataDaimiList.map(dd => dd.student);
  }

  async addStudentToGrupDaimi(grupId: string, studentId: string) {
    const grup = await this.prisma.grupDaimi.findUnique({ where: { id: grupId } });
    if (!grup) throw new NotFoundException('Grup Daimi tidak ditemukan');

    const existing = await this.prisma.dataDaimi.findUnique({
      where: { studentId }
    });

    if (existing) {
      await this.prisma.dataDaimi.update({
        where: { studentId },
        data: { grupId }
      });
    } else {
      await this.prisma.dataDaimi.create({
        data: { studentId, grupId }
      });
    }

    await this.prisma.student.update({
      where: { id: studentId },
      data: { grupDaimi: grup.name }
    });

    return { success: true };
  }

  async removeStudentFromGrupDaimi(grupId: string, studentId: string) {
    const existing = await this.prisma.dataDaimi.findUnique({
      where: { studentId }
    });
    if (existing && existing.grupId === grupId) {
      await this.prisma.dataDaimi.update({
        where: { studentId },
        data: { grupId: null }
      });
    }

    await this.prisma.student.update({
      where: { id: studentId },
      data: { grupDaimi: null }
    });

    return { success: true };
  }
}
