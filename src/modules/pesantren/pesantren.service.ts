import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class PesantrenService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  private async checkGrupDaimiScope(user: any, grup: { cabangId: string | null }) {
    if (!user || user.scope === 'GLOBAL') return;
    if (user.scope === 'CABANG') {
      if (grup.cabangId !== user.cabangId) {
        throw new ForbiddenException('Akses ditolak: Grup Daimi di luar cabang Anda.');
      }
      return;
    }
    if (user.scope === 'WILAYAH') {
      const cabang = grup.cabangId ? await this.prisma.cabang.findUnique({ where: { id: grup.cabangId }, select: { wilayahId: true } }) : null;
      if (!cabang || cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Akses ditolak: Grup Daimi di luar wilayah Anda.');
      }
    }
  }

  private async checkStudentInScope(user: any, studentId: string) {
    if (!user || user.scope === 'GLOBAL') return;
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { cabangId: true, wilayahId: true } });
    if (!student) throw new NotFoundException('Siswa tidak ditemukan');
    if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak: siswa di luar cabang Anda.');
    }
    if (user.scope === 'WILAYAH' && student.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: siswa di luar wilayah Anda.');
    }
  }

  async getGrupDaimi(user?: any) {
    const where: any = {};
    if (user?.scope === 'CABANG') {
      where.cabangId = user.cabangId;
    } else if (user?.scope === 'WILAYAH') {
      where.cabang = { wilayahId: user.wilayahId };
    }

    return this.prisma.grupDaimi.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        ketua: true,
        cabang: {
          include: {
            wilayah: true
          }
        },
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

  async updateGrupDaimi(id: string, data: { name: string; jenis?: string; ketuaId?: string; cabangId?: string }, user?: any) {
    const existing = await this.prisma.grupDaimi.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Grup Daimi tidak ditemukan');
    await this.checkGrupDaimiScope(user, existing);
    const result = await this.prisma.grupDaimi.update({
      where: { id },
      data: {
        name: data.name,
        jenis: data.jenis !== undefined ? data.jenis : undefined,
        ketuaId: data.ketuaId !== undefined ? data.ketuaId : undefined,
        cabangId: data.cabangId !== undefined ? data.cabangId : undefined,
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

  async deleteGrupDaimi(id: string, user?: any) {
    const existing = await this.prisma.grupDaimi.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Grup Daimi tidak ditemukan');
    await this.checkGrupDaimiScope(user, existing);
    return this.prisma.grupDaimi.delete({
      where: { id }
    });
  }

  // Master data "Jenis Grup Daimi"
  async getJenisGrupDaimi() {
    return this.prisma.jenisGrupDaimi.findMany({ orderBy: { name: 'asc' } });
  }

  async createJenisGrupDaimi(data: { name: string }) {
    return this.prisma.jenisGrupDaimi.create({ data: { name: data.name.trim() } });
  }

  async updateJenisGrupDaimi(id: string, data: { name: string }) {
    return this.prisma.jenisGrupDaimi.update({ where: { id }, data: { name: data.name.trim() } });
  }

  async deleteJenisGrupDaimi(id: string) {
    return this.prisma.jenisGrupDaimi.delete({ where: { id } });
  }

  async createGrupDaimi(data: { name: string; jenis?: string; ketuaId?: string; cabangId?: string }, user?: any) {
    if (user && user.scope === 'WILAYAH' && data.cabangId) {
      const cabang = await this.prisma.cabang.findUnique({ where: { id: data.cabangId }, select: { wilayahId: true } });
      if (!cabang || cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Cabang di luar wilayah Anda.');
      }
    }
    return this.prisma.grupDaimi.create({
      data: {
        name: data.name,
        jenis: data.jenis || null,
        ketuaId: data.ketuaId || null,
        cabangId: data.cabangId || null,
      }
    });
  }

  // Student Assignment APIs for Daimi Group
  async getStudentsInGrupDaimi(grupId: string, user?: any) {
    if (user) {
      const grup = await this.prisma.grupDaimi.findUnique({ where: { id: grupId } });
      if (!grup) throw new NotFoundException('Grup Daimi tidak ditemukan');
      await this.checkGrupDaimiScope(user, grup);
    }
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

  async addStudentToGrupDaimi(grupId: string, studentId: string, user?: any) {
    const grup = await this.prisma.grupDaimi.findUnique({ where: { id: grupId } });
    if (!grup) throw new NotFoundException('Grup Daimi tidak ditemukan');
    await this.checkGrupDaimiScope(user, grup);
    await this.checkStudentInScope(user, studentId);

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

  async removeStudentFromGrupDaimi(grupId: string, studentId: string, user?: any) {
    const grup = await this.prisma.grupDaimi.findUnique({ where: { id: grupId } });
    if (!grup) throw new NotFoundException('Grup Daimi tidak ditemukan');
    await this.checkGrupDaimiScope(user, grup);
    await this.checkStudentInScope(user, studentId);

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
