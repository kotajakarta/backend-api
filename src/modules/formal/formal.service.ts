import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class FormalService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getKelas(user: any) {
    let whereClause = {};
    if (user.scope === 'CABANG' && user.cabangId) {
      whereClause = { cabangId: user.cabangId };
    } else if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause = { cabang: { wilayahId: user.wilayahId } };
    }
    return this.prisma.kelas.findMany({
      where: whereClause,
      include: { cabang: true }
    });
  }

  async importKelas(user: any, data: any[]) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];
      for (const rawRow of data) {
        const row: any = {};
        for (const [k, v] of Object.entries(rawRow)) {
          if (typeof k === 'string') {
            const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            row[normalizedKey] = v;
          }
        }

        const getValue = (keys: string[]) => {
          for (const key of keys) {
            const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (row[normalizedKey] !== undefined && row[normalizedKey] !== null) {
              return row[normalizedKey];
            }
          }
          return '';
        };

        const name = String(getValue(['name', 'nama_kelas', 'Nama Kelas', 'Kelas'])).trim();
        if (!name) continue; // Skip invalid row

        const tingkatRaw = getValue(['tingkat', 'Tingkat']);
        const tingkat = tingkatRaw ? String(tingkatRaw).trim() : null;
        let isActive = true;
        const isActiveRaw = getValue(['isActive', 'is_active', 'Aktif']);
        if (isActiveRaw !== undefined && isActiveRaw !== '') {
           isActive = String(isActiveRaw).toLowerCase() === 'true';
        }
        
        let wilayahId = user.scope === 'WILAYAH' ? user.wilayahId : null;
        const rawWilayah = getValue(['wilayah', 'Wilayah']);
        if (rawWilayah && !wilayahId) {
          const wilayahName = String(rawWilayah).trim();
          let w = await tx.wilayah.findFirst({ where: { name: { equals: wilayahName, mode: 'insensitive' } } });
          if (!w) {
            w = await tx.wilayah.create({ data: { name: wilayahName } });
          }
          wilayahId = w.id;
        }
        
        let cabangId = user.scope === 'CABANG' ? user.cabangId : null;
        const rawCabang = getValue(['cabang', 'Cabang']);
        if (rawCabang && !cabangId) {
          const cabangName = String(rawCabang).trim();
          let c = await tx.cabang.findFirst({ where: { name: { equals: cabangName, mode: 'insensitive' } } });
          if (!c) {
            c = await tx.cabang.create({ 
              data: { 
                name: cabangName,
                wilayahId: wilayahId || null
              } 
            });
          } else if (!c.wilayahId && wilayahId) {
            c = await tx.cabang.update({
              where: { id: c.id },
              data: { wilayahId }
            });
          }
          cabangId = c.id;
        }

        // Try to find if class exists in this cabang with same name
        let existing = null;
        if (cabangId) {
           existing = await tx.kelas.findFirst({
             where: { name: name, cabangId: cabangId }
           });
        } else {
           existing = await tx.kelas.findFirst({
             where: { name: name, cabangId: null }
           });
        }

        if (existing) {
          const updated = await tx.kelas.update({
            where: { id: existing.id },
            data: {
              tingkat: tingkat || existing.tingkat,
              isActive: isActive
            }
          });
          results.push(updated);
        } else {
          const created = await tx.kelas.create({
            data: {
              name,
              tingkat,
              isActive,
              cabangId
            }
          });
          results.push(created);
        }
      }
      return results;
    }, { maxWait: 60000, timeout: 300000 });
  }

  async createKelas(data: { name: string, tingkat?: string, isActive?: boolean, cabangId?: string }) {
    return this.prisma.kelas.create({
      data: {
        name: data.name,
        tingkat: data.tingkat,
        isActive: data.isActive ?? true,
        cabangId: data.cabangId
      }
    });
  }

  async updateKelas(id: string, data: { name: string, tingkat?: string, cabangId?: string }) {
    return this.prisma.kelas.update({
      where: { id },
      data: { 
        name: data.name,
        tingkat: data.tingkat,
        cabangId: data.cabangId
      }
    });
  }

  async toggleKelasStatus(id: string, isActive: boolean) {
    const kelas = await this.prisma.kelas.findUnique({ where: { id } });
    if (!kelas) {
      throw new NotFoundException('Kelas tidak ditemukan');
    }
    return this.prisma.kelas.update({
      where: { id },
      data: { isActive }
    });
  }

  async deleteKelas(id: string) {
    return this.prisma.kelas.delete({ where: { id } });
  }

  async deleteAllKelas(user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new Error('Hanya admin yang dapat menghapus semua kelas');
    }
    return this.prisma.$transaction(async (tx) => {
      // Set kelasId to null in SiswaFormal to handle relation
      await tx.siswaFormal.updateMany({
        data: { kelasId: null }
      });
      return tx.kelas.deleteMany();
    });
  }

  async getRapor() {
    return this.prisma.nilaiFormal.findMany();
  }

  async createRapor(data: { studentName: string, subject: string, score: number }) {
    return this.prisma.nilaiFormal.create({ data });
  }

  async updateRapor(id: string, data: { studentName: string, subject: string, score: number }) {
    return this.prisma.nilaiFormal.update({ where: { id }, data });
  }

  async deleteRapor(id: string) {
    return this.prisma.nilaiFormal.delete({ where: { id } });
  }

  async getSiswaFormal(user: any) {
    let whereClause: any = { statusPool: 'AKTIF_CABANG' };
    
    if (user.scope === 'CABANG' && user.cabangId) {
      whereClause.cabangId = user.cabangId;
    } else if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause.wilayahId = user.wilayahId;
    }

    return this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        cabang: true,
        siswaFormal: {
          include: {
            kelas: true
          }
        }
      }
    });
  }

  async updateSiswaFormal(studentId: string, data: { nis?: string, nisn?: string, kelasId?: string }) {
    const existing = await this.prisma.siswaFormal.findUnique({
      where: { studentId }
    });

    if (existing) {
      return this.prisma.siswaFormal.update({
        where: { studentId },
        data: {
          nis: data.nis,
          nisn: data.nisn,
          kelasId: data.kelasId === '' ? null : data.kelasId,
        }
      });
    } else {
      return this.prisma.siswaFormal.create({
        data: {
          studentId,
          nis: data.nis,
          nisn: data.nisn,
          kelasId: data.kelasId === '' ? null : data.kelasId,
        }
      });
    }
  }
}
