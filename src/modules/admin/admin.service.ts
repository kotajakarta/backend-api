import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getUsers() {
    return this.prisma.user.findMany({
      include: {
        wilayah: true,
        cabang: true
      }
    });
  }

  async createUser(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        scope: data.scope,
        divisi: data.divisi,
        operatorName: data.operatorName || null,
        wilayahId: data.wilayahId || null,
        cabangId: data.cabangId || null
      }
    });
  }

  async updateUser(id: string, data: any) {
    const updateData: any = {
      username: data.username,
      scope: data.scope,
      divisi: data.divisi,
      operatorName: data.operatorName || null,
      wilayahId: data.wilayahId || null,
      cabangId: data.cabangId || null
    };

    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData
    });
  }

  async deleteUser(id: string) {
    return this.prisma.user.delete({
      where: { id }
    });
  }

  async importUsers(data: any[]) {
    try {
      const results = [];
      const BATCH_SIZE = 100;

      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const chunk = data.slice(i, i + BATCH_SIZE);

        const chunkResults = await this.prisma.$transaction(async (tx) => {
          const chunkRes = [];
          
          const wilayahCache = new Map<string, string>();
          const cabangCache = new Map<string, { id: string; wilayahId: string | null }>();
          
          const allWilayah = await tx.wilayah.findMany();
          for (const w of allWilayah) {
            wilayahCache.set(w.name.toLowerCase(), w.id);
          }
          
          const allCabang = await tx.cabang.findMany();
          for (const c of allCabang) {
            cabangCache.set(c.name.toLowerCase(), { id: c.id, wilayahId: c.wilayahId });
          }

          for (const rawRow of chunk) {
            const row: any = {};
            let hasData = false;
            for (const [k, v] of Object.entries(rawRow)) {
              if (typeof k === 'string') {
                const normalizedKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                row[normalizedKey] = v;
                if (v !== null && v !== undefined && v !== '') {
                  hasData = true;
                }
              }
            }

            if (!hasData) continue;

            const getValue = (keys: string[]) => {
              for (const key of keys) {
                const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (row[normalizedKey] !== undefined && row[normalizedKey] !== null && row[normalizedKey] !== '') {
                  return row[normalizedKey];
                }
              }
              return '';
            };

            const username = String(getValue(['username', 'user', 'nama_user'])).trim();
            const rawPassword = String(getValue(['password', 'pass', 'kata_sandi'])).trim();
            const rawScope = String(getValue(['scope', 'role', 'akses'])).trim().toUpperCase();
            const rawDivisi = String(getValue(['divisi', 'division', 'bagian'])).trim().toUpperCase();
            const operatorName = String(getValue(['operator_name', 'operatorName', 'nama_operator', 'operator'])).trim() || null;
            const rawWilayah = String(getValue(['wilayah', 'region', 'nama_wilayah'])).trim();
            const rawCabang = String(getValue(['cabang', 'branch', 'nama_cabang'])).trim();

            if (!username) continue;

            let scope: any = 'GLOBAL';
            if (rawScope.includes('WILAYAH')) {
              scope = 'WILAYAH';
            } else if (rawScope.includes('CABANG')) {
              scope = 'CABANG';
            }

            let divisi: any = 'ALL';
            if (rawDivisi.includes('FORMAL')) {
              divisi = 'FORMAL';
            } else if (rawDivisi.includes('PESANTREN')) {
              divisi = 'PESANTREN';
            }

            let wilayahId = null;
            if (rawWilayah) {
              wilayahId = wilayahCache.get(rawWilayah.toLowerCase()) || null;
            }

            let cabangId = null;
            if (rawCabang) {
              const cabObj = cabangCache.get(rawCabang.toLowerCase());
              if (cabObj) {
                cabangId = cabObj.id;
                if (!wilayahId && cabObj.wilayahId) {
                  wilayahId = cabObj.wilayahId;
                }
              }
            }

            const existingUser = await tx.user.findUnique({
              where: { username }
            });

            if (existingUser) {
              const updateData: any = {
                scope,
                divisi,
                operatorName: operatorName || existingUser.operatorName,
                wilayahId: wilayahId || existingUser.wilayahId,
                cabangId: cabangId || existingUser.cabangId,
              };

              if (rawPassword) {
                updateData.password = await bcrypt.hash(rawPassword, 10);
              }

              const updated = await tx.user.update({
                where: { id: existingUser.id },
                data: updateData
              });
              chunkRes.push(updated);
            } else {
              const passwordToHash = rawPassword || '123456';
              const hashedPassword = await bcrypt.hash(passwordToHash, 10);

              const created = await tx.user.create({
                data: {
                  username,
                  password: hashedPassword,
                  scope,
                  divisi,
                  operatorName,
                  wilayahId,
                  cabangId
                }
              });
              chunkRes.push(created);
            }
          }
          return chunkRes;
        });

        results.push(...chunkResults);
      }
      return results;
    } catch (e: any) {
      console.error("USER IMPORT ERROR:", e.message);
      throw e;
    }
  }

  async getWilayah() {
    return this.prisma.wilayah.findMany({
      include: { cabangs: true }
    });
  }
}
