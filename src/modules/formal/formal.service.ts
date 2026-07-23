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

  async getRapor() {
    return this.prisma.nilaiFormal.findMany({
      include: {
        student: { include: { biodata: true } },
        mataPelajaran: true,
        kelas: true
      }
    });
  }

  async createRapor(data: any) {
    return this.prisma.nilaiFormal.create({ data: data as any });
  }

  async updateRapor(id: string, data: any) {
    return this.prisma.nilaiFormal.update({ where: { id }, data: data as any });
  }

  async deleteRapor(id: string) {
    return this.prisma.nilaiFormal.delete({ where: { id } });
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

  // --- RIWAYAT KELAS FORMAL ---

  async getRiwayatKelasByStudent(studentId: string) {
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
      await this.auditLogService.log('CREATE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${data.tahunAjaran}`, user, `Menambahkan riwayat kelas manual untuk siswa ID ${data.studentId}`);
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
      await this.auditLogService.log('UPDATE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${result.tahunAjaran}`, user, `Memperbarui riwayat kelas siswa ID ${result.studentId}`);
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
      await this.auditLogService.log('DELETE', 'RIWAYAT_KELAS', result.id, `Riwayat Kelas ${result.tahunAjaran}`, user, `Menghapus riwayat kelas siswa ID ${result.studentId}`);
    }
    return result;
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
        const currentTingkatNum = parseInt(currentTingkat, 10);
        let nextTingkat = currentTingkat;
        let isLulus = st.statusAkhir === 'LULUS';

        if (st.statusAkhir === 'NAIK_KELAS' || st.statusAkhir === 'NAIK_TINGKAT') {
          if (!isNaN(currentTingkatNum)) {
             if (currentTingkatNum >= 12) {
                isLulus = true;
             } else {
                nextTingkat = (currentTingkatNum + 1).toString();
             }
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

      await this.auditLogService.log(
        'UPDATE', 
        'KENAIKAN_KELAS', 
        payload.kelasAsalId, 
        `Kenaikan Massal ${payload.tahunAjaranLama} -> ${payload.tahunAjaranBaru}`, 
        user, 
        `Memproses ${successCount} siswa dari kelas asal ID ${payload.kelasAsalId}`
      );

      return { success: true, processed: successCount };
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
      }
    }
    return { success: true, processed: totalProcessed };
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

  async getKelasById(id: string) {
    return this.prisma.kelas.findUnique({
      where: { id },
      include: {
        cabang: { include: { wilayah: true } },
        lembagaMuadalah: true,
        waliKelas: true,
        ruang: true
      }
    });
  }

  async addStudentToKelas(kelasId: string, studentId: string) {
    const kelas = await this.prisma.kelas.findUnique({ where: { id: kelasId } });
    if (!kelas) throw new NotFoundException('Kelas tidak ditemukan');

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

  async removeStudentFromKelas(kelasId: string, studentId: string) {
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

    return siswaList.map(s => {
      const saved = nilaiMap.get(s.studentId);
      const jenisGrupDaimi = s.student.dataDaimi?.grup?.jenis || s.student.dataDaimi?.grup?.name || s.student.grupDaimi || '-';
      return {
        studentId: s.studentId,
        nisn: s.nisn || s.student.biodata?.nisn || '',
        nis: s.nis || s.student.biodata?.nisLokal || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        jenisGrupDaimi,
        nilaiAkhir: saved?.nilaiAkhir ?? null,
        predikat: saved?.predikat ?? '',
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

    return this.prisma.$transaction(async (tx) => {
      let savedCount = 0;

      for (const item of data) {
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
              semester
            }
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
        await this.auditLogService.log('UPDATE', 'E_RAPOR_NILAI', kelasId, `Entry Nilai e-Rapor ${tahunAjaran} ${semester}`, user, `Menyimpan ${savedCount} nilai mapel ID ${mataPelajaranId}`);
      }

      return { success: true, count: savedCount };
    });
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
        sikapSpiritual: r?.sikapSpiritual ?? 'Sangat Baik',
        sikapSosial: r?.sikapSosial ?? 'Baik',
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
      sikapSpiritual?: string;
      sikapSosial?: string;
      statusAkhir?: string;
    }>;
  }, user?: any) {
    const { kelasId, tahunAjaran, semester, data } = payload;

    return this.prisma.$transaction(async (tx) => {
      let savedCount = 0;

      for (const item of data) {
        await tx.riwayatKelasFormal.upsert({
          where: {
            studentId_tahunAjaran_semester: {
              studentId: item.studentId,
              tahunAjaran,
              semester
            }
          },
          update: {
            kelasId,
            sakit: item.sakit ?? 0,
            izin: item.izin ?? 0,
            alpa: item.alpa ?? 0,
            catatanWaliKelas: item.catatanWaliKelas || null,
            sikapSpiritual: item.sikapSpiritual || null,
            sikapSosial: item.sikapSosial || null,
            statusAkhir: item.statusAkhir || null
          },
          create: {
            studentId: item.studentId,
            kelasId,
            tahunAjaran,
            semester,
            sakit: item.sakit ?? 0,
            izin: item.izin ?? 0,
            alpa: item.alpa ?? 0,
            catatanWaliKelas: item.catatanWaliKelas || null,
            sikapSpiritual: item.sikapSpiritual || null,
            sikapSosial: item.sikapSosial || null,
            statusAkhir: item.statusAkhir || null
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

      let totalNilai = 0;
      let countMapel = 0;

      allMapel.forEach(m => {
        const val = studentNilaiMap[m.id];
        if (val !== undefined && val !== null) {
          totalNilai += val;
          countMapel++;
        }
      });

      const rataRata = countMapel > 0 ? Math.round((totalNilai / countMapel) * 100) / 100 : 0;

      return {
        studentId: s.studentId,
        nisn: s.nisn || s.student.biodata?.nisn || '',
        nis: s.nis || s.student.biodata?.nisLokal || '',
        fullName: s.student.biodata?.fullName || 'Siswa',
        jenisGrupDaimi,
        scores: studentNilaiMap,
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
        waliKelas: true
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

    const jenisGrupDaimi = student.dataDaimi?.grup?.jenis || student.dataDaimi?.grup?.name || student.grupDaimi || '-';

    return {
      siswa: {
        id: student.id,
        fullName: student.biodata?.fullName || '',
        nisn: student.siswaFormal?.nisn || student.biodata?.nisn || '',
        nis: student.siswaFormal?.nis || student.biodata?.nisLokal || '',
        jenisGrupDaimi,
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
        predikat: n.predikat
      })),
      presensi: {
        sakit: riwayat?.sakit ?? 0,
        izin: riwayat?.izin ?? 0,
        alpa: riwayat?.alpa ?? 0,
        catatanWaliKelas: riwayat?.catatanWaliKelas ?? riwayat?.catatan ?? 'Tingkatkan terus prestasi dan keaktifan belajar.',
        sikapSpiritual: riwayat?.sikapSpiritual ?? 'Sangat Baik',
        sikapSosial: riwayat?.sikapSosial ?? 'Baik',
        statusAkhir: riwayat?.statusAkhir ?? 'NAIK_KELAS'
      }
    };
  }
}

