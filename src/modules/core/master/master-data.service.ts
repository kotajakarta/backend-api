import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

@Injectable()
export class MasterDataService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getGuru(user: any) {
    let whereClause: any = { statusPool: 'AKTIF_CABANG' };
    if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause.wilayahId = user.wilayahId;
    } else if (user.scope === 'CABANG' && user.cabangId) {
      whereClause.cabangId = user.cabangId;
    }
    return this.prisma.staff.findMany({
      where: whereClause,
      include: {
        wilayah: true,
        cabang: true,
        grupDaimi: true
      }
    });
  }

  async importGuru(user: any, data: any[]) {
    const results = [];
    const BATCH_SIZE = 250;
    
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const chunk = data.slice(i, i + BATCH_SIZE);
      const chunkResults = await this.prisma.$transaction(async (tx) => {
        const chunkRes = [];
        for (const rawRow of chunk) {
          const row: any = {};
          for (const [k, v] of Object.entries(rawRow)) {
            if (typeof k === 'string') {
              const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
              row[normalizedKey] = v;
            }
          }

          const getValue = (keys: string[], fallbackMatches?: string[]) => {
            for (const key of keys) {
              const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (row[normalizedKey] !== undefined && row[normalizedKey] !== null) {
                return row[normalizedKey];
              }
            }
            if (fallbackMatches) {
               for (const [k, v] of Object.entries(row)) {
                  for (const match of fallbackMatches) {
                     if (k.includes(match) && v !== undefined && v !== null && v !== '') return v;
                  }
               }
            }
            return '';
          };

          const nameRaw = getValue(['nama', 'name', 'Nama Guru', 'Nama'], ['nama', 'name', 'guru']);
          const name = String(nameRaw).trim();
          if (!name) continue;
          const position = String(getValue(['posisi', 'position', 'Jabatan', 'Posisi']) || 'GURU').trim();

          let wilayahId = user.scope === 'WILAYAH' ? user.wilayahId : null;
          const rawWilayah = getValue(['wilayah', 'Wilayah']);
          if (rawWilayah && !wilayahId) {
            const wilayahName = String(rawWilayah).trim();
            let w = await tx.wilayah.findFirst({ where: { name: { equals: wilayahName, mode: 'insensitive' } } });
            if (!w) w = await tx.wilayah.create({ data: { name: wilayahName } });
            wilayahId = w.id;
          }

          let cabangId = user.scope === 'CABANG' ? user.cabangId : null;
          const rawCabang = getValue(['cabang', 'Cabang']);
          if (rawCabang && !cabangId) {
            const cabangName = String(rawCabang).trim();
            let c = await tx.cabang.findFirst({ where: { name: { equals: cabangName, mode: 'insensitive' } } });
            if (!c) {
              c = await tx.cabang.create({ data: { name: cabangName, wilayahId: wilayahId || null } });
            } else if (!c.wilayahId && wilayahId) {
              c = await tx.cabang.update({ where: { id: c.id }, data: { wilayahId } });
            }
            cabangId = c.id;
          }

          const existing = await tx.staff.findFirst({ where: { name, cabangId: cabangId || null } });
          if (existing) {
            const updated = await tx.staff.update({
              where: { id: existing.id },
              data: { position, wilayahId }
            });
            chunkRes.push(updated);
          } else {
            const created = await tx.staff.create({
              data: { name, position, wilayahId, cabangId, statusPool: 'TERSEDIA' }
            });
            chunkRes.push(created);
          }
        }
        return chunkRes;
      }, { maxWait: 120000, timeout: 300000 });
      results.push(...chunkResults);
    }
    return results;
  }

  async importCabang(user: any, data: any[]) {
    const results = [];
    const BATCH_SIZE = 250;
    
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const chunk = data.slice(i, i + BATCH_SIZE);
      const chunkResults = await this.prisma.$transaction(async (tx) => {
        const chunkRes = [];
        const wilayahCache = new Map<string, string>();
        const cabangCache = new Map<string, any>();
        
        const allWilayah = await tx.wilayah.findMany();
        for (const w of allWilayah) {
          wilayahCache.set(w.name.toLowerCase(), w.id);
        }
        const allCabang = await tx.cabang.findMany();
        for (const c of allCabang) {
          cabangCache.set(c.name.toLowerCase(), c);
        }

        for (const rawRow of chunk) {
          const row: any = {};
          for (const [k, v] of Object.entries(rawRow)) {
            if (typeof k === 'string') {
              const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
              row[normalizedKey] = v;
            }
          }

          const getValue = (keys: string[], fallbackMatches?: string[]) => {
            for (const key of keys) {
              const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (row[normalizedKey] !== undefined && row[normalizedKey] !== null) {
                return row[normalizedKey];
              }
            }
            if (fallbackMatches) {
               for (const [k, v] of Object.entries(row)) {
                  for (const match of fallbackMatches) {
                     if (k.includes(match) && v !== undefined && v !== null && v !== '') return v;
                  }
               }
            }
            return '';
          };

          const name = String(getValue(['nama', 'name', 'Nama Cabang', 'Cabang'], ['nama', 'cabang'])).trim();
          if (!name) continue;
          
          let wilayahId = user.scope === 'WILAYAH' ? user.wilayahId : null;
          const rawWilayah = getValue(['wilayah', 'Wilayah']);
          if (rawWilayah && !wilayahId) {
            const wilayahName = String(rawWilayah).trim();
            const wilayahKey = wilayahName.toLowerCase();
            if (wilayahCache.has(wilayahKey)) {
              wilayahId = wilayahCache.get(wilayahKey);
            } else {
              const w = await tx.wilayah.create({ data: { name: wilayahName } });
              wilayahCache.set(wilayahKey, w.id);
              wilayahId = w.id;
            }
          }

          const address = String(getValue(['alamat', 'address', 'Alamat']));
          const nameKey = name.toLowerCase();
          const existing = cabangCache.get(nameKey);
          
          if (existing) {
            const updated = await tx.cabang.update({
              where: { id: existing.id },
              data: { wilayahId: wilayahId || existing.wilayahId }
            });
            chunkRes.push(updated);
          } else {
            const created = await tx.cabang.create({
              data: { name, wilayahId }
            });
            cabangCache.set(nameKey, created);
            chunkRes.push(created);
          }
        }
        return chunkRes;
      }, { maxWait: 120000, timeout: 300000 });
      results.push(...chunkResults);
    }
    return results;
  }

  async importWilayah(user: any, data: any[]) {
    const results = [];
    const BATCH_SIZE = 250;
    
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const chunk = data.slice(i, i + BATCH_SIZE);
      const chunkResults = await this.prisma.$transaction(async (tx) => {
        const chunkRes = [];
        const wilayahCache = new Map<string, any>();
        
        const allWilayah = await tx.wilayah.findMany();
        for (const w of allWilayah) {
          wilayahCache.set(w.name.toLowerCase(), w);
        }

        for (const rawRow of chunk) {
          const row: any = {};
          for (const [k, v] of Object.entries(rawRow)) {
            if (typeof k === 'string') {
              const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
              row[normalizedKey] = v;
            }
          }

          const getValue = (keys: string[], fallbackMatches?: string[]) => {
            for (const key of keys) {
              const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (row[normalizedKey] !== undefined && row[normalizedKey] !== null) {
                return row[normalizedKey];
              }
            }
            if (fallbackMatches) {
               for (const [k, v] of Object.entries(row)) {
                  for (const match of fallbackMatches) {
                     if (k.includes(match) && v !== undefined && v !== null && v !== '') return v;
                  }
               }
            }
            return '';
          };

          const name = String(getValue(['nama', 'name', 'Nama Wilayah', 'Wilayah'], ['nama', 'wilayah'])).trim();
          if (!name) continue;
          
          const address = String(getValue(['alamat', 'address', 'Alamat']));
          const nameKey = name.toLowerCase();
          const existing = wilayahCache.get(nameKey);
          
          if (existing) {
            const updated = await tx.wilayah.update({
              where: { id: existing.id },
              data: { name }
            });
            chunkRes.push(updated);
          } else {
            const created = await tx.wilayah.create({
              data: { name }
            });
            wilayahCache.set(nameKey, created);
            chunkRes.push(created);
          }
        }
        return chunkRes;
      }, { maxWait: 120000, timeout: 300000 });
      results.push(...chunkResults);
    }
    return results;
  }

  async createGuru(data: { name: string, position: string, wilayahId?: string, grupDaimiId?: string, ifadahUrl?: string, ktpUrl?: string }) {
    return this.prisma.staff.create({
      data: {
        name: data.name,
        position: data.position,
        wilayahId: data.wilayahId || null,
        grupDaimiId: data.grupDaimiId || null,
        ifadahUrl: data.ifadahUrl || null,
        ktpUrl: data.ktpUrl || null,
        statusPool: 'TERSEDIA'
      }
    });
  }

  async updateGuru(id: string, data: { name: string, position: string, wilayahId?: string, grupDaimiId?: string, ifadahUrl?: string, ktpUrl?: string }) {
    return this.prisma.staff.update({
      where: { id },
      data: {
        name: data.name,
        position: data.position,
        wilayahId: data.wilayahId || null,
        grupDaimiId: data.grupDaimiId || null,
        ifadahUrl: data.ifadahUrl || null,
        ktpUrl: data.ktpUrl || null
      }
    });
  }

  async deleteAllGuru(user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new Error('Hanya admin global yang dapat menghapus semua data guru');
    }
    return this.prisma.$transaction(async (tx) => {
      const gurus = await tx.staff.findMany();
      const ids = gurus.map(g => g.id);

      if (ids.length > 0) {
        await tx.staff.deleteMany({ where: { id: { in: ids } } });
      }

      return { success: true, count: ids.length };
    });
  }

  async deleteGuru(id: string) {
    return this.prisma.staff.delete({ where: { id } });
  }

  async getPoolGuru(user: any) {
    let whereClause: any = { statusPool: 'TERSEDIA' };
    if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause.wilayahId = user.wilayahId;
    }
    return this.prisma.staff.findMany({
      where: whereClause,
      include: {
        wilayah: true,
        cabang: true,
        grupDaimi: true
      }
    });
  }

  async deletePoolGuru(user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new Error('Hanya admin global yang dapat menghapus semua data pool');
    }
    let whereClause: any = { statusPool: 'TERSEDIA' };
    
    return this.prisma.$transaction(async (tx) => {
      const guru = await tx.staff.findMany({ where: whereClause });
      const ids = guru.map(g => g.id);
      
      if (ids.length > 0) {
        await tx.staff.deleteMany({ where: { id: { in: ids } } });
      }
      
      return { success: true, count: ids.length };
    });
  }

  async tarikMassalGuru(staffIds: string[], cabangId: string) {
    return this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.findMany({
        where: { id: { in: staffIds } }
      });
      for (const s of staff) {
        if (s.statusPool !== 'TERSEDIA') {
          throw new Error(`Guru ${s.name} tidak tersedia`);
        }
      }
      
      const cabang = await tx.cabang.findUnique({
        where: { id: cabangId }
      });
      
      return tx.staff.updateMany({
        where: { id: { in: staffIds } },
        data: {
          statusPool: 'AKTIF_CABANG',
          cabangId: cabangId,
          wilayahId: cabang?.wilayahId || null
        }
      });
    });
  }

  async lepasGuru(id: string) {
    return this.prisma.staff.update({
      where: { id },
      data: {
        statusPool: 'TERSEDIA',
        cabangId: null
      }
    });
  }

  async getCabang(user: any) {
    // If scope is WILAYAH, filter by wilayahId
    let whereClause = {};
    if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause = { wilayahId: user.wilayahId };
    }
    
    return this.prisma.cabang.findMany({
      where: whereClause,
      include: {
        wilayah: true,
      }
    });
  }

  async createCabang(data: { name: string, wilayahId: string }) {
    return this.prisma.cabang.create({ data });
  }

  async updateCabang(id: string, data: { name: string, wilayahId: string }) {
    return this.prisma.cabang.update({ where: { id }, data });
  }

  async deleteCabang(id: string) {
    return this.prisma.cabang.delete({ where: { id } });
  }

  async deleteAllCabang(user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new Error('Hanya admin yang dapat menghapus semua cabang');
    }
    
    return this.prisma.$transaction(async (tx) => {
      // Explicitly set cabangId to null in other tables if needed, 
      // though Prisma onDelete: SetNull should handle this at DB level.
      await tx.kelas.updateMany({
        data: { cabangId: null }
      });

      await tx.staff.updateMany({
        data: { cabangId: null }
      });
      
      await tx.student.updateMany({
        data: { cabangId: null }
      });

      return tx.cabang.deleteMany();
    });
  }

  async getWilayah() {
    return this.prisma.wilayah.findMany();
  }

  async createWilayah(data: { name: string }) {
    return this.prisma.wilayah.create({ data });
  }

  async updateWilayah(id: string, data: { name: string }) {
    return this.prisma.wilayah.update({ where: { id }, data });
  }

  async deleteWilayah(id: string) {
    return this.prisma.wilayah.delete({ where: { id } });
  }

  async deleteAllWilayah(user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new Error('Hanya admin yang dapat menghapus semua wilayah');
    }
    
    return this.prisma.$transaction(async (tx) => {
      await tx.cabang.updateMany({
        data: { wilayahId: null }
      });

      await tx.staff.updateMany({
        data: { wilayahId: null }
      });
      
      await tx.student.updateMany({
        data: { wilayahId: null }
      });

      return tx.wilayah.deleteMany();
    });
  }
}
