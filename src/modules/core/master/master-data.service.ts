import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AuditLogService } from '../../audit-log/audit-log.service.js';

@Injectable()
export class MasterDataService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService
  ) {}

  // Guru (Staff) selalu terikat cabang/wilayah - CABANG hanya boleh akses gurunya sendiri,
  // WILAYAH hanya guru di wilayahnya.
  private checkStaffScope(user: any, staff: { cabangId: string | null; wilayahId: string | null }) {
    if (user.scope === 'CABANG' && staff.cabangId !== user.cabangId) {
      throw new ForbiddenException('Akses ditolak: guru di luar cabang Anda.');
    }
    if (user.scope === 'WILAYAH' && staff.wilayahId !== user.wilayahId) {
      throw new ForbiddenException('Akses ditolak: guru di luar wilayah Anda.');
    }
  }

  private async checkCabangAccess(cabangId: string, user: any) {
    const cabang = await this.prisma.cabang.findUnique({ where: { id: cabangId } });
    if (!cabang) throw new NotFoundException('Cabang tidak ditemukan');
    if (user.scope === 'CABANG' && user.cabangId !== cabangId) {
      throw new ForbiddenException('Akses ditolak: cabang di luar scope Anda.');
    }
    if (user.scope === 'WILAYAH' && user.wilayahId !== cabang.wilayahId) {
      throw new ForbiddenException('Akses ditolak: cabang di luar wilayah Anda.');
    }
    return cabang;
  }

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
        grupDaimi: true,
        guruMapelKelas: {
          include: {
            kelas: {
              include: { lembagaMuadalah: true }
            }
          }
        }
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

  async createGuru(data: { name: string, position: string, wilayahId?: string, grupDaimiId?: string, ifadahUrl?: string, ktpUrl?: string, phone?: string, cabangId?: string, mapelUmum?: string[], waliKelas?: string }, user?: any) {
    if (user) {
      if (user.scope === 'CABANG') {
        data.cabangId = user.cabangId;
        data.wilayahId = user.wilayahId;
      } else if (user.scope === 'WILAYAH') {
        data.wilayahId = user.wilayahId;
        if (data.cabangId) {
          const cabang = await this.prisma.cabang.findUnique({ where: { id: data.cabangId } });
          if (!cabang || cabang.wilayahId !== user.wilayahId) {
            throw new ForbiddenException('Cabang di luar wilayah Anda.');
          }
        }
      }
    }
    const isCabangActive = data.cabangId && data.cabangId !== '';
    const statusPool = isCabangActive ? 'AKTIF_CABANG' : 'TERSEDIA';
    const result = await this.prisma.staff.create({
      data: {
        name: data.name,
        position: data.position,
        wilayahId: data.wilayahId || null,
        cabangId: isCabangActive ? data.cabangId : null,
        grupDaimiId: data.grupDaimiId || null,
        ifadahUrl: data.ifadahUrl || null,
        ktpUrl: data.ktpUrl || null,
        phone: data.phone || null,
        statusPool: statusPool,
        mapelUmum: data.mapelUmum || [],
        waliKelas: data.waliKelas || null
      }
    });
    if (user) {
      await this.auditLogService.log('CREATE', 'TEACHER', result.id, result.name, user, `Menambahkan guru baru "${result.name}"`);
    }
    return result;
  }

  async updateGuru(id: string, data: { name: string, position: string, wilayahId?: string, grupDaimiId?: string, ifadahUrl?: string, ktpUrl?: string, phone?: string, cabangId?: string, mapelUmum?: string[], waliKelas?: string }, user?: any) {
    const existing = await this.prisma.staff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Guru tidak ditemukan');
    if (user) {
      this.checkStaffScope(user, existing);
      if (user.scope === 'CABANG') {
        data.cabangId = user.cabangId;
        data.wilayahId = user.wilayahId;
      } else if (user.scope === 'WILAYAH') {
        data.wilayahId = user.wilayahId;
        if (data.cabangId) {
          const cabang = await this.prisma.cabang.findUnique({ where: { id: data.cabangId } });
          if (!cabang || cabang.wilayahId !== user.wilayahId) {
            throw new ForbiddenException('Cabang di luar wilayah Anda.');
          }
        }
      }
    }
    const isCabangActive = data.cabangId && data.cabangId !== '';
    const statusPool = isCabangActive ? 'AKTIF_CABANG' : 'TERSEDIA';
    const result = await this.prisma.staff.update({
      where: { id },
      data: {
        name: data.name,
        position: data.position,
        wilayahId: data.wilayahId || null,
        cabangId: isCabangActive ? data.cabangId : null,
        grupDaimiId: data.grupDaimiId || null,
        ifadahUrl: data.ifadahUrl || null,
        ktpUrl: data.ktpUrl || null,
        phone: data.phone || null,
        statusPool: statusPool,
        mapelUmum: data.mapelUmum || [],
        waliKelas: data.waliKelas || null
      }
    });
    if (user) {
      const fieldLabels: Record<string, string> = {
        name: 'Nama',
        position: 'Jabatan',
        phone: 'No. Telepon',
        waliKelas: 'Wali Kelas'
      };
      const changes: string[] = [];
      if (existing) {
        for (const key of Object.keys(fieldLabels)) {
          const oldVal = (existing as any)[key];
          const newVal = (data as any)[key];
          const normalizedOld = oldVal === null || oldVal === undefined ? '' : String(oldVal).trim();
          const normalizedNew = newVal === null || newVal === undefined ? '' : String(newVal).trim();
          if (normalizedOld !== normalizedNew) {
            changes.push(`${fieldLabels[key]}: "${normalizedOld || '-'}" ➔ "${normalizedNew || '-'}"`);
          }
        }
      }
      const changesStr = changes.length > 0 ? ` (${changes.join(', ')})` : '';
      await this.auditLogService.log('UPDATE', 'TEACHER', result.id, result.name, user, `Memperbarui biodata guru "${result.name}"${changesStr}`);
    }
    return result;
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

  async deleteGuru(id: string, user?: any) {
    const existing = await this.prisma.staff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Guru tidak ditemukan');
    if (user) this.checkStaffScope(user, existing);
    const deleted = await this.prisma.staff.delete({ where: { id } });
    if (user) {
      await this.auditLogService.log('DELETE', 'TEACHER', id, deleted.name, user, `Menghapus guru "${deleted.name}"`);
    }
    return deleted;
  }

  async getPoolGuru(user: any) {
    let whereClause: any = {};
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

  async tarikMassalGuru(staffIds: string[], cabangId: string, user?: any) {
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
      
      const result = await tx.staff.updateMany({
        where: { id: { in: staffIds } },
        data: {
          statusPool: 'AKTIF_CABANG',
          cabangId: cabangId,
          wilayahId: cabang?.wilayahId || null
        }
      });

      if (user) {
        await this.auditLogService.log('TARIK', 'TEACHER', cabangId, cabang?.name || '', user, `Menarik ${staffIds.length} guru ke cabang "${cabang?.name}"`);
      }
      return result;
    });
  }

  async lepasGuru(id: string, user?: any) {
    const staff = await this.prisma.staff.findUnique({ where: { id } });
    if (!staff) throw new Error('Guru tidak ditemukan');

    const result = await this.prisma.staff.update({
      where: { id },
      data: {
        statusPool: 'TERSEDIA',
        cabangId: null
      }
    });

    if (user) {
      await this.auditLogService.log('LEPAS', 'TEACHER', id, staff.name, user, `Melepas guru "${staff.name}" dari cabang`);
    }
    return result;
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
        _count: {
          select: { students: true }
        }
      }
    });
  }

  async createCabang(data: any, user?: any) {
    if (user) {
      if (user.scope === 'CABANG') {
        throw new ForbiddenException('Anda tidak memiliki akses untuk menambah cabang.');
      }
      if (user.scope === 'WILAYAH') {
        data.wilayahId = user.wilayahId;
      }
    }
    const result = await this.prisma.cabang.create({
      data: {
        name: data.name,
        wilayahId: data.wilayahId || null,
        nameGlodemy: data.nameGlodemy || null,
        nameResmi: data.nameResmi || null,
        kapasitasSantri: typeof data.kapasitasSantri === 'number' ? data.kapasitasSantri : parseInt(data.kapasitasSantri || 0, 10),
        totalSantriManual: typeof data.totalSantriManual === 'number' ? data.totalSantriManual : parseInt(data.totalSantriManual || 0, 10),
        ketuaCabangId: data.ketuaCabangId || null,
        ketuaMuadalahId: data.ketuaMuadalahId || null,
        ketuaIslerId: data.ketuaIslerId || null,
        alamatProvId: data.alamatProvId || null,
        alamatProvName: data.alamatProvName || null,
        alamatKabId: data.alamatKabId || null,
        alamatKabName: data.alamatKabName || null,
        alamatKecId: data.alamatKecId || null,
        alamatKecName: data.alamatKecName || null,
        alamatKelId: data.alamatKelId || null,
        alamatKelName: data.alamatKelName || null,
        alamatJalan: data.alamatJalan || null,
        alamatNegara: data.alamatNegara || null,
        statusTanah: data.statusTanah || null,
        statusBangunan: data.statusBangunan || null
      } 
    });
    if (user) {
      await this.auditLogService.log('CREATE', 'CABANG', result.id, result.name, user, `Menambahkan cabang baru "${result.name}"`);
    }
    return result;
  }

  async updateCabang(id: string, data: any, user?: any) {
    if (user) {
      const existingCabang = await this.checkCabangAccess(id, user);
      if (user.scope === 'WILAYAH') data.wilayahId = user.wilayahId;
      if (user.scope === 'CABANG') data.wilayahId = existingCabang.wilayahId;
    }
    const result = await this.prisma.cabang.update({
      where: { id },
      data: {
        name: data.name,
        wilayahId: data.wilayahId || null,
        nameGlodemy: data.nameGlodemy || null,
        nameResmi: data.nameResmi || null,
        kapasitasSantri: typeof data.kapasitasSantri === 'number' ? data.kapasitasSantri : parseInt(data.kapasitasSantri || 0, 10),
        totalSantriManual: typeof data.totalSantriManual === 'number' ? data.totalSantriManual : parseInt(data.totalSantriManual || 0, 10),
        ketuaCabangId: data.ketuaCabangId || null,
        ketuaMuadalahId: data.ketuaMuadalahId || null,
        ketuaIslerId: data.ketuaIslerId || null,
        alamatProvId: data.alamatProvId || null,
        alamatProvName: data.alamatProvName || null,
        alamatKabId: data.alamatKabId || null,
        alamatKabName: data.alamatKabName || null,
        alamatKecId: data.alamatKecId || null,
        alamatKecName: data.alamatKecName || null,
        alamatKelId: data.alamatKelId || null,
        alamatKelName: data.alamatKelName || null,
        alamatJalan: data.alamatJalan || null,
        alamatNegara: data.alamatNegara || null,
        statusTanah: data.statusTanah || null,
        statusBangunan: data.statusBangunan || null
      } 
    });
    if (user) {
      await this.auditLogService.log('UPDATE', 'CABANG', result.id, result.name, user, `Memperbarui data cabang "${result.name}"`);
    }
    return result;
  }

  async deleteCabang(id: string, user?: any) {
    if (user) {
      if (user.scope === 'CABANG') {
        throw new ForbiddenException('Anda tidak memiliki akses untuk menghapus cabang.');
      }
      await this.checkCabangAccess(id, user);
    }
    const result = await this.prisma.cabang.delete({ where: { id } });
    if (user) {
      await this.auditLogService.log('DELETE', 'CABANG', result.id, result.name, user, `Menghapus cabang "${result.name}"`);
    }
    return result;
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

  async createWilayah(data: { name: string }, user?: any) {
    if (user && user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin global yang dapat menambah wilayah.');
    }
    const result = await this.prisma.wilayah.create({ data });
    if (user) {
      await this.auditLogService.log('CREATE', 'WILAYAH', result.id, result.name, user, `Menambahkan wilayah baru "${result.name}"`);
    }
    return result;
  }

  async updateWilayah(id: string, data: { name: string }, user?: any) {
    if (user && user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin global yang dapat mengubah wilayah.');
    }
    const result = await this.prisma.wilayah.update({ where: { id }, data });
    if (user) {
      await this.auditLogService.log('UPDATE', 'WILAYAH', result.id, result.name, user, `Memperbarui data wilayah "${result.name}"`);
    }
    return result;
  }

  async deleteWilayah(id: string, user?: any) {
    if (user && user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Hanya admin global yang dapat menghapus wilayah.');
    }
    const result = await this.prisma.wilayah.delete({ where: { id } });
    if (user) {
      await this.auditLogService.log('DELETE', 'WILAYAH', result.id, result.name, user, `Menghapus wilayah "${result.name}"`);
    }
    return result;
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

  async getCabangProfile(id: string, user?: any) {
    if (user) await this.checkCabangAccess(id, user);
    const cabang = await this.prisma.cabang.findUnique({
      where: { id }
    });
    if (!cabang) throw new Error('Cabang tidak ditemukan');

    // totalSantriOtomatis
    const totalSantriOtomatis = await this.prisma.student.count({
      where: { cabangId: id, isActive: true }
    });

    // nonMuadalahOtomatis
    const nonMuadalahOtomatis = await this.prisma.student.count({
      where: { cabangId: id, isActive: true, jenisSiswa: 'NON_MUADALAH' }
    });

    // grupDaimiOtomatis
    const grupDaimiGroups = await this.prisma.student.groupBy({
      by: ['grupDaimi'],
      _count: { id: true },
      where: { cabangId: id, isActive: true }
    });
    const grupDaimiOtomatis = grupDaimiGroups.map(g => ({
      name: g.grupDaimi || 'Belum Ditentukan',
      value: g._count.id
    }));

    // kelas7sd12
    const siswaFormalList = await this.prisma.siswaFormal.findMany({
      where: { student: { cabangId: id, isActive: true } },
      include: { kelas: true }
    });

    let kelas7sd12 = 0;
    siswaFormalList.forEach(sf => {
      if (sf.kelas) {
        const t = sf.kelas.tingkat || sf.kelas.name;
        if (t && (t.includes('7') || t.includes('8') || t.includes('9') || t.includes('10') || t.includes('11') || t.includes('12') || t.includes('VII') || t.includes('VIII') || t.includes('IX') || t.includes('X') || t.includes('XI') || t.includes('XII'))) {
          kelas7sd12++;
        }
      }
    });

    // Fetch teachers (Guru) for this branch
    const staffList = await this.prisma.staff.findMany({
      where: { cabangId: id }
    });

    return {
      ...cabang,
      totalSantriOtomatis,
      nonMuadalahOtomatis,
      grupDaimiOtomatis,
      kelas7sd12,
      staffList
    };
  }

  async updateCabangProfile(id: string, data: any, user?: any) {
    if (user) await this.checkCabangAccess(id, user);
    const result = await this.prisma.cabang.update({
      where: { id },
      data: {
        nameGlodemy: data.nameGlodemy,
        nameResmi: data.nameResmi,
        kapasitasSantri: typeof data.kapasitasSantri === 'number' ? data.kapasitasSantri : parseInt(data.kapasitasSantri || 0, 10),
        totalSantriManual: typeof data.totalSantriManual === 'number' ? data.totalSantriManual : parseInt(data.totalSantriManual || 0, 10),
        ketuaCabangId: data.ketuaCabangId || null,
        ketuaMuadalahId: data.ketuaMuadalahId || null,
        ketuaIslerId: data.ketuaIslerId || null,
        alamatProvId: data.alamatProvId || null,
        alamatProvName: data.alamatProvName || null,
        alamatKabId: data.alamatKabId || null,
        alamatKabName: data.alamatKabName || null,
        alamatKecId: data.alamatKecId || null,
        alamatKecName: data.alamatKecName || null,
        alamatKelId: data.alamatKelId || null,
        alamatKelName: data.alamatKelName || null,
        alamatJalan: data.alamatJalan || null,
        alamatNegara: data.alamatNegara || null,
        statusTanah: data.statusTanah || null,
        statusBangunan: data.statusBangunan || null,
        fotoPlang: data.fotoPlang || null,
        fotoGedung: data.fotoGedung || null,
        fotoHalaman: data.fotoHalaman || null,
        fotoDenah: data.fotoDenah || null,
        fotoMushala: data.fotoMushala || null,
        fotoKelas: data.fotoKelas || null,
        fotoRuangTidur: data.fotoRuangTidur || null,
        fotoRuangMakan: data.fotoRuangMakan || null,
        fotoKamarMandi: data.fotoKamarMandi || null
      }
    });
    if (user) {
      await this.auditLogService.log('UPDATE', 'CABANG', result.id, result.name, user, `Memperbarui profil cabang "${result.name}"`);
    }
    return result;
  }

  async getCountries() {
    try {
      const response = await fetch(
        'https://api.restcountries.com/countries/v5?q=indonesia',
        { headers: { 'Authorization': `Bearer ${process.env.RESTCOUNTRIES_API_KEY || ''}` } }
      );
      if (!response.ok) {
        throw new Error('Failed to fetch countries');
      }
      return await response.json();
    } catch (e) {
      return {
        data: {
          objects: [
            { names: { common: 'Indonesia' } },
            { names: { common: 'Malaysia' } }
          ]
        }
      };
    }
  }
}
