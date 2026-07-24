import { Injectable, NotFoundException, BadRequestException, Inject, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';

@Injectable()
export class FormalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService
  ) {}

  async getKelas(user: any) {
    let whereClause = {};
    if (user.scope === 'CABANG' && user.cabangId) {
      whereClause = { cabangId: user.cabangId };
    } else if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause = { cabang: { wilayahId: user.wilayahId } };
    }
    return this.prisma.kelas.findMany({
      where: whereClause,
      include: {
        cabang: { include: { wilayah: true } },
        lembagaMuadalah: true,
        waliKelas: true,
        ruang: true,
        _count: {
          select: { siswaFormal: true }
        }
      }
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

  async createKelas(data: { 
    name: string, 
    tingkat?: string, 
    isActive?: boolean, 
    cabangId?: string, 
    lembagaMuadalahId?: string,
    tahunAjaran?: string,
    waliKelasId?: string,
    ruangId?: string,
    kurikulum?: string,
    jurusan?: string,
    jenisRombel?: string,
    kapasitas?: number
  }, user?: any) {
    if (user && user.scope === 'WILAYAH') {
      // Find the target branch to ensure it belongs to the user's wilayah
      const targetCabang = data.cabangId
        ? await this.prisma.cabang.findUnique({ where: { id: data.cabangId } })
        : null;
      if (!targetCabang || targetCabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda hanya dapat menambahkan kelas pada cabang di wilayah Anda');
      }
    }
    if (user && user.scope === 'CABANG') {
      if (data.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda hanya dapat menambahkan kelas pada cabang Anda sendiri');
      }
    }

    const result = await this.prisma.kelas.create({
      data: {
        name: data.name,
        tingkat: data.tingkat,
        isActive: data.isActive !== undefined ? data.isActive : true,
        cabangId: data.cabangId,
        lembagaMuadalahId: data.lembagaMuadalahId || null,
        tahunAjaran: data.tahunAjaran || null,
        waliKelasId: data.waliKelasId || null,
        ruangId: data.ruangId || null,
        kurikulum: data.kurikulum || null,
        jurusan: data.jurusan || null,
        jenisRombel: data.jenisRombel || null,
        kapasitas: data.kapasitas !== undefined ? Number(data.kapasitas) : 80
      }
    });
    if (user) {
      await this.auditLogService.log('CREATE', 'KELAS', result.id, result.name, user, `Menambahkan kelas baru "${result.name}"`);
    }
    return result;
  }

  async updateKelas(id: string, data: { 
    name: string, 
    tingkat?: string, 
    cabangId?: string, 
    lembagaMuadalahId?: string,
    tahunAjaran?: string,
    waliKelasId?: string,
    ruangId?: string,
    kurikulum?: string,
    jurusan?: string,
    jenisRombel?: string,
    kapasitas?: number
  }, user?: any) {
    const existing = await this.prisma.kelas.findUnique({
      where: { id },
      include: { cabang: true, lembagaMuadalah: true }
    });
    if (!existing) {
      throw new NotFoundException('Kelas tidak ditemukan');
    }

    if (user && user.scope === 'WILAYAH') {
      if (!existing.cabang || existing.cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda hanya dapat memperbarui kelas di wilayah Anda');
      }
      if (data.cabangId && data.cabangId !== existing.cabangId) {
        const targetCabang = await this.prisma.cabang.findUnique({
          where: { id: data.cabangId }
        });
        if (!targetCabang || targetCabang.wilayahId !== user.wilayahId) {
          throw new ForbiddenException('Anda hanya dapat memindahkan kelas ke cabang di wilayah Anda');
        }
      }
    }
    if (user && user.scope === 'CABANG') {
      if (existing.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda hanya dapat memperbarui kelas di cabang Anda');
      }
      if (data.cabangId && data.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda tidak dapat memindahkan kelas ke cabang lain');
      }
    }

    const result = await this.prisma.kelas.update({
      where: { id },
      data: { 
        name: data.name,
        tingkat: data.tingkat,
        cabangId: data.cabangId,
        lembagaMuadalahId: data.lembagaMuadalahId || null,
        tahunAjaran: data.tahunAjaran || null,
        waliKelasId: data.waliKelasId || null,
        ruangId: data.ruangId || null,
        kurikulum: data.kurikulum || null,
        jurusan: data.jurusan || null,
        jenisRombel: data.jenisRombel || null,
        kapasitas: data.kapasitas !== undefined ? Number(data.kapasitas) : 80
      },
      include: { lembagaMuadalah: true }
    });
    if (user) {
      const changes: string[] = [];
      if (existing) {
        if (existing.name !== data.name) changes.push(`Nama: "${existing.name}" ➔ "${data.name}"`);
        if (existing.tingkat !== data.tingkat) changes.push(`Tingkat: "${existing.tingkat || '-'}" ➔ "${data.tingkat || '-'}"`);
        if (existing.lembagaMuadalahId !== data.lembagaMuadalahId) {
          const oldName = existing.lembagaMuadalah?.name || '-';
          const newMuadalah = data.lembagaMuadalahId
            ? await this.prisma.lembagaMuadalah.findUnique({ where: { id: data.lembagaMuadalahId } })
            : null;
          const newName = newMuadalah?.name || '-';
          changes.push(`Lembaga Muadalah: "${oldName}" ➔ "${newName}"`);
        }
      }
      const changesStr = changes.length > 0 ? ` (${changes.join(', ')})` : '';
      await this.auditLogService.log('UPDATE', 'KELAS', result.id, result.name, user, `Memperbarui kelas "${result.name}"${changesStr}`);
    }
    return result;
  }

  async toggleKelasStatus(id: string, isActive: boolean, user?: any) {
    const kelas = await this.prisma.kelas.findUnique({
      where: { id },
      include: { cabang: true }
    });
    if (!kelas) {
      throw new NotFoundException('Kelas tidak ditemukan');
    }

    if (user && user.scope === 'WILAYAH') {
      if (!kelas.cabang || kelas.cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda hanya dapat mengubah status kelas di wilayah Anda');
      }
    }
    if (user && user.scope === 'CABANG') {
      if (kelas.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda hanya dapat mengubah status kelas di cabang Anda');
      }
    }

    const result = await this.prisma.kelas.update({
      where: { id },
      data: { isActive }
    });
    if (user) {
      await this.auditLogService.log('UPDATE', 'KELAS', result.id, result.name, user, `Mengubah status kelas "${result.name}" menjadi ${isActive ? 'Aktif' : 'Nonaktif'}`);
    }
    return result;
  }

  async deleteKelas(id: string, user?: any) {
    const existing = await this.prisma.kelas.findUnique({
      where: { id },
      include: { cabang: true }
    });
    if (!existing) {
      throw new NotFoundException('Kelas tidak ditemukan');
    }

    if (user && user.scope === 'WILAYAH') {
      if (!existing.cabang || existing.cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda hanya dapat menghapus kelas di wilayah Anda');
      }
    }
    if (user && user.scope === 'CABANG') {
      if (existing.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda hanya dapat menghapus kelas di cabang Anda');
      }
    }

    const result = await this.prisma.kelas.delete({ where: { id } });
    if (user) {
      await this.auditLogService.log('DELETE', 'KELAS', result.id, result.name, user, `Menghapus kelas "${result.name}"`);
    }
    return result;
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

  async getSiswaFormal(user: any) {
    let whereClause: any = { 
      statusPool: 'AKTIF_CABANG',
      jenisSiswa: 'MUADALAH' 
    };
    
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
            kelas: {
              include: {
                lembagaMuadalah: true
              }
            }
          }
        }
      }
    });
  }

  async updateSiswaFormal(studentId: string, data: { nis?: string, nisn?: string, kelasId?: string, isVerval?: boolean }, user?: any) {
    await this.checkStudentScope(studentId, user);

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { biodataId: true }
    });

    const nis = data.nis === '' ? null : data.nis;
    const nisn = data.nisn === '' ? null : data.nisn;
    const kelasId = data.kelasId === '' ? null : data.kelasId;

    if (student?.biodataId) {
      await this.prisma.biodata.update({
        where: { id: student.biodataId },
        data: {
          nisn: nisn,
          nisLokal: nis,
        }
      });
    }

    const existing = await this.prisma.siswaFormal.findUnique({
      where: { studentId }
    });

    let result;
    if (existing) {
      result = await this.prisma.siswaFormal.update({
        where: { studentId },
        data: {
          nis,
          nisn,
          kelasId,
          ...(data.isVerval !== undefined && { isVerval: data.isVerval }),
        }
      });
    } else {
      result = await this.prisma.siswaFormal.create({
        data: {
          studentId,
          nis,
          nisn,
          kelasId,
          isVerval: data.isVerval || false,
        }
      });
    }

    if (user) {
      await this.auditLogService.log('UPDATE', 'STUDENT_FORMAL', studentId, 'Data Siswa Formal', user, `Memperbarui data formal siswa (NIS: ${nis || '-'}, NISN: ${nisn || '-'})`);
    }

    return result;
  }

  // --- MATA PELAJARAN ---

  async getMapel() {
    return this.prisma.mataPelajaran.findMany({
      orderBy: { name: 'asc' },
      include: {
        keaktifanGrup: true
      }
    });
  }

  async createMapel(data: { kodeMapel: string, name: string, grupMapel: string, isActive?: boolean, activeGrupIds?: string[] }, user?: any) {
    const { activeGrupIds, ...mapelData } = data;
    const result = await this.prisma.mataPelajaran.create({
      data: {
        ...mapelData,
        keaktifanGrup: activeGrupIds ? {
          create: activeGrupIds.map(id => ({ grupDaimiId: id, isActive: true }))
        } : undefined
      },
    });
    if (user) {
      await this.auditLogService.log('CREATE', 'MAPEL', result.id, result.name, user, `Menambahkan mata pelajaran "${result.name}"`);
    }
    return result;
  }

  async updateMapel(id: string, data: { kodeMapel?: string, name?: string, grupMapel?: string, isActive?: boolean, activeGrupIds?: string[] }, user?: any) {
    const existing = await this.prisma.mataPelajaran.findUnique({ where: { id } });
    const { activeGrupIds, ...mapelData } = data;
    const result = await this.prisma.mataPelajaran.update({
      where: { id },
      data: {
        ...mapelData,
        keaktifanGrup: activeGrupIds !== undefined ? {
          deleteMany: {},
          create: activeGrupIds.map(gid => ({ grupDaimiId: gid, isActive: true }))
        } : undefined
      },
    });
    if (user) {
      const changes: string[] = [];
      if (existing) {
        if (data.name !== undefined && existing.name !== data.name) changes.push(`Nama: "${existing.name}" ➔ "${data.name}"`);
        if (data.kodeMapel !== undefined && existing.kodeMapel !== data.kodeMapel) changes.push(`Kode: "${existing.kodeMapel}" ➔ "${data.kodeMapel}"`);
        if (data.grupMapel !== undefined && existing.grupMapel !== data.grupMapel) changes.push(`Grup: "${existing.grupMapel}" ➔ "${data.grupMapel}"`);
      }
      const changesStr = changes.length > 0 ? ` (${changes.join(', ')})` : '';
      await this.auditLogService.log('UPDATE', 'MAPEL', result.id, result.name, user, `Memperbarui mata pelajaran "${result.name}"${changesStr}`);
    }
    return result;
  }

  async deleteMapel(id: string, user?: any) {
    const result = await this.prisma.mataPelajaran.delete({
      where: { id },
    });
    if (user) {
      await this.auditLogService.log('DELETE', 'MAPEL', result.id, result.name, user, `Menghapus mata pelajaran "${result.name}"`);
    }
    return result;
  }

  // --- KEAKTIFAN MAPEL GRUP ---

  async getKeaktifanMapelGrup() {
    return this.prisma.keaktifanMapelGrup.findMany({
      include: {
        mataPelajaran: true,
        // Since we are in multi-schema and defined the relation to grupDaimi, we can include it:
        grupDaimi: true,
      }
    });
  }

  async toggleKeaktifanMapelGrup(data: { mataPelajaranId: string, grupDaimiId: string, isActive: boolean }, user?: any) {
    const result = await this.prisma.keaktifanMapelGrup.upsert({
      where: {
        mataPelajaranId_grupDaimiId: {
          mataPelajaranId: data.mataPelajaranId,
          grupDaimiId: data.grupDaimiId,
        }
      },
      update: {
        isActive: data.isActive,
      },
      create: {
        mataPelajaranId: data.mataPelajaranId,
        grupDaimiId: data.grupDaimiId,
        isActive: data.isActive,
      }
    });

    if (user) {
      await this.auditLogService.log('UPDATE', 'MAPEL_GRUP', `${data.mataPelajaranId}-${data.grupDaimiId}`, 'Keaktifan Mapel Grup', user, `Mengubah status mapel grup menjadi ${data.isActive ? 'Aktif' : 'Nonaktif'}`);
    }

    return result;
  }

  async checkStudentScope(studentId: string, user: any) {
    if (!user || user.scope === 'GLOBAL') return;
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      throw new NotFoundException('Siswa tidak ditemukan');
    }
    if (user.scope === 'WILAYAH') {
      if (student.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda tidak memiliki akses untuk mengedit aktivitas belajar siswa di luar wilayah Anda');
      }
    }
    if (user.scope === 'CABANG') {
      if (student.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda tidak memiliki akses untuk mengedit aktivitas belajar siswa di luar cabang Anda');
      }
    }
  }

  private checkKelasScope(user: any, kelas: { cabangId: string | null; cabang?: { wilayahId: string | null } | null }) {
    if (!user || user.scope === 'GLOBAL') return;
    if (user.scope === 'WILAYAH') {
      if (!kelas.cabang || kelas.cabang.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Anda tidak memiliki akses ke kelas di luar wilayah Anda');
      }
    }
    if (user.scope === 'CABANG') {
      if (kelas.cabangId !== user.cabangId) {
        throw new ForbiddenException('Anda tidak memiliki akses ke kelas di luar cabang Anda');
      }
    }
  }

  // --- RIWAYAT KELAS FORMAL ---

  async getRiwayatKelasByStudent(studentId: string, user?: any) {
    await this.checkStudentScope(studentId, user);
    return this.prisma.riwayatKelasFormal.findMany({
      where: { studentId },
      include: {
        kelas: {
          include: {
            lembagaMuadalah: true
          }
        },
        waliKelas: true,
      },
      orderBy: [
        { tahunAjaran: 'desc' },
        { semester: 'desc' }
      ]
    });
  }

  // --- RIWAYAT NILAI FORMAL (RAPOR) ---

  async getNilaiHistoryByStudent(studentId: string, user?: any) {
    await this.checkStudentScope(studentId, user);
    const history = await this.prisma.nilaiFormal.findMany({
      where: { studentId },
      include: {
        mataPelajaran: true,
        kelas: true,
        riwayatKelas: { select: { grupDaimiId: true } }
      },
      orderBy: [
        { tahunAjaran: 'desc' },
        { semester: 'desc' },
        { mataPelajaran: { kodeMapel: 'asc' } }
      ]
    });

    if (history.length === 0) return [];

    // Hitung rata-rata kelas per (kelasId, mataPelajaranId, tahunAjaran, semester)
    const kelasIds = Array.from(new Set(history.map(h => h.kelasId)));
    const periodeList = Array.from(new Set(history.map(h => `${h.tahunAjaran}||${h.semester}`)))
      .map(p => { const [tahunAjaran, semester] = p.split('||'); return { tahunAjaran, semester }; });

    const allNilaiKelas = await this.prisma.nilaiFormal.findMany({
      where: {
        kelasId: { in: kelasIds },
        OR: periodeList
      },
      select: { kelasId: true, mataPelajaranId: true, tahunAjaran: true, semester: true, nilaiAkhir: true }
    });

    const avgMap = new Map<string, { sum: number; count: number }>();
    allNilaiKelas.forEach(n => {
      if (n.nilaiAkhir === null || n.nilaiAkhir === undefined) return;
      const key = `${n.kelasId}||${n.mataPelajaranId}||${n.tahunAjaran}||${n.semester}`;
      const entry = avgMap.get(key) || { sum: 0, count: 0 };
      entry.sum += n.nilaiAkhir;
      entry.count += 1;
      avgMap.set(key, entry);
    });

    return history.map(h => {
      const key = `${h.kelasId}||${h.mataPelajaranId}||${h.tahunAjaran}||${h.semester}`;
      const avg = avgMap.get(key);
      return {
        ...h,
        rataRataKelas: avg && avg.count > 0 ? Math.round((avg.sum / avg.count) * 100) / 100 : null
      };
    });
  }

  async createRiwayatKelas(data: { studentId: string, kelasId: string, tahunAjaran: string, semester: string, statusAkhir?: string, waliKelasId?: string, catatan?: string }, user?: any) {
    if (user) {
      await this.checkStudentScope(data.studentId, user);
    }

    const existing = await this.prisma.riwayatKelasFormal.findUnique({
      where: {
        studentId_tahunAjaran_semester: {
          studentId: data.studentId,
          tahunAjaran: data.tahunAjaran,
          semester: data.semester
        }
      }
    });

    if (existing) {
      throw new Error(`Riwayat kelas untuk siswa di semester ${data.semester} ${data.tahunAjaran} sudah ada.`);
    }

    const result = await this.prisma.riwayatKelasFormal.create({ data });
    if (user) {
      const { studentName, kelasName } = await this.getRiwayatKelasLogLabels(result.studentId, result.kelasId);
      await this.auditLogService.log('CREATE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${studentName} - ${result.tahunAjaran} ${result.semester}`, user, `Menambahkan riwayat kelas siswa "${studentName}" ke ${kelasName} (${result.tahunAjaran} ${result.semester})`);
    }
    return result;
  }

  async updateRiwayatKelas(id: string, data: { kelasId?: string, tahunAjaran?: string, semester?: string, statusAkhir?: string, waliKelasId?: string, catatan?: string }, user?: any) {
    const existing = await this.prisma.riwayatKelasFormal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Riwayat kelas tidak ditemukan');
    }
    if (user) {
      await this.checkStudentScope(existing.studentId, user);
    }

    const result = await this.prisma.riwayatKelasFormal.update({
      where: { id },
      data
    });
    if (user) {
      const { studentName, kelasName } = await this.getRiwayatKelasLogLabels(result.studentId, result.kelasId);
      await this.auditLogService.log('UPDATE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${studentName} - ${result.tahunAjaran} ${result.semester}`, user, `Memperbarui riwayat kelas siswa "${studentName}" menjadi ${kelasName} (${result.tahunAjaran} ${result.semester})`);
    }
    return result;
  }

  async deleteRiwayatKelas(id: string, user?: any) {
    const existing = await this.prisma.riwayatKelasFormal.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Riwayat kelas tidak ditemukan');
    }
    if (user) {
      await this.checkStudentScope(existing.studentId, user);
    }

    const result = await this.prisma.riwayatKelasFormal.delete({
      where: { id }
    });
    if (user) {
      const { studentName, kelasName } = await this.getRiwayatKelasLogLabels(result.studentId, result.kelasId);
      await this.auditLogService.log('DELETE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${studentName} - ${result.tahunAjaran} ${result.semester}`, user, `Menghapus riwayat kelas siswa "${studentName}" dari ${kelasName} (${result.tahunAjaran} ${result.semester})`);
    }
    return result;
  }

  // Label nama siswa & kelas untuk pesan audit log yang bisa dibaca (bukan raw UUID) -
  // dipakai oleh create/update/deleteRiwayatKelas.
  private async getRiwayatKelasLogLabels(studentId: string, kelasId: string) {
    const [student, kelas] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: studentId }, select: { biodata: { select: { fullName: true } } } }),
      this.prisma.kelas.findUnique({ where: { id: kelasId }, select: { name: true } })
    ]);
    return {
      studentName: student?.biodata?.fullName || 'Siswa tidak diketahui',
      kelasName: kelas?.name || 'Kelas tidak diketahui'
    };
  }

  // Kelas.tingkat/SiswaFormal.tingkat kadang diisi angka ("7") kadang angka Romawi ("VII") -
  // lihat dashboard.service.ts yang mengecek keduanya. Parse & format ulang harus mendukung
  // kedua bentuk, supaya kenaikan tingkat tidak diam-diam gagal untuk format Romawi.
  private static readonly ROMAN_TINGKAT: Record<string, number> = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12
  };

  private parseTingkatToNumber(tingkat: string): number | null {
    const trimmed = tingkat.trim().toUpperCase();
    const asNum = parseInt(trimmed, 10);
    if (!isNaN(asNum)) return asNum;
    return FormalService.ROMAN_TINGKAT[trimmed] ?? null;
  }

  private formatTingkatLikeInput(originalTingkat: string, num: number): string {
    const trimmed = originalTingkat.trim().toUpperCase();
    const isRomanInput = isNaN(parseInt(trimmed, 10)) && FormalService.ROMAN_TINGKAT[trimmed] !== undefined;
    if (isRomanInput) {
      const romanEntry = Object.entries(FormalService.ROMAN_TINGKAT).find(([, v]) => v === num);
      return romanEntry ? romanEntry[0] : String(num);
    }
    return String(num);
  }

  async prosesKenaikanKelasMassal(payload: {
    kelasAsalId: string;
    tahunAjaranLama: string;
    semesterLama: string;
    tahunAjaranBaru: string;
    semesterBaru: string;
    students: {
      studentId: string;
      statusAkhir: string;
    }[];
  }, user: any) {
    return this.prisma.$transaction(async (tx) => {
      let successCount = 0;
      const tingkatTidakDikenali: string[] = [];
      const kelasAsal = await tx.kelas.findUnique({ where: { id: payload.kelasAsalId } });

      for (const st of payload.students) {
        // 1. Update Riwayat Lama (jika ada)
        const oldRiwayat = await tx.riwayatKelasFormal.findUnique({
          where: {
            studentId_tahunAjaran_semester: {
              studentId: st.studentId,
              tahunAjaran: payload.tahunAjaranLama,
              semester: payload.semesterLama
            }
          }
        });

        if (oldRiwayat) {
          await tx.riwayatKelasFormal.update({
            where: { id: oldRiwayat.id },
            data: { statusAkhir: st.statusAkhir }
          });
        } else {
          // Buat riwayat lama jika belum ada (jaga-jaga)
          await tx.riwayatKelasFormal.create({
            data: {
              studentId: st.studentId,
              kelasId: payload.kelasAsalId,
              tahunAjaran: payload.tahunAjaranLama,
              semester: payload.semesterLama,
              statusAkhir: st.statusAkhir
            }
          });
        }

        // 2. Fetch current SiswaFormal to get tingkat
        const siswaFormal = await tx.siswaFormal.findUnique({
          where: { studentId: st.studentId }
        });

        const currentTingkat = siswaFormal?.tingkat || kelasAsal?.tingkat || '7';
        const currentTingkatNum = this.parseTingkatToNumber(currentTingkat);
        let nextTingkat = currentTingkat;
        let isLulus = st.statusAkhir === 'LULUS';

        if (st.statusAkhir === 'NAIK_KELAS' || st.statusAkhir === 'NAIK_TINGKAT') {
          if (currentTingkatNum !== null) {
             if (currentTingkatNum >= 12) {
                isLulus = true;
             } else {
                nextTingkat = this.formatTingkatLikeInput(currentTingkat, currentTingkatNum + 1);
             }
          } else {
            // Format tingkat tidak dikenali (bukan angka atau angka Romawi I-XII) - jangan diam-diam
            // dianggap berhasil naik, catat supaya admin tahu perlu perbaikan data manual.
            tingkatTidakDikenali.push(`${st.studentId} (tingkat: "${currentTingkat}")`);
          }
        }

        // 3. Logic berdasarkan statusAkhir
        if (isLulus) {
          // Lulus: Cabut dari kelas formal, ubah status pool jadi LULUS
          await tx.siswaFormal.update({
            where: { studentId: st.studentId },
            data: { kelasId: null, tingkat: 'LULUS' }
          });
          
          await tx.student.update({
            where: { id: st.studentId },
            data: { statusPool: 'LULUS' }
          });
          
          // Opsional: Tutup riwayat pendidikan cabang jika ada yang aktif
          const activeRiwayatPendidikan = await tx.riwayatPendidikan.findFirst({
            where: { studentId: st.studentId, tanggalKeluar: null },
            orderBy: { tanggalMasuk: 'desc' }
          });
          
          if (activeRiwayatPendidikan) {
            await tx.riwayatPendidikan.update({
              where: { id: activeRiwayatPendidikan.id },
              data: { 
                tanggalKeluar: new Date(),
                statusAkhir: 'LULUS'
              }
            });
          }
        } else if (st.statusAkhir === 'PINDAH' || st.statusAkhir === 'DROP_OUT') {
           // Sama seperti lulus, cabut dari kelas
           await tx.siswaFormal.update({
            where: { studentId: st.studentId },
            data: { kelasId: null }
          });
          
          await tx.student.update({
            where: { id: st.studentId },
            data: { statusPool: 'DROP_OUT' }
          });
        } else if (st.statusAkhir === 'NAIK_KELAS' || st.statusAkhir === 'NAIK_TINGKAT' || st.statusAkhir === 'TINGGAL_KELAS' || st.statusAkhir === 'TINGGAL_TINGKAT') {
          // Jika naik tingkat / tinggal tingkat, unassign dari kelas dan update tingkat
          await tx.siswaFormal.update({
             where: { studentId: st.studentId },
             data: { kelasId: null, tingkat: nextTingkat }
          });
        }

        successCount++;
      }

      const warningNote = tingkatTidakDikenali.length > 0
        ? `, ${tingkatTidakDikenali.length} siswa tingkatnya TIDAK berubah (format tingkat tidak dikenali: ${tingkatTidakDikenali.join(', ')})`
        : '';

      await this.auditLogService.log(
        'UPDATE',
        'KENAIKAN_KELAS',
        payload.kelasAsalId,
        `Kenaikan Massal ${payload.tahunAjaranLama} -> ${payload.tahunAjaranBaru}`,
        user,
        `Memproses ${successCount} siswa dari kelas asal ID ${payload.kelasAsalId}${warningNote}`
      );

      return { success: true, processed: successCount, tingkatTidakDikenali };
    });
  }

  async prosesKenaikanBulk(payload: {
    kelasAsalIds: string[];
    tahunAjaranLama: string;
    semesterLama: string;
    tahunAjaranBaru: string;
    semesterBaru: string;
  }, user: any) {
    let totalProcessed = 0;
    const tingkatTidakDikenali: string[] = [];
    for (const kelasId of payload.kelasAsalIds) {
      const students = await this.prisma.siswaFormal.findMany({ where: { kelasId } });
      if (students.length > 0) {
        const result = await this.prosesKenaikanKelasMassal({
          kelasAsalId: kelasId,
          tahunAjaranLama: payload.tahunAjaranLama,
          semesterLama: payload.semesterLama,
          tahunAjaranBaru: payload.tahunAjaranBaru,
          semesterBaru: payload.semesterBaru,
          students: students.map(s => ({
            studentId: s.studentId,
            statusAkhir: 'NAIK_TINGKAT'
          }))
        }, user);
        totalProcessed += result.processed;
        tingkatTidakDikenali.push(...result.tingkatTidakDikenali);
      }
    }
    return { success: true, processed: totalProcessed, tingkatTidakDikenali };
  }

  async getStudentsByKelas(kelasId: string) {
    return this.prisma.student.findMany({
      where: {
        siswaFormal: {
          kelasId: kelasId
        },
        statusPool: { not: 'TERSEDIA' }
      },
      include: {
        biodata: true,
        siswaFormal: {
          include: { kelas: true }
        }
      },
      orderBy: {
        biodata: { fullName: 'asc' }
      }
    });
  }

  async getGuruMapelKelas(user: any) {
    let whereClause: any = {};
    if (user.scope === 'CABANG') {
      whereClause = { kelas: { cabangId: user.cabangId } };
    } else if (user.scope === 'WILAYAH') {
      whereClause = { kelas: { cabang: { wilayahId: user.wilayahId } } };
    }

    return this.prisma.guruMapelKelas.findMany({
      where: whereClause,
      include: {
        staff: true,
        mataPelajaran: true,
        kelas: {
          include: {
            cabang: {
              include: { wilayah: true }
            }
          }
        }
      },
      orderBy: [
        { kelas: { name: 'asc' } },
        { staff: { name: 'asc' } }
      ]
    });
  }

  async createGuruMapelKelas(user: any, data: any) {
    const { staffId, mataPelajaranId, kelasId } = data;

    // Check if the kelas exists and matches user scope
    const targetKelas = await this.prisma.kelas.findUnique({
      where: { id: kelasId },
      include: { cabang: true }
    });
    if (!targetKelas) throw new NotFoundException('Kelas tidak ditemukan');

    if (user.scope === 'CABANG' && targetKelas.cabangId !== user.cabangId) {
      throw new NotFoundException('Kelas tidak ditemukan di cabang Anda');
    }
    if (user.scope === 'WILAYAH' && targetKelas.cabang?.wilayahId !== user.wilayahId) {
      throw new NotFoundException('Kelas tidak ditemukan di wilayah Anda');
    }

    // Check if the staff exists and matches user scope
    const targetStaff = await this.prisma.staff.findUnique({
      where: { id: staffId }
    });
    if (!targetStaff) throw new NotFoundException('Guru tidak ditemukan');

    if (user.scope === 'CABANG' && targetStaff.cabangId !== user.cabangId) {
      throw new BadRequestException('Guru tidak terdaftar di cabang Anda');
    }
    if (user.scope === 'WILAYAH' && targetStaff.wilayahId !== user.wilayahId) {
      throw new BadRequestException('Guru tidak terdaftar di wilayah Anda');
    }

    // Check if duplicate assignment exists
    const existing = await this.prisma.guruMapelKelas.findUnique({
      where: {
        staffId_mataPelajaranId_kelasId: {
          staffId,
          mataPelajaranId,
          kelasId
        }
      }
    });
    if (existing) {
      throw new BadRequestException('Guru sudah ditugaskan untuk mata pelajaran ini di kelas tersebut');
    }

    return this.prisma.guruMapelKelas.create({
      data: {
        staffId,
        mataPelajaranId,
        kelasId
      }
    });
  }

  async deleteGuruMapelKelas(user: any, id: string) {
    const existing = await this.prisma.guruMapelKelas.findUnique({
      where: { id },
      include: {
        kelas: {
          include: { cabang: true }
        }
      }
    });
    if (!existing) throw new NotFoundException('Penugasan tidak ditemukan');

    if (user.scope === 'CABANG' && existing.kelas.cabangId !== user.cabangId) {
      throw new NotFoundException('Penugasan tidak ditemukan di cabang Anda');
    }
    if (user.scope === 'WILAYAH' && existing.kelas.cabang?.wilayahId !== user.wilayahId) {
      throw new NotFoundException('Penugasan tidak ditemukan di wilayah Anda');
    }

    return this.prisma.guruMapelKelas.delete({
      where: { id }
    });
  }

  async getLembagaMuadalah(user?: any) {
    const where: any = {};
    if (user?.scope === 'CABANG') {
      where.kelas = {
        some: {
          cabangId: user.cabangId
        }
      };
    }

    return this.prisma.lembagaMuadalah.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        kelas: {
          where: user?.scope === 'CABANG' ? { cabangId: user.cabangId } : undefined,
          include: {
            cabang: {
              include: {
                wilayah: true
              }
            }
          }
        }
      }
    });
  }

  async createLembagaMuadalah(data: { 
    name: string; 
    code: string; 
    npsn?: string; 
    nspp?: string; 
    namaKetua?: string; 
    ttdKetua?: string; 
    skSpm?: string; 
    isActive?: boolean;
    namaLain?: string;
    jenjang?: string;
    provinsi?: string;
    kabupaten?: string;
    kecamatan?: string;
    kelurahan?: string;
    alamatDetail?: string;
  }, user?: any) {
    const existing = await this.prisma.lembagaMuadalah.findUnique({
      where: { code: data.code }
    });
    if (existing) {
      throw new BadRequestException('Kode Lembaga Muadalah sudah terdaftar');
    }
    const result = await this.prisma.lembagaMuadalah.create({
      data: {
        name: data.name,
        code: data.code,
        npsn: data.npsn || null,
        nspp: data.nspp || null,
        namaKetua: data.namaKetua || null,
        ttdKetua: data.ttdKetua || null,
        skSpm: data.skSpm || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        namaLain: data.namaLain || null,
        jenjang: data.jenjang || null,
        provinsi: data.provinsi || null,
        kabupaten: data.kabupaten || null,
        kecamatan: data.kecamatan || null,
        kelurahan: data.kelurahan || null,
        alamatDetail: data.alamatDetail || null,
      }
    });
    if (user) {
      await this.auditLogService.log('CREATE', 'LEMBAGA_MUADALAH', result.id, result.name, user, `Menambahkan lembaga muadalah baru "${result.name}"`);
    }
    return result;
  }

  async updateLembagaMuadalah(id: string, data: { 
    name: string; 
    code: string; 
    npsn?: string; 
    nspp?: string; 
    namaKetua?: string; 
    ttdKetua?: string; 
    skSpm?: string;
    namaLain?: string;
    jenjang?: string;
    provinsi?: string;
    kabupaten?: string;
    kecamatan?: string;
    kelurahan?: string;
    alamatDetail?: string;
  }, user?: any) {
    const existingCode = await this.prisma.lembagaMuadalah.findFirst({
      where: {
        code: data.code,
        id: { not: id }
      }
    });
    if (existingCode) {
      throw new BadRequestException('Kode Lembaga Muadalah sudah terdaftar');
    }
    const existing = await this.prisma.lembagaMuadalah.findUnique({ where: { id } });
    const result = await this.prisma.lembagaMuadalah.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        npsn: data.npsn || null,
        nspp: data.nspp || null,
        namaKetua: data.namaKetua || null,
        ttdKetua: data.ttdKetua || null,
        skSpm: data.skSpm || null,
        namaLain: data.namaLain !== undefined ? data.namaLain : undefined,
        jenjang: data.jenjang !== undefined ? data.jenjang : undefined,
        provinsi: data.provinsi !== undefined ? data.provinsi : undefined,
        kabupaten: data.kabupaten !== undefined ? data.kabupaten : undefined,
        kecamatan: data.kecamatan !== undefined ? data.kecamatan : undefined,
        kelurahan: data.kelurahan !== undefined ? data.kelurahan : undefined,
        alamatDetail: data.alamatDetail !== undefined ? data.alamatDetail : undefined,
      }
    });
    if (user) {
      const changes: string[] = [];
      if (existing) {
        if (existing.name !== data.name) changes.push(`Nama: "${existing.name}" ➔ "${data.name}"`);
        if (existing.code !== data.code) changes.push(`Kode: "${existing.code}" ➔ "${data.code}"`);
        if (existing.npsn !== data.npsn) changes.push(`NPSN: "${existing.npsn || '-'}" ➔ "${data.npsn || '-'}"`);
        if (existing.nspp !== data.nspp) changes.push(`NSPP: "${existing.nspp || '-'}" ➔ "${data.nspp || '-'}"`);
        if (existing.namaKetua !== data.namaKetua) changes.push(`Ketua: "${existing.namaKetua || '-'}" ➔ "${data.namaKetua || '-'}"`);
        if (existing.ttdKetua !== data.ttdKetua) changes.push(`TTD Ketua diperbarui`);
        if (existing.skSpm !== data.skSpm) changes.push(`SK SPM diperbarui`);
      }
      const changesStr = changes.length > 0 ? ` (${changes.join(', ')})` : '';
      await this.auditLogService.log('UPDATE', 'LEMBAGA_MUADALAH', result.id, result.name, user, `Memperbarui lembaga muadalah "${result.name}"${changesStr}`);
    }
    return result;
  }

  async toggleLembagaMuadalahStatus(id: string, isActive: boolean, user?: any) {
    const existing = await this.prisma.lembagaMuadalah.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Lembaga Muadalah tidak ditemukan');
    const result = await this.prisma.lembagaMuadalah.update({
      where: { id },
      data: { isActive }
    });
    if (user) {
      await this.auditLogService.log('UPDATE', 'LEMBAGA_MUADALAH', result.id, result.name, user, `Mengubah status lembaga muadalah "${result.name}" menjadi ${isActive ? 'Aktif' : 'Nonaktif'}`);
    }
    return result;
  }

  async deleteLembagaMuadalah(id: string, user?: any) {
    const existing = await this.prisma.lembagaMuadalah.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Lembaga Muadalah tidak ditemukan');
    const result = await this.prisma.lembagaMuadalah.delete({ where: { id } });
    if (user) {
      await this.auditLogService.log('DELETE', 'LEMBAGA_MUADALAH', result.id, result.name, user, `Menghapus lembaga muadalah "${result.name}"`);
    }
    return result;
  }

  async getKelasById(id: string, user?: any) {
    const kelas = await this.prisma.kelas.findUnique({
      where: { id },
      include: {
        cabang: { include: { wilayah: true } },
        lembagaMuadalah: true,
        waliKelas: true,
        ruang: true
      }
    });
    if (!kelas) throw new NotFoundException('Kelas tidak ditemukan');
    this.checkKelasScope(user, kelas);
    return kelas;
  }

  async addStudentToKelas(kelasId: string, studentId: string, user?: any) {
    const kelas = await this.prisma.kelas.findUnique({ where: { id: kelasId }, include: { cabang: true } });
    if (!kelas) throw new NotFoundException('Kelas tidak ditemukan');
    this.checkKelasScope(user, kelas);
    await this.checkStudentScope(studentId, user);

    const existing = await this.prisma.siswaFormal.findUnique({
      where: { studentId }
    });

    if (existing && existing.tingkat && kelas.tingkat && existing.tingkat !== kelas.tingkat) {
      throw new BadRequestException(`Siswa memiliki tingkat ${existing.tingkat}, tidak dapat dimasukkan ke rombel tingkat ${kelas.tingkat}`);
    }

    // Automatically set student's jenisSiswa to 'MUADALAH' when they enter a rombel
    await this.prisma.student.update({
      where: { id: studentId },
      data: { jenisSiswa: 'MUADALAH' }
    });

    if (existing) {
      return this.prisma.siswaFormal.update({
        where: { studentId },
        data: { kelasId, tingkat: kelas.tingkat }
      });
    } else {
      // Find the student's NISN and NIK to populate on create if possible
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
        include: { biodata: true }
      });
      return this.prisma.siswaFormal.create({
        data: {
          studentId,
          kelasId,
          tingkat: kelas.tingkat,
          nisn: student?.biodata?.nisn || null,
          nis: student?.biodata?.nisLokal || null
        }
      });
    }
  }

  async removeStudentFromKelas(kelasId: string, studentId: string, user?: any) {
    const kelas = await this.prisma.kelas.findUnique({ where: { id: kelasId }, include: { cabang: true } });
    if (!kelas) throw new NotFoundException('Kelas tidak ditemukan');
    this.checkKelasScope(user, kelas);
    await this.checkStudentScope(studentId, user);

    const existing = await this.prisma.siswaFormal.findUnique({
      where: { studentId }
    });
    if (existing && existing.kelasId === kelasId) {
      return this.prisma.siswaFormal.update({
        where: { studentId },
        data: { kelasId: null }
      });
    }
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODUL e-RAPOR MADRASAH INDONESIA
  // ═══════════════════════════════════════════════════════════════════════════

  async getERaporNilai(kelasId: string, mataPelajaranId: string, tahunAjaran: string, semester: string) {
    const siswaList = await this.prisma.siswaFormal.findMany({
      where: { kelasId },
      include: {
        student: {
          include: {
            biodata: true,
            dataDaimi: {
              include: { grup: true }
            }
          }
        }
      },
      orderBy: { student: { biodata: { fullName: 'asc' } } }
    });

    const existingNilai = await this.prisma.nilaiFormal.findMany({
      where: {
        kelasId,
        mataPelajaranId,
        tahunAjaran,
        semester
      }
    });

    const nilaiMap = new Map(existingNilai.map(n => [n.studentId, n]));

    const keaktifanList = await this.prisma.keaktifanMapelGrup.findMany({
      where: { mataPelajaranId }
    });
    const keaktifanMap = new Map(keaktifanList.map(k => [k.grupDaimiId, k.isActive]));

    return siswaList.map(s => {
      const saved = nilaiMap.get(s.studentId);
      const jenisGrupDaimi = s.student.dataDaimi?.grup?.jenis || s.student.dataDaimi?.grup?.name || s.student.grupDaimi || '-';
      const grupDaimiId = s.student.dataDaimi?.grupId ?? null;
      const mapelAktifUntukGrup = !!grupDaimiId && keaktifanMap.get(grupDaimiId) === true;
      const isHafizlik = s.student.dataDaimi?.grup?.jenis === 'HAFIZLIK';
      return {
        studentId: s.studentId,
        nisn: s.nisn || s.student.biodata?.nisn || '',
        nis: s.nis || s.student.biodata?.nisLokal || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        jenisGrupDaimi,
        isHafizlik,
        nilaiAkhir: saved?.nilaiAkhir ?? null,
        predikat: saved?.predikat ?? '',
        mapelAktifUntukGrup,
        canInput: mapelAktifUntukGrup,
      };
    });
  }

  async saveERaporNilaiBatch(payload: {
    kelasId: string;
    mataPelajaranId: string;
    tahunAjaran: string;
    semester: string;
    data: Array<{
      studentId: string;
      nilaiAkhir?: number | null;
      predikat?: string;
    }>;
  }, user?: any) {
    const { kelasId, mataPelajaranId, tahunAjaran, semester, data } = payload;

    const studentIds = data.map(item => item.studentId);
    const [siswaGrupList, keaktifanList] = await Promise.all([
      this.prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, dataDaimi: { select: { grupId: true } } }
      }),
      this.prisma.keaktifanMapelGrup.findMany({ where: { mataPelajaranId } })
    ]);
    const grupMap = new Map(siswaGrupList.map(s => [s.id, s.dataDaimi?.grupId ?? null]));
    const keaktifanMap = new Map(keaktifanList.map(k => [k.grupDaimiId, k.isActive]));

    const isAllowed = (studentId: string) => {
      const grupDaimiId = grupMap.get(studentId);
      return !!grupDaimiId && keaktifanMap.get(grupDaimiId) === true;
    };

    const blockedData = data.filter(item => !isAllowed(item.studentId));
    const allowedData = data.filter(item => isAllowed(item.studentId));

    return this.prisma.$transaction(async (tx) => {
      let savedCount = 0;

      for (const item of allowedData) {
        const grupDaimiId = grupMap.get(item.studentId) ?? null;
        let riwayat = await tx.riwayatKelasFormal.findUnique({
          where: {
            studentId_tahunAjaran_semester: {
              studentId: item.studentId,
              tahunAjaran,
              semester
            }
          }
        });

        if (!riwayat) {
          riwayat = await tx.riwayatKelasFormal.create({
            data: {
              studentId: item.studentId,
              kelasId,
              tahunAjaran,
              semester,
              grupDaimiId
            }
          });
        } else if (riwayat.kelasId !== kelasId || riwayat.grupDaimiId !== grupDaimiId) {
          // Siswa pindah kelas di tengah periode aktif - sinkronkan supaya leger/presensi/
          // cetak rapor tidak nyasar ke kelas lama (bug ditemukan lewat audit logika sesi ini).
          riwayat = await tx.riwayatKelasFormal.update({
            where: { id: riwayat.id },
            data: { kelasId, grupDaimiId }
          });
        }

        const finalScore = item.nilaiAkhir !== undefined && item.nilaiAkhir !== null ? Number(item.nilaiAkhir) : null;

        let predikatVal = item.predikat;
        if (finalScore !== null && finalScore !== undefined) {
          if (finalScore >= 90) predikatVal = 'A';
          else if (finalScore >= 81) predikatVal = 'B+';
          else if (finalScore >= 76) predikatVal = 'B';
          else predikatVal = 'C+';
        }

        await tx.nilaiFormal.upsert({
          where: {
            studentId_mataPelajaranId_tahunAjaran_semester: {
              studentId: item.studentId,
              mataPelajaranId,
              tahunAjaran,
              semester
            }
          },
          update: {
            kelasId,
            riwayatKelasId: riwayat.id,
            nilaiAkhir: finalScore,
            predikat: predikatVal || null
          },
          create: {
            studentId: item.studentId,
            mataPelajaranId,
            kelasId,
            riwayatKelasId: riwayat.id,
            tahunAjaran,
            semester,
            nilaiAkhir: finalScore,
            predikat: predikatVal || null
          }
        });

        savedCount++;
      }

      if (user) {
        const skippedNote = blockedData.length > 0 ? `, ${blockedData.length} siswa dilewati (mapel nonaktif untuk grup daimi)` : '';
        await this.auditLogService.log('UPDATE', 'E_RAPOR_NILAI', kelasId, `Entry Nilai e-Rapor ${tahunAjaran} ${semester}`, user, `Menyimpan ${savedCount} nilai mapel ID ${mataPelajaranId}${skippedNote}`);
      }

      return { success: true, count: savedCount, skippedCount: blockedData.length };
    });
  }

  // Input/edit nilai lintas mapel untuk SATU siswa pada satu periode (backfill nilai
  // semester/tahun ajaran lampau, mis. nilai kelas 10 saat siswa sudah di kelas 11).
  // Sengaja MENOLAK periode yang sama dengan periode aktif di Pengaturan Akademik,
  // supaya jalur backfill ini tidak pernah bisa menyentuh/menimpa data nilai yang sedang
  // berjalan - untuk periode aktif tetap harus lewat saveERaporNilaiBatch (tab Input Nilai Mapel).
  async saveNilaiForStudentPeriod(payload: {
    studentId: string;
    kelasId: string;
    tahunAjaran: string;
    semester: string;
    grupDaimiId: string;
    data: Array<{
      mataPelajaranId: string;
      nilaiAkhir?: number | null;
    }>;
  }, user?: any) {
    const { studentId, kelasId, tahunAjaran, semester, grupDaimiId, data } = payload;

    if (!studentId || !kelasId || !tahunAjaran || !semester || !grupDaimiId) {
      throw new BadRequestException('Parameter studentId, kelasId, tahunAjaran, semester, dan grupDaimiId wajib diisi');
    }

    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const semesterOrder = (s: string) => {
      const normalized = s?.toUpperCase();
      if (normalized === 'GANJIL') return 0;
      if (normalized === 'GENAP') return 1;
      return 2;
    };
    if (pengaturan?.tahunAjaran && pengaturan?.semesterAktif) {
      const isPeriodeAktif = tahunAjaran === pengaturan.tahunAjaran && semesterOrder(semester) === semesterOrder(pengaturan.semesterAktif);
      if (isPeriodeAktif) {
        throw new BadRequestException('Periode ini adalah periode aktif saat ini, gunakan tab Input Nilai Mapel untuk mengubahnya');
      }
    }

    const mapelIds = data.map(item => item.mataPelajaranId);
    const keaktifanList = await this.prisma.keaktifanMapelGrup.findMany({
      where: { mataPelajaranId: { in: mapelIds } }
    });
    const keaktifanMap = new Map(keaktifanList.map(k => [`${k.mataPelajaranId}||${k.grupDaimiId}`, k.isActive]));

    const isAllowed = (mataPelajaranId: string) => {
      if (!grupDaimiId) return false;
      return keaktifanMap.get(`${mataPelajaranId}||${grupDaimiId}`) === true;
    };

    const allowedData = data.filter(item => isAllowed(item.mataPelajaranId));
    const skippedCount = data.length - allowedData.length;

    return this.prisma.$transaction(async (tx) => {
      let riwayat = await tx.riwayatKelasFormal.findUnique({
        where: {
          studentId_tahunAjaran_semester: { studentId, tahunAjaran, semester }
        }
      });

      if (!riwayat) {
        riwayat = await tx.riwayatKelasFormal.create({
          data: { studentId, kelasId, tahunAjaran, semester, grupDaimiId }
        });
      } else if (riwayat.kelasId !== kelasId || riwayat.grupDaimiId !== grupDaimiId) {
        riwayat = await tx.riwayatKelasFormal.update({
          where: { id: riwayat.id },
          data: { kelasId, grupDaimiId }
        });
      }

      let savedCount = 0;
      for (const item of allowedData) {
        const finalScore = item.nilaiAkhir !== undefined && item.nilaiAkhir !== null ? Number(item.nilaiAkhir) : null;

        let predikatVal: string | null = null;
        if (finalScore !== null && finalScore !== undefined) {
          if (finalScore >= 90) predikatVal = 'A';
          else if (finalScore >= 81) predikatVal = 'B+';
          else if (finalScore >= 76) predikatVal = 'B';
          else predikatVal = 'C+';
        }

        await tx.nilaiFormal.upsert({
          where: {
            studentId_mataPelajaranId_tahunAjaran_semester: {
              studentId,
              mataPelajaranId: item.mataPelajaranId,
              tahunAjaran,
              semester
            }
          },
          update: {
            kelasId,
            riwayatKelasId: riwayat.id,
            nilaiAkhir: finalScore,
            predikat: predikatVal
          },
          create: {
            studentId,
            mataPelajaranId: item.mataPelajaranId,
            kelasId,
            riwayatKelasId: riwayat.id,
            tahunAjaran,
            semester,
            nilaiAkhir: finalScore,
            predikat: predikatVal
          }
        });

        savedCount++;
      }

      if (user) {
        const skippedNote = skippedCount > 0 ? `, ${skippedCount} mapel dilewati (nonaktif untuk grup daimi)` : '';
        await this.auditLogService.log('UPDATE', 'E_RAPOR_NILAI', studentId, `Entry Nilai Riwayat ${tahunAjaran} ${semester}`, user, `Menyimpan ${savedCount} nilai mapel untuk siswa (input riwayat/backfill)${skippedNote}`);
      }

      return { success: true, count: savedCount, skippedCount };
    });
  }

  // Import massal nilai riwayat (backfill lintas siswa) dari file Excel yang sudah di-parse
  // jadi array of row object di frontend. Setiap baris divalidasi independen - baris yang
  // gagal tidak menggagalkan baris lain, cukup dilaporkan di errorRows. Sama seperti
  // saveNilaiForStudentPeriod, menolak keras periode yang sama dengan periode aktif.
  async importRiwayatNilai(rows: any[], user: any) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Data import kosong');
    }

    const normalize = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const getValue = (row: Record<string, any>, aliases: string[]) => {
      const normalizedRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[normalize(k)] = v;
      }
      for (const alias of aliases) {
        const val = normalizedRow[normalize(alias)];
        if (val !== undefined && val !== null && String(val).trim() !== '') return val;
      }
      return '';
    };

    const semesterOrder = (s: string) => {
      const n = s?.toUpperCase();
      if (n === 'GANJIL') return 0;
      if (n === 'GENAP') return 1;
      return 2;
    };

    const [pengaturan, allMapel, keaktifanList] = await Promise.all([
      this.prisma.pengaturanAkademik.findFirst(),
      this.prisma.mataPelajaran.findMany({ where: { isActive: true } }),
      this.prisma.keaktifanMapelGrup.findMany()
    ]);
    const keaktifanMap = new Map(keaktifanList.map(k => [`${k.mataPelajaranId}||${k.grupDaimiId}`, k.isActive]));
    const mapelByNormalizedName = new Map(allMapel.map(m => [normalize(m.name), m]));

    // Parsing awal tiap baris: ambil field tetap + NIK, supaya bisa batch-resolve referensi
    const parsedRows = rows.map((rawRow, idx) => {
      const nik = String(getValue(rawRow, ['nik', 'NIK']) || '').trim();
      const namaSiswa = String(getValue(rawRow, ['nama_siswa', 'Nama Siswa']) || '').trim();
      const tahunAjaran = String(getValue(rawRow, ['tahun_ajaran', 'Tahun Ajaran']) || '').trim();
      const semester = String(getValue(rawRow, ['semester', 'Semester']) || '').trim();
      const kelasRombelName = String(getValue(rawRow, ['kelas_rombel', 'Kelas Rombel', 'kelas']) || '').trim();
      const grupDaimiName = String(getValue(rawRow, ['jenis_grup_daimi', 'Jenis Grup Daimi', 'grup_daimi']) || '').trim();

      const mapelValues: Array<{ mapel: any; rawValue: any }> = [];
      allMapel.forEach(m => {
        const val = getValue(rawRow, [m.name]);
        if (val !== '') mapelValues.push({ mapel: m, rawValue: val });
      });

      return { rowNumber: idx + 1, nik, namaSiswa, tahunAjaran, semester, kelasRombelName, grupDaimiName, mapelValues };
    });

    const errorRows: Array<{ row: number; nik: string; message: string }> = [];
    const niks = Array.from(new Set(parsedRows.map(r => r.nik).filter(Boolean)));

    const students = await this.prisma.student.findMany({
      where: { biodata: { nik: { in: niks } } },
      include: {
        biodata: true,
        cabang: true,
        dataDaimi: { include: { grup: true } },
        siswaFormal: true
      }
    });
    const studentByNik = new Map(students.map(s => [s.biodata?.nik, s]));

    const cabangIds = Array.from(new Set(students.map(s => s.cabangId).filter((v): v is string => !!v)));
    const [allKelas, allGrupDaimi] = await Promise.all([
      cabangIds.length > 0 ? this.prisma.kelas.findMany({ where: { cabangId: { in: cabangIds } } }) : Promise.resolve([]),
      cabangIds.length > 0 ? this.prisma.grupDaimi.findMany({ where: { cabangId: { in: cabangIds } } }) : Promise.resolve([])
    ]);

    let skippedMapelCount = 0;
    const validRows: Array<{
      rowNumber: number; studentId: string; kelasId: string; tahunAjaran: string; semester: string;
      data: Array<{ mataPelajaranId: string; nilaiAkhir: number | null }>;
    }> = [];

    for (const r of parsedRows) {
      if (!r.nik) { errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'NIK kosong' }); continue; }
      const student = studentByNik.get(r.nik);
      if (!student) { errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'NIK tidak ditemukan' }); continue; }
      if (!student.siswaFormal) { errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Siswa ini bukan siswa berkelas formal' }); continue; }

      if (user.scope === 'CABANG' && user.cabangId && student.cabangId !== user.cabangId) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Siswa di luar cabang Anda' }); continue;
      }
      if (user.scope === 'WILAYAH' && user.wilayahId && student.cabang?.wilayahId !== user.wilayahId) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Siswa di luar wilayah Anda' }); continue;
      }

      if (!r.tahunAjaran || !r.semester) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Tahun ajaran / semester kosong' }); continue;
      }

      if (pengaturan?.tahunAjaran && pengaturan?.semesterAktif) {
        const isPeriodeAktif = r.tahunAjaran === pengaturan.tahunAjaran && semesterOrder(r.semester) === semesterOrder(pengaturan.semesterAktif);
        if (isPeriodeAktif) {
          errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Periode ini adalah periode aktif, gunakan tab Input Nilai Mapel' }); continue;
        }
      }

      if (!r.kelasRombelName) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Kelas/rombel kosong' }); continue;
      }
      const matchingKelas = allKelas.filter(k =>
        k.cabangId === student.cabangId &&
        k.tahunAjaran === r.tahunAjaran &&
        normalize(k.name) === normalize(r.kelasRombelName)
      );
      if (matchingKelas.length === 0) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: `Kelas/rombel "${r.kelasRombelName}" tidak ditemukan untuk cabang & tahun ajaran ini` }); continue;
      }
      if (matchingKelas.length > 1) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: `Nama kelas/rombel "${r.kelasRombelName}" ambigu (ada ${matchingKelas.length} kelas dengan nama sama)` }); continue;
      }
      const kelas = matchingKelas[0];

      let grupDaimiId: string | null = student.dataDaimi?.grupId ?? null;
      if (r.grupDaimiName) {
        const matchingGrup = allGrupDaimi.filter(g =>
          g.cabangId === student.cabangId &&
          (normalize(g.name) === normalize(r.grupDaimiName) || normalize(g.jenis || '') === normalize(r.grupDaimiName))
        );
        if (matchingGrup.length === 0) {
          errorRows.push({ row: r.rowNumber, nik: r.nik, message: `Jenis grup daimi "${r.grupDaimiName}" tidak ditemukan untuk cabang ini` }); continue;
        }
        grupDaimiId = matchingGrup[0].id;
      }
      if (!grupDaimiId) {
        errorRows.push({ row: r.rowNumber, nik: r.nik, message: 'Jenis grup daimi tidak diketahui (siswa belum ada grup daimi & kolom dikosongkan)' }); continue;
      }

      const data: Array<{ mataPelajaranId: string; nilaiAkhir: number | null }> = [];
      for (const { mapel, rawValue } of r.mapelValues) {
        const score = Number(rawValue);
        if (isNaN(score) || score < 0 || score > 100) { skippedMapelCount++; continue; }
        const isActive = keaktifanMap.get(`${mapel.id}||${grupDaimiId}`) === true;
        if (!isActive) { skippedMapelCount++; continue; }
        data.push({ mataPelajaranId: mapel.id, nilaiAkhir: score });
      }

      validRows.push({ rowNumber: r.rowNumber, studentId: student.id, kelasId: kelas.id, tahunAjaran: r.tahunAjaran, semester: r.semester, data });
    }

    let successRows = 0;
    if (validRows.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const vr of validRows) {
          let riwayat = await tx.riwayatKelasFormal.findUnique({
            where: { studentId_tahunAjaran_semester: { studentId: vr.studentId, tahunAjaran: vr.tahunAjaran, semester: vr.semester } }
          });
          if (!riwayat) {
            riwayat = await tx.riwayatKelasFormal.create({
              data: { studentId: vr.studentId, kelasId: vr.kelasId, tahunAjaran: vr.tahunAjaran, semester: vr.semester }
            });
          } else if (riwayat.kelasId !== vr.kelasId) {
            riwayat = await tx.riwayatKelasFormal.update({ where: { id: riwayat.id }, data: { kelasId: vr.kelasId } });
          }

          for (const item of vr.data) {
            const finalScore = item.nilaiAkhir;
            let predikatVal: string | null = null;
            if (finalScore !== null) {
              if (finalScore >= 90) predikatVal = 'A';
              else if (finalScore >= 81) predikatVal = 'B+';
              else if (finalScore >= 76) predikatVal = 'B';
              else predikatVal = 'C+';
            }

            await tx.nilaiFormal.upsert({
              where: {
                studentId_mataPelajaranId_tahunAjaran_semester: {
                  studentId: vr.studentId, mataPelajaranId: item.mataPelajaranId, tahunAjaran: vr.tahunAjaran, semester: vr.semester
                }
              },
              update: { kelasId: vr.kelasId, riwayatKelasId: riwayat.id, nilaiAkhir: finalScore, predikat: predikatVal },
              create: {
                studentId: vr.studentId, mataPelajaranId: item.mataPelajaranId, kelasId: vr.kelasId, riwayatKelasId: riwayat.id,
                tahunAjaran: vr.tahunAjaran, semester: vr.semester, nilaiAkhir: finalScore, predikat: predikatVal
              }
            });
          }
          successRows++;
        }
      }, { maxWait: 60000, timeout: 300000 });
    }

    if (user) {
      await this.auditLogService.log('CREATE', 'E_RAPOR_NILAI_RIWAYAT', 'bulk-import', 'Import Riwayat Nilai (Excel)', user, `Import ${rows.length} baris: ${successRows} berhasil, ${errorRows.length} error, ${skippedMapelCount} nilai mapel dilewati`);
    }

    return { totalRows: rows.length, successRows, errorRows, skippedMapelCount };
  }

  async getERaporPresensiCatatan(kelasId: string, tahunAjaran: string, semester: string) {
    const siswaList = await this.prisma.siswaFormal.findMany({
      where: { kelasId },
      include: {
        student: {
          include: { 
            biodata: true,
            dataDaimi: {
              include: { grup: true }
            }
          }
        }
      },
      orderBy: { student: { biodata: { fullName: 'asc' } } }
    });

    const riwayatList = await this.prisma.riwayatKelasFormal.findMany({
      where: {
        kelasId,
        tahunAjaran,
        semester
      }
    });

    const riwayatMap = new Map(riwayatList.map(r => [r.studentId, r]));

    return siswaList.map(s => {
      const r = riwayatMap.get(s.studentId);
      const jenisGrupDaimi = s.student.dataDaimi?.grup?.jenis || s.student.dataDaimi?.grup?.name || s.student.grupDaimi || '-';
      return {
        studentId: s.studentId,
        nisn: s.nisn || s.student.biodata?.nisn || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        jenisGrupDaimi,
        sakit: r?.sakit ?? 0,
        izin: r?.izin ?? 0,
        alpa: r?.alpa ?? 0,
        catatanWaliKelas: r?.catatanWaliKelas ?? r?.catatan ?? '',
        ketakwaan: r?.ketakwaan ?? 'A',
        ketaatan: r?.ketaatan ?? 'A',
        kemampuanRepresentasi: r?.kemampuanRepresentasi ?? 'A',
        kerapihan: r?.kerapihan ?? 'A',
        kepercayaanDiri: r?.kepercayaanDiri ?? 'A',
        hubunganSosial: r?.hubunganSosial ?? 'A',
        semangatBelajar: r?.semangatBelajar ?? 'A',
        disiplin: r?.disiplin ?? 'A',
        tanggungJawab: r?.tanggungJawab ?? 'A',
        statusAkhir: r?.statusAkhir ?? ''
      };
    });
  }

  async saveERaporPresensiCatatanBatch(payload: {
    kelasId: string;
    tahunAjaran: string;
    semester: string;
    data: Array<{
      studentId: string;
      sakit?: number;
      izin?: number;
      alpa?: number;
      catatanWaliKelas?: string;
      ketakwaan?: string;
      ketaatan?: string;
      kemampuanRepresentasi?: string;
      kerapihan?: string;
      kepercayaanDiri?: string;
      hubunganSosial?: string;
      semangatBelajar?: string;
      disiplin?: string;
      tanggungJawab?: string;
      statusAkhir?: string;
    }>;
  }, user?: any) {
    const { kelasId, tahunAjaran, semester, data } = payload;

    return this.prisma.$transaction(async (tx) => {
      let savedCount = 0;

      for (const item of data) {
        const sikapData = {
          kelasId,
          sakit: item.sakit ?? 0,
          izin: item.izin ?? 0,
          alpa: item.alpa ?? 0,
          catatanWaliKelas: item.catatanWaliKelas || null,
          ketakwaan: item.ketakwaan || null,
          ketaatan: item.ketaatan || null,
          kemampuanRepresentasi: item.kemampuanRepresentasi || null,
          kerapihan: item.kerapihan || null,
          kepercayaanDiri: item.kepercayaanDiri || null,
          hubunganSosial: item.hubunganSosial || null,
          semangatBelajar: item.semangatBelajar || null,
          disiplin: item.disiplin || null,
          tanggungJawab: item.tanggungJawab || null,
          statusAkhir: item.statusAkhir || null
        };

        await tx.riwayatKelasFormal.upsert({
          where: {
            studentId_tahunAjaran_semester: {
              studentId: item.studentId,
              tahunAjaran,
              semester
            }
          },
          update: sikapData,
          create: {
            studentId: item.studentId,
            tahunAjaran,
            semester,
            ...sikapData
          }
        });
        savedCount++;
      }

      if (user) {
        await this.auditLogService.log('UPDATE', 'E_RAPOR_PRESENSI', kelasId, `Presensi/Catatan e-Rapor ${tahunAjaran} ${semester}`, user, `Menyimpan presensi & catatan ${savedCount} siswa`);
      }

      return { success: true, count: savedCount };
    });
  }

  async getERaporLeger(kelasId: string, tahunAjaran: string, semester: string) {
    const kelas = await this.prisma.kelas.findUnique({
      where: { id: kelasId },
      include: {
        waliKelas: true,
        lembagaMuadalah: true,
        cabang: true
      }
    });
    if (!kelas) throw new BadRequestException('Kelas tidak ditemukan');

    const siswaList = await this.prisma.siswaFormal.findMany({
      where: { kelasId },
      include: {
        student: {
          include: { 
            biodata: true,
            dataDaimi: {
              include: { grup: true }
            }
          }
        }
      },
      orderBy: { student: { biodata: { fullName: 'asc' } } }
    });

    const allMapel = await this.prisma.mataPelajaran.findMany({
      where: { isActive: true },
      orderBy: { kodeMapel: 'asc' }
    });

    const allNilai = await this.prisma.nilaiFormal.findMany({
      where: {
        kelasId,
        tahunAjaran,
        semester
      }
    });

    const riwayatList = await this.prisma.riwayatKelasFormal.findMany({
      where: {
        kelasId,
        tahunAjaran,
        semester
      }
    });

    const keaktifanList = await this.prisma.keaktifanMapelGrup.findMany({
      where: { mataPelajaranId: { in: allMapel.map(m => m.id) } }
    });
    // key: `${mataPelajaranId}__${grupDaimiId}` -> isActive
    const keaktifanMap = new Map(keaktifanList.map(k => [`${k.mataPelajaranId}__${k.grupDaimiId}`, k.isActive]));

    const nilaiMap = new Map<string, Record<string, number | null>>();
    allNilai.forEach(n => {
      if (!nilaiMap.has(n.studentId)) nilaiMap.set(n.studentId, {});
      nilaiMap.get(n.studentId)![n.mataPelajaranId] = n.nilaiAkhir;
    });

    const riwayatMap = new Map(riwayatList.map(r => [r.studentId, r]));

    const legerRows = siswaList.map(s => {
      const studentNilaiMap = nilaiMap.get(s.studentId) || {};
      const r = riwayatMap.get(s.studentId);
      const jenisGrupDaimi = s.student.dataDaimi?.grup?.jenis || s.student.dataDaimi?.grup?.name || s.student.grupDaimi || '-';
      const grupDaimiId = s.student.dataDaimi?.grupId ?? null;

      let totalNilai = 0;
      let countMapel = 0;
      const aktifMapel: Record<string, boolean> = {};

      allMapel.forEach(m => {
        const val = studentNilaiMap[m.id];
        if (val !== undefined && val !== null) {
          totalNilai += val;
          countMapel++;
        }
        aktifMapel[m.id] = !!grupDaimiId && keaktifanMap.get(`${m.id}__${grupDaimiId}`) === true;
      });

      const rataRata = countMapel > 0 ? Math.round((totalNilai / countMapel) * 100) / 100 : 0;

      return {
        studentId: s.studentId,
        nisn: s.nisn || s.student.biodata?.nisn || '',
        nis: s.nis || s.student.biodata?.nisLokal || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        jenisGrupDaimi,
        scores: studentNilaiMap,
        aktifMapel,
        totalNilai,
        rataRata,
        sakit: r?.sakit ?? 0,
        izin: r?.izin ?? 0,
        alpa: r?.alpa ?? 0,
        catatan: r?.catatanWaliKelas ?? ''
      };
    });

    legerRows.sort((a, b) => b.rataRata - a.rataRata);
    const rankedRows = legerRows.map((row, idx) => ({ ...row, ranking: idx + 1 }));

    const totalRataRata = legerRows.length > 0
      ? Math.round((legerRows.reduce((acc, curr) => acc + curr.rataRata, 0) / legerRows.length) * 100) / 100
      : 0;

    return {
      kelas,
      mapelList: allMapel,
      siswa: rankedRows,
      rataRataKelas: totalRataRata
    };
  }

  // --- HAFALAN AL-QUR'AN (KHUSUS GRUP DAIMI JENIS HAFIZLIK) ---

  async getHafalanByStudent(studentId: string, tahunAjaran: string, semester: string) {
    return this.prisma.hafalanAlQuran.findUnique({
      where: {
        studentId_tahunAjaran_semester: {
          studentId,
          tahunAjaran,
          semester
        }
      }
    });
  }

  async saveHafalan(data: {
    studentId: string;
    kelasId: string;
    tahunAjaran: string;
    semester: string;
    awalPutaran?: number | null;
    awalJuz?: number | null;
    targetPutaran?: number | null;
    targetJuz?: number | null;
    akhirPutaran?: number | null;
    akhirJuz?: number | null;
  }, user?: any) {
    const { studentId, kelasId, tahunAjaran, semester, ...rest } = data;

    const result = await this.prisma.hafalanAlQuran.upsert({
      where: {
        studentId_tahunAjaran_semester: {
          studentId,
          tahunAjaran,
          semester
        }
      },
      update: { kelasId, ...rest },
      create: { studentId, kelasId, tahunAjaran, semester, ...rest }
    });

    if (user) {
      await this.auditLogService.log('UPDATE', 'HAFALAN_AL_QURAN', studentId, `Hafalan Al-Qur'an ${tahunAjaran} ${semester}`, user, `Menyimpan pencapaian hafalan Al-Qur'an siswa`);
    }

    return result;
  }

  // --- DAFTAR SISWA UNTUK CETAK RAPOR (list + status sudah cetak) ---

  async getERaporCetakList(params: {
    kelasId?: string;
    tahunAjaran: string;
    semester: string;
    search?: string;
    page: number;
    pageSize: number;
  }, user: any) {
    const { kelasId, tahunAjaran, semester, search, page, pageSize } = params;

    let kelasWhere: any = {};
    if (kelasId) {
      kelasWhere = { id: kelasId };
    } else if (user.scope === 'CABANG' && user.cabangId) {
      kelasWhere = { cabangId: user.cabangId };
    } else if (user.scope === 'WILAYAH' && user.wilayahId) {
      kelasWhere = { cabang: { wilayahId: user.wilayahId } };
    }

    const whereClause: any = {
      kelas: kelasWhere,
      ...(search?.trim() ? { student: { biodata: { fullName: { contains: search.trim(), mode: 'insensitive' } } } } : {})
    };

    // Ambil semua ID yang cocok filter (murah, hanya select id) untuk hitung total & status cetak
    const allMatching = await this.prisma.siswaFormal.findMany({
      where: whereClause,
      select: { studentId: true },
      orderBy: { student: { biodata: { fullName: 'asc' } } }
    });
    const total = allMatching.length;
    const pageIds = allMatching.slice((page - 1) * pageSize, page * pageSize).map(s => s.studentId);

    const [siswaList, riwayatList, allMapelActive, nilaiForPage] = await Promise.all([
      this.prisma.siswaFormal.findMany({
        where: { studentId: { in: pageIds } },
        include: {
          student: {
            include: { biodata: true, dataDaimi: { include: { grup: true } } }
          },
          kelas: { include: { cabang: true } }
        },
        orderBy: { student: { biodata: { fullName: 'asc' } } }
      }),
      this.prisma.riwayatKelasFormal.findMany({
        where: { studentId: { in: allMatching.map(s => s.studentId) }, tahunAjaran, semester },
        include: { grupDaimi: true }
      }),
      this.prisma.mataPelajaran.findMany({
        where: { isActive: true },
        include: { keaktifanGrup: true }
      }),
      this.prisma.nilaiFormal.findMany({
        where: { studentId: { in: pageIds }, tahunAjaran, semester }
      })
    ]);

    const riwayatMap = new Map(riwayatList.map(r => [r.studentId, r]));
    const sudahCetakCount = riwayatList.filter(r => r.sudahCetak).length;

    // studentId -> Set mataPelajaranId yang sudah ada nilaiAkhir-nya
    const filledMap = new Map<string, Set<string>>();
    nilaiForPage.forEach(n => {
      if (n.nilaiAkhir === null || n.nilaiAkhir === undefined) return;
      if (!filledMap.has(n.studentId)) filledMap.set(n.studentId, new Set());
      filledMap.get(n.studentId)!.add(n.mataPelajaranId);
    });

    const data = siswaList.map(s => {
      // Utamakan grup daimi yang TERSIMPAN untuk riwayat periode ini (bisa beda dari grup
      // siswa saat ini kalau dulu berbeda) - baru fallback ke grup daimi siswa sekarang untuk
      // riwayat lama yang dibuat sebelum grupDaimiId per-periode ada.
      const riwayatGrup = riwayatMap.get(s.studentId)?.grupDaimi;
      const grupRef = riwayatGrup || s.student.dataDaimi?.grup;
      const jenisGrupDaimi = grupRef?.jenis || grupRef?.name || s.student.grupDaimi || '-';
      const grupDaimiId = riwayatMap.get(s.studentId)?.grupDaimiId || s.student.dataDaimi?.grupId || null;

      const mapelAktifUntukSiswa = allMapelActive.filter(m => {
        if (!grupDaimiId) return false;
        const entry = m.keaktifanGrup.find(k => k.grupDaimiId === grupDaimiId);
        return entry?.isActive === true;
      });
      const filledSet = filledMap.get(s.studentId) || new Set<string>();
      const mapelBelumDiisi = mapelAktifUntukSiswa.filter(m => !filledSet.has(m.id)).map(m => m.name);

      return {
        studentId: s.studentId,
        kelasId: s.kelasId || '',
        nis: s.nis || s.student.biodata?.nisLokal || '',
        nisn: s.nisn || s.student.biodata?.nisn || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        kelasName: s.kelas?.name || '-',
        cabangName: s.kelas?.cabang?.name || '-',
        jenisGrupDaimi,
        sudahCetak: riwayatMap.get(s.studentId)?.sudahCetak ?? false,
        isLengkap: mapelBelumDiisi.length === 0,
        mapelBelumDiisi
      };
    });

    // Urutkan ulang sesuai urutan pageIds (findMany dengan `in` tidak menjamin urutan)
    const orderMap = new Map(pageIds.map((id, idx) => [id, idx]));
    data.sort((a, b) => (orderMap.get(a.studentId) ?? 0) - (orderMap.get(b.studentId) ?? 0));

    return {
      data,
      total,
      sudahCetakCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  // Laporan kelengkapan riwayat belajar & nilai per siswa: memindai semua siswa formal
  // (dalam scope cabang/wilayah/global) dan menandai tingkat+semester mana yang riwayat
  // kelasnya (RiwayatKelasFormal) dan/atau nilainya (NilaiFormal) masih kosong, dari tingkat
  // pertama yang tercatat sampai tingkat siswa saat ini.
  async getRiwayatContinuity(params: {
    kelasId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }, user: any) {
    const { kelasId, search, page, pageSize } = params;

    // Periode aktif sekarang (dan apa pun setelahnya) belum "seharusnya" ada isinya - itu
    // tanggung jawab tab Input Nilai Mapel, bukan laporan riwayat lampau ini. Jadi semester
    // aktif & yang akan datang pada tingkat siswa SAAT INI tidak boleh ikut ditandai sebagai gap.
    const pengaturan = await this.prisma.pengaturanAkademik.findFirst();
    const semesterOrder = (s?: string | null) => (s?.toUpperCase() === 'GENAP' ? 1 : 0);
    const activeSemesterOrder = semesterOrder(pengaturan?.semesterAktif);

    const studentWhere: any = {};
    if (user.scope === 'CABANG' && user.cabangId) {
      studentWhere.cabangId = user.cabangId;
    } else if (user.scope === 'WILAYAH' && user.wilayahId) {
      studentWhere.wilayahId = user.wilayahId;
    }
    if (search?.trim()) {
      studentWhere.biodata = { fullName: { contains: search.trim(), mode: 'insensitive' } };
    }

    const whereClause: any = {
      student: studentWhere,
      ...(kelasId ? { kelasId } : {})
    };

    const allMatching = await this.prisma.siswaFormal.findMany({
      where: whereClause,
      select: { studentId: true }
    });
    const totalSiswaFormal = allMatching.length;
    const allStudentIds = allMatching.map(s => s.studentId);

    // Ambil riwayat & nilai untuk SEMUA siswa yang cocok filter (bukan cuma satu halaman) -
    // status lengkap/bermasalah harus dihitung menyeluruh dulu, baru hasil siswa BERMASALAH
    // yang dipaginasi.
    const [siswaFormalList, riwayatList, nilaiList] = await Promise.all([
      this.prisma.siswaFormal.findMany({
        where: { studentId: { in: allStudentIds } },
        include: {
          student: { include: { biodata: true } },
          kelas: true
        }
      }),
      this.prisma.riwayatKelasFormal.findMany({
        where: { studentId: { in: allStudentIds } },
        include: { kelas: { select: { tingkat: true } } }
      }),
      this.prisma.nilaiFormal.findMany({
        where: { studentId: { in: allStudentIds } },
        select: { riwayatKelasId: true }
      })
    ]);

    const riwayatByStudent = new Map<string, typeof riwayatList>();
    riwayatList.forEach(r => {
      if (!riwayatByStudent.has(r.studentId)) riwayatByStudent.set(r.studentId, []);
      riwayatByStudent.get(r.studentId)!.push(r);
    });

    const riwayatIdsWithNilai = new Set(nilaiList.filter(n => n.riwayatKelasId).map(n => n.riwayatKelasId as string));
    const semesterList = ['Ganjil', 'Genap'];

    const results: Array<{
      studentId: string; fullName: string; nis: string; nisn: string;
      kelasName: string; tingkatSaatIni: string;
      gaps: Array<{ tingkat: number | null; semester: string | null; kind: string }>;
    }> = [];
    let siswaLengkap = 0;

    for (const sf of siswaFormalList) {
      const riwayatSiswa = riwayatByStudent.get(sf.studentId) || [];
      const baseInfo = {
        studentId: sf.studentId,
        fullName: sf.student.biodata?.fullName || 'Siswa',
        nis: sf.nis || sf.student.biodata?.nisLokal || '',
        nisn: sf.nisn || sf.student.biodata?.nisn || '',
        kelasName: sf.kelas?.name || '-',
        tingkatSaatIni: sf.tingkat || '-'
      };

      if (riwayatSiswa.length === 0) {
        results.push({ ...baseInfo, gaps: [{ tingkat: null, semester: null, kind: 'NO_RIWAYAT_SAMA_SEKALI' }] });
        continue;
      }

      const tingkatRecorded = riwayatSiswa
        .map(r => parseInt(r.kelas?.tingkat || '', 10))
        .filter(t => !isNaN(t));

      if (tingkatRecorded.length === 0) {
        // Semua riwayat kelasnya tidak punya tingkat tercatat - tidak bisa dianalisa
        siswaLengkap++;
        continue;
      }

      const isMasihAktif = !!sf.tingkat && sf.tingkat !== 'LULUS';
      const tingkatMin = Math.min(...tingkatRecorded);
      let tingkatMax: number;
      if (isMasihAktif) {
        const parsed = parseInt(sf.tingkat as string, 10);
        tingkatMax = !isNaN(parsed) ? parsed : Math.max(...tingkatRecorded);
      } else {
        tingkatMax = Math.max(12, ...tingkatRecorded);
      }

      const gaps: Array<{ tingkat: number | null; semester: string | null; kind: string }> = [];
      for (let t = tingkatMin; t <= tingkatMax; t++) {
        for (const sem of semesterList) {
          // Untuk tingkat siswa yang sedang berjalan (belum lulus/naik), semester aktif
          // sekarang dan yang akan datang belum waktunya diisi - jangan tandai sebagai gap.
          if (isMasihAktif && t === tingkatMax && semesterOrder(sem) >= activeSemesterOrder) continue;

          const match = riwayatSiswa.find(r => parseInt(r.kelas?.tingkat || '', 10) === t && r.semester?.toUpperCase() === sem.toUpperCase());
          if (!match) {
            gaps.push({ tingkat: t, semester: sem, kind: 'NO_RIWAYAT' });
          } else if (!riwayatIdsWithNilai.has(match.id)) {
            gaps.push({ tingkat: t, semester: sem, kind: 'NO_NILAI' });
          }
        }
      }

      if (gaps.length === 0) {
        siswaLengkap++;
      } else {
        results.push({ ...baseInfo, gaps });
      }
    }

    const total = results.length;
    const pageData = results.slice((page - 1) * pageSize, page * pageSize);

    return {
      data: pageData,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        totalSiswaFormal,
        siswaLengkap,
        siswaBermasalah: total
      }
    };
  }

  async toggleSudahCetak(data: { studentId: string; kelasId: string; tahunAjaran: string; semester: string; sudahCetak: boolean }, user?: any) {
    const { studentId, kelasId, tahunAjaran, semester, sudahCetak } = data;

    const result = await this.prisma.riwayatKelasFormal.upsert({
      where: {
        studentId_tahunAjaran_semester: { studentId, tahunAjaran, semester }
      },
      update: { sudahCetak },
      create: { studentId, kelasId, tahunAjaran, semester, sudahCetak }
    });

    if (user) {
      await this.auditLogService.log('UPDATE', 'E_RAPOR_CETAK', studentId, `Status Cetak Rapor ${tahunAjaran} ${semester}`, user, `Menandai rapor sebagai ${sudahCetak ? 'sudah dicetak' : 'belum dicetak'}`);
    }

    return result;
  }

  async getERaporCetak(studentId: string, tahunAjaran: string, semester: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        biodata: true,
        dataDaimi: {
          include: { grup: true }
        },
        cabang: {
          include: { wilayah: true }
        },
        siswaFormal: {
          include: {
            kelas: {
              include: {
                waliKelas: true,
                lembagaMuadalah: true
              }
            }
          }
        }
      }
    });

    if (!student) throw new BadRequestException('Siswa tidak ditemukan');

    const riwayat = await this.prisma.riwayatKelasFormal.findUnique({
      where: {
        studentId_tahunAjaran_semester: {
          studentId,
          tahunAjaran,
          semester
        }
      },
      include: {
        kelas: {
          include: {
            waliKelas: true,
            lembagaMuadalah: true
          }
        },
        waliKelas: true,
        grupDaimi: true
      }
    });

    const kelasRef = riwayat?.kelas || student.siswaFormal?.kelas;
    const waliKelasRef = riwayat?.waliKelas || kelasRef?.waliKelas;

    const allNilai = await this.prisma.nilaiFormal.findMany({
      where: {
        studentId,
        tahunAjaran,
        semester
      },
      include: {
        mataPelajaran: true
      },
      orderBy: { mataPelajaran: { kodeMapel: 'asc' } }
    });

    // Urutan cetak rapor: Umum -> Agama Islam -> Muatan Lokal
    const GRUP_MAPEL_ORDER: Record<string, number> = { 'Umum': 0, 'Agama Islam': 1, 'Muatan Lokal': 2 };
    allNilai.sort((a, b) => {
      const orderA = GRUP_MAPEL_ORDER[a.mataPelajaran.grupMapel] ?? 99;
      const orderB = GRUP_MAPEL_ORDER[b.mataPelajaran.grupMapel] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.mataPelajaran.kodeMapel.localeCompare(b.mataPelajaran.kodeMapel);
    });

    // Rata-rata kelas per mapel (semua siswa di kelas yang sama, periode yang sama)
    const rataRataKelasMap = new Map<string, number>();
    if (kelasRef?.id) {
      const allNilaiKelas = await this.prisma.nilaiFormal.findMany({
        where: { kelasId: kelasRef.id, tahunAjaran, semester },
        select: { mataPelajaranId: true, nilaiAkhir: true }
      });
      const sumCount = new Map<string, { sum: number; count: number }>();
      allNilaiKelas.forEach(n => {
        if (n.nilaiAkhir === null || n.nilaiAkhir === undefined) return;
        const entry = sumCount.get(n.mataPelajaranId) || { sum: 0, count: 0 };
        entry.sum += n.nilaiAkhir;
        entry.count += 1;
        sumCount.set(n.mataPelajaranId, entry);
      });
      sumCount.forEach((v, k) => rataRataKelasMap.set(k, Math.round((v.sum / v.count) * 100) / 100));
    }

    // Utamakan grup daimi yang TERSIMPAN untuk periode/riwayat ini (bisa beda dari grup
    // siswa saat ini kalau dulu berbeda) - baru fallback ke grup daimi siswa sekarang untuk
    // riwayat lama yang dibuat sebelum grupDaimiId per-periode ada.
    const grupRef = riwayat?.grupDaimi || student.dataDaimi?.grup;
    const jenisGrupDaimi = grupRef?.jenis || grupRef?.name || student.grupDaimi || '-';
    const isHafizlik = grupRef?.jenis === 'HAFIZLIK';

    let hafalan: {
      awalPutaran: number | null; awalJuz: number | null;
      targetPutaran: number | null; targetJuz: number | null;
      akhirPutaran: number | null; akhirJuz: number | null;
      jumlahJuz: number | null; jumlahHalaman: number | null;
    } | null = null;
    if (isHafizlik) {
      const hafalanData = await this.prisma.hafalanAlQuran.findUnique({
        where: {
          studentId_tahunAjaran_semester: { studentId, tahunAjaran, semester }
        }
      });
      let jumlahJuz: number | null = null;
      let jumlahHalaman: number | null = null;
      if (hafalanData && hafalanData.akhirPutaran !== null && hafalanData.akhirJuz !== null) {
        const total = (hafalanData.akhirPutaran * 30 + hafalanData.akhirJuz - 30) / 20;
        jumlahJuz = Math.floor(total);
        jumlahHalaman = Math.round((total - jumlahJuz) * 20);
      }
      hafalan = {
        awalPutaran: hafalanData?.awalPutaran ?? null,
        awalJuz: hafalanData?.awalJuz ?? null,
        targetPutaran: hafalanData?.targetPutaran ?? null,
        targetJuz: hafalanData?.targetJuz ?? null,
        akhirPutaran: hafalanData?.akhirPutaran ?? null,
        akhirJuz: hafalanData?.akhirJuz ?? null,
        jumlahJuz,
        jumlahHalaman
      };
    }

    return {
      siswa: {
        id: student.id,
        fullName: student.biodata?.fullName || '',
        nisn: student.siswaFormal?.nisn || student.biodata?.nisn || '',
        nis: student.siswaFormal?.nis || student.biodata?.nisLokal || '',
        jenisGrupDaimi,
        isHafizlik,
        hafalan,
        statusHafidz: isHafizlik ? null : student.statusHafidz,
        tempatLahir: student.biodata?.tempatLahir || '',
        tanggalLahir: student.biodata?.tanggalLahir || null,
        jenisKelamin: student.biodata?.jenisKelamin || '',
        namaAyah: student.biodata?.namaAyah || '',
        namaIbu: student.biodata?.namaIbu || '',
        pekerjaanAyah: student.biodata?.pekerjaanAyah || '',
        address: student.biodata?.address || ''
      },
      sekolah: {
        namaLembaga: kelasRef?.lembagaMuadalah?.name || student.cabang?.nameResmi || student.cabang?.name || 'Madrasah',
        npsn: kelasRef?.lembagaMuadalah?.npsn || 'N/A',
        nspp: kelasRef?.lembagaMuadalah?.nspp || 'N/A',
        namaKetua: kelasRef?.lembagaMuadalah?.namaKetua || 'Kepala Madrasah',
        cabangName: student.cabang?.name || ''
      },
      akademik: {
        kelasName: kelasRef?.name || 'Belum Ada Kelas',
        tingkat: kelasRef?.tingkat || student.siswaFormal?.tingkat || '-',
        tahunAjaran,
        semester,
        waliKelasName: waliKelasRef?.name || 'Wali Kelas'
      },
      nilai: allNilai.map(n => ({
        mataPelajaranId: n.mataPelajaranId,
        kodeMapel: n.mataPelajaran.kodeMapel,
        namaMapel: n.mataPelajaran.name,
        grupMapel: n.mataPelajaran.grupMapel,
        nilaiAkhir: n.nilaiAkhir,
        predikat: n.predikat,
        rataRataKelas: rataRataKelasMap.get(n.mataPelajaranId) ?? null
      })),
      presensi: {
        sakit: riwayat?.sakit ?? 0,
        izin: riwayat?.izin ?? 0,
        alpa: riwayat?.alpa ?? 0,
        catatanWaliKelas: riwayat?.catatanWaliKelas ?? riwayat?.catatan ?? 'Tingkatkan terus prestasi dan keaktifan belajar.',
        ketakwaan: riwayat?.ketakwaan ?? 'A',
        ketaatan: riwayat?.ketaatan ?? 'A',
        kemampuanRepresentasi: riwayat?.kemampuanRepresentasi ?? 'A',
        kerapihan: riwayat?.kerapihan ?? 'A',
        kepercayaanDiri: riwayat?.kepercayaanDiri ?? 'A',
        hubunganSosial: riwayat?.hubunganSosial ?? 'A',
        semangatBelajar: riwayat?.semangatBelajar ?? 'A',
        disiplin: riwayat?.disiplin ?? 'A',
        tanggungJawab: riwayat?.tanggungJawab ?? 'A',
        statusAkhir: riwayat?.statusAkhir ?? 'NAIK_KELAS'
      }
    };
  }
}

