import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { StatusPool } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

@Injectable()
export class StudentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createStudent(user: any, data: any) {
    const { 
      nisn, nik, nisLokal, noGlodemy, fullName, tempatLahir, tanggalLahir, jenisKelamin, kewarganegaraan,
      namaAyah, statusHidupAyah, pekerjaanAyah, pendidikanAyah,
      namaIbu, statusHidupIbu, pekerjaanIbu, pendidikanIbu,
      address, phone, 
      kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
      fotoBase64, ijazahBase64, kkBase64,
      wilayahId, cabangId, tanggalMasuk 
    } = data;
    
    // determine initial pool status
    const initialStatus = cabangId ? StatusPool.AKTIF_CABANG : StatusPool.TERSEDIA;
    
    return this.prisma.$transaction(async (tx) => {
      const biodata = await tx.biodata.create({
        data: {
          nik, nisLokal, noGlodemy, fullName, tempatLahir,
          tanggalLahir: tanggalLahir ? new Date(tanggalLahir) : null,
          jenisKelamin, kewarganegaraan,
          namaAyah, statusHidupAyah, pekerjaanAyah, pendidikanAyah,
          namaIbu, statusHidupIbu, pekerjaanIbu, pendidikanIbu,
          address, phone,
          kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
          fotoBase64, ijazahBase64, kkBase64
        }
      });

      const student = await tx.student.create({
        data: {
          biodataId: biodata.id,
          wilayahId,
          cabangId,
          statusPool: initialStatus,
        }
      });

      if (cabangId) {
        await tx.riwayatPendidikan.create({
          data: {
            studentId: student.id,
            cabangId,
            tanggalMasuk: tanggalMasuk ? new Date(tanggalMasuk) : new Date(),
          }
        });
      }

      return student;
    });
  }

  async importStudents(user: any, data: any[]) {
    try {
      const results = [];
      const BATCH_SIZE = 250;

      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const chunk = data.slice(i, i + BATCH_SIZE);
        
        const chunkResults = await this.prisma.$transaction(async (tx) => {
          const chunkRes = [];
          // Pre-fetch caches for this transaction
          const wilayahCache = new Map<string, string>();
          const cabangCache = new Map<string, string>();
          const biodataCache = new Map<string, any>();
          const studentCache = new Map<string, any>();
          
          const allWilayah = await tx.wilayah.findMany();
          for (const w of allWilayah) {
            wilayahCache.set(w.name.toLowerCase(), w.id);
          }
          
          const allCabang = await tx.cabang.findMany();
          for (const c of allCabang) {
            cabangCache.set(c.name.toLowerCase(), c.id);
          }
          
          const allNoGlodemy = [];
          const allNik = [];
          const allNisLokal = [];
          for (const rawRow of chunk) {
             let row: any = {};
             for (const [k, v] of Object.entries(rawRow)) {
                if (typeof k === 'string') {
                   row[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v;
                }
             }
             const getVal = (keys: string[], fallbackMatches?: string[]) => {
                for (const key of keys) {
                   const k2 = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                   if (row[k2] !== undefined && row[k2] !== null && row[k2] !== '') return row[k2];
                }
                if (fallbackMatches) {
                   for (const [k, v] of Object.entries(row)) {
                      for (const match of fallbackMatches) {
                         if (k.includes(match) && v !== undefined && v !== null && v !== '') return v;
                      }
                   }
                }
                return '';
             }
             const g = String(getVal(['no_glodemy', 'noGlodemy', 'No Glodemy'], ['noglodemy', 'glodemy'])).trim();
             const n = String(getVal(['nik', 'NIK'])).trim();
             const nl = String(getVal(['nis_lokal', 'nisLokal', 'NIS Lokal', 'NISLokal'], ['nislokal', 'nissiswa'])).trim();
             if (g) allNoGlodemy.push(g);
             if (n) allNik.push(n);
             if (nl) allNisLokal.push(nl);
          }
          
          if (allNoGlodemy.length > 0 || allNik.length > 0 || allNisLokal.length > 0) {
            const existingBiodatas = await tx.biodata.findMany({
               where: {
                  OR: [
                     { noGlodemy: { in: allNoGlodemy.length ? allNoGlodemy : ['__empty__'] } },
                     { nik: { in: allNik.length ? allNik : ['__empty__'] } },
                     { nisLokal: { in: allNisLokal.length ? allNisLokal : ['__empty__'] } }
                  ]
               },
               include: { student: true }
            });
            for (const b of existingBiodatas) {
               if (b.noGlodemy) biodataCache.set(`g:${b.noGlodemy}`, b);
               if (b.nik) biodataCache.set(`n:${b.nik}`, b);
               if (b.nisLokal) biodataCache.set(`nl:${b.nisLokal}`, b);
               if (b.student) studentCache.set(b.id, b.student);
            }
          }

          for (const rawRow of chunk) {
            // Normalize keys for easier matching
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

            const getValue = (keys: string[], fallbackMatches?: string[]) => {
              for (const key of keys) {
                const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (row[normalizedKey] !== undefined && row[normalizedKey] !== null && row[normalizedKey] !== '') {
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

            const noGlodemy = String(getValue(['no_glodemy', 'noGlodemy', 'No Glodemy'], ['noglodemy', 'glodemy'])).trim();
            const nik = String(getValue(['nik', 'NIK'])).trim() || null;
            const nisn = String(getValue(['nisn', 'NISN'])).trim() || null;
            const nisLokal = String(getValue(['nis_lokal', 'nisLokal', 'NIS Lokal', 'NISLokal'], ['nislokal'])).trim() || null;
            const tempatLahir = String(getValue(['tempat_lahir', 'tempatLahir', 'Tempat Lahir'], ['tempatlahir'])).trim() || null;
            const alamat = String(getValue(['alamat', 'address', 'Alamat', 'Address'])).trim() || null;
            const noHp = String(getValue(['no_hp', 'noHp', 'No HP', 'Phone', 'Telepon'], ['nohp', 'telepon', 'phone'])).trim() || null;
            const namaIbu = String(getValue(['nama_ibu', 'namaIbu', 'Nama Ibu'], ['namaibu'])).trim() || null;
            const asalSekolah = String(getValue(['asal_sekolah', 'asalSekolah', 'Asal Sekolah'], ['asalsekolah', 'sekolah'])).trim() || null;

            let fullNameRaw = getValue(
              ['nama_siswa', 'fullName', 'Nama Siswa', 'Nama Lengkap', 'Name', 'Nama', 'Nama Peserta Didik', 'Peserta Didik'],
              ['namasiswa', 'namalengkap', 'namapeserta', 'pesertadidik', 'nama', 'name', 'siswa']
            );
            const fullName = String(fullNameRaw || 'Unknown').trim();
            
            let tanggalLahir = null;
            const rawTanggalLahir = getValue(['tanggal_lahir', 'tanggalLahir', 'Tanggal Lahir']);
            if (rawTanggalLahir) {
              const d = new Date(rawTanggalLahir);
              if (!isNaN(d.getTime())) {
                tanggalLahir = d;
              }
            }
            
            const jenisKelamin = String(getValue(['jenis_kelamin', 'jenisKelamin', 'Jenis Kelamin'])).trim();
            
            let wilayahId = user.scope === 'WILAYAH' ? user.wilayahId : null;
            const rawWilayah = getValue(['wilayah', 'Wilayah']);
            if (rawWilayah && !wilayahId) {
              const wilayahName = String(rawWilayah).trim();
              const wilayahKey = wilayahName.toLowerCase();
              
              if (wilayahCache.has(wilayahKey)) {
                wilayahId = wilayahCache.get(wilayahKey);
              } else {
                const w = await tx.wilayah.create({ data: { name: wilayahName } });
                wilayahId = w.id;
                wilayahCache.set(wilayahKey, w.id);
              }
            }
            
            let cabangId = user.scope === 'CABANG' ? user.cabangId : null;
            const rawCabang = getValue(['cabang', 'Cabang']);
            if (rawCabang && !cabangId) {
              const cabangName = String(rawCabang).trim();
              const cabangKey = cabangName.toLowerCase();
              
              if (cabangCache.has(cabangKey)) {
                cabangId = cabangCache.get(cabangKey);
              } else {
                const c = await tx.cabang.create({ 
                  data: { 
                    name: cabangName,
                    wilayahId: wilayahId || null
                  } 
                });
                cabangId = c.id;
                cabangCache.set(cabangKey, c.id);
              }
            }

            let existingBiodata = null;
            if (noGlodemy && biodataCache.has(`g:${noGlodemy}`)) {
              existingBiodata = biodataCache.get(`g:${noGlodemy}`);
            }
            if (!existingBiodata && nik && biodataCache.has(`n:${nik}`)) {
              existingBiodata = biodataCache.get(`n:${nik}`);
            }
            if (!existingBiodata && nisLokal && biodataCache.has(`nl:${nisLokal}`)) {
              existingBiodata = biodataCache.get(`nl:${nisLokal}`);
            }

            if (existingBiodata) {
              // Update existing
              const biodata = await tx.biodata.update({
                where: { id: existingBiodata.id },
                data: {
                  fullName,
                  tanggalLahir: tanggalLahir || existingBiodata.tanggalLahir,
                  jenisKelamin: jenisKelamin || existingBiodata.jenisKelamin,
                  nik: nik || existingBiodata.nik,
                  nisLokal: nisLokal || existingBiodata.nisLokal,
                  tempatLahir: tempatLahir || existingBiodata.tempatLahir,
                  address: alamat || existingBiodata.address,
                  phone: noHp || existingBiodata.phone,
                  namaIbu: namaIbu || existingBiodata.namaIbu
                }
              });
              
              let student = studentCache.get(biodata.id) || null;

              if (student) {
                 student = await tx.student.update({
                   where: { id: student.id },
                   data: {
                     wilayahId: wilayahId || student.wilayahId,
                     cabangId: cabangId || student.cabangId,
                   }
                 });
                 chunkRes.push(student);
              } else {
                 student = await tx.student.create({
                   data: {
                     biodataId: biodata.id,
                     wilayahId,
                     cabangId,
                     statusPool: StatusPool.TERSEDIA,
                   }
                 });
                 chunkRes.push(student);
                 studentCache.set(biodata.id, student);
              }
            } else {
              // Create new
              const biodata = await tx.biodata.create({
                data: {
                  noGlodemy: noGlodemy || null,
                  fullName: fullName,
                  tanggalLahir: tanggalLahir,
                  jenisKelamin: jenisKelamin,
                  kewarganegaraan: 'WNI',
                  nik,
                  nisLokal,
                  tempatLahir,
                  address: alamat,
                  phone: noHp,
                  namaIbu
                }
              });
              
              if (noGlodemy) biodataCache.set(`g:${noGlodemy}`, biodata);
              if (nik) biodataCache.set(`n:${nik}`, biodata);
              if (nisLokal) biodataCache.set(`nl:${nisLokal}`, biodata);

              const student = await tx.student.create({
                data: {
                  biodataId: biodata.id,
                  wilayahId,
                  cabangId,
                  statusPool: StatusPool.TERSEDIA,
                }
              });
              chunkRes.push(student);
              studentCache.set(biodata.id, student);
            }
          }
          return chunkRes;
        }, {
          maxWait: 120000,
          timeout: 300000
        });
        
        results.push(...chunkResults);
      }
      return results;
    } catch (e: any) {
      console.error("IMPORT ERROR:", e.message);
      throw e;
    }
  }

  async updateStudent(id: string, data: any) {
    const { 
      nisn, nik, nisLokal, noGlodemy, fullName, tempatLahir, tanggalLahir, jenisKelamin, kewarganegaraan,
      namaAyah, statusHidupAyah, pekerjaanAyah, pendidikanAyah,
      namaIbu, statusHidupIbu, pekerjaanIbu, pendidikanIbu,
      address, phone,
      kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
      fotoBase64, ijazahBase64, kkBase64
    } = data;
    
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { biodata: true }
    });

    if (!student) throw new BadRequestException('Student not found');

    return this.prisma.biodata.update({
      where: { id: student.biodataId },
      data: {
        nik, nisLokal, noGlodemy, fullName, tempatLahir,
        tanggalLahir: tanggalLahir ? new Date(tanggalLahir) : null,
        jenisKelamin, kewarganegaraan,
        namaAyah, statusHidupAyah, pekerjaanAyah, pendidikanAyah,
        namaIbu, statusHidupIbu, pekerjaanIbu, pendidikanIbu,
        address, phone,
        kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
        fotoBase64, ijazahBase64, kkBase64
      }
    });
  }

  async deleteAllStudents(user: any) {
    const { scope } = user;
    if (scope !== 'GLOBAL') {
      throw new BadRequestException('Hanya admin global yang dapat menghapus semua data siswa');
    }

    return this.prisma.$transaction(async (tx) => {
      const students = await tx.student.findMany();
      const studentIds = students.map(s => s.id);
      const biodataIds = students.map(s => s.biodataId);

      if (studentIds.length > 0) {
        await tx.riwayatPendidikan.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.logKehadiran.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.siswaFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.dataDaimi.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: studentIds } } });
        await tx.biodata.deleteMany({ where: { id: { in: biodataIds } } });
      }
      
      return { success: true, count: studentIds.length };
    });
  }

  async deleteStudent(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id } });
      if (!student) throw new BadRequestException('Student not found');

      // Due to constraints, we might need to delete related data or rely on cascade
      // But typically we should just delete riwayat, log, etc if needed.
      // Assuming cascade is not on, let's delete riwayat first
      await tx.riwayatPendidikan.deleteMany({ where: { studentId: id } });
      await tx.logKehadiran.deleteMany({ where: { studentId: id } });
      await tx.siswaFormal.deleteMany({ where: { studentId: id } });
      await tx.dataDaimi.deleteMany({ where: { studentId: id } });

      await tx.student.delete({ where: { id } });
      await tx.biodata.delete({ where: { id: student.biodataId } });
      
      return { success: true };
    });
  }

  async getStudents(user: any) {
    const { scope, wilayahId, cabangId } = user;
    
    let whereClause = {};

    if (scope === 'WILAYAH' && wilayahId) {
      whereClause = { wilayahId };
    } else if (scope === 'CABANG' && cabangId) {
      whereClause = { cabangId };
    }

    return this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      },
    });
  }

  async getPoolStudents(user: any) {
    const { scope, wilayahId } = user;
    
    let whereClause: any = { statusPool: StatusPool.TERSEDIA };

    // Limit pool students to their wilayah if applicable
    if (wilayahId) {
      whereClause.wilayahId = wilayahId;
    }

    return this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      },
    });
  }

  async deletePoolStudents(user: any) {
    const { scope, wilayahId } = user;
    
    if (scope !== 'GLOBAL') {
      throw new BadRequestException('Hanya admin global yang dapat menghapus semua data pool');
    }

    let whereClause: any = { statusPool: StatusPool.TERSEDIA };

    return this.prisma.$transaction(async (tx) => {
      const students = await tx.student.findMany({ where: whereClause });
      
      const studentIds = students.map(s => s.id);
      const biodataIds = students.map(s => s.biodataId);

      if (studentIds.length > 0) {
        await tx.riwayatPendidikan.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.logKehadiran.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.siswaFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.dataDaimi.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: studentIds } } });
        await tx.biodata.deleteMany({ where: { id: { in: biodataIds } } });
      }
      
      return { success: true, count: studentIds.length };
    });
  }

  async tarikSiswa(studentId: string, cabangId: string) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) {
        throw new BadRequestException('Siswa tidak ditemukan');
      }
      if (student.statusPool !== StatusPool.TERSEDIA) {
        throw new BadRequestException('Siswa tidak tersedia di pool');
      }
      
      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          statusPool: StatusPool.AKTIF_CABANG,
          cabangId: cabangId,
        },
      });

      await tx.riwayatPendidikan.create({
        data: {
          studentId: studentId,
          cabangId: cabangId,
          tanggalMasuk: new Date(),
        },
      });

      return updatedStudent;
    });
  }

  async tarikMassalSiswa(studentIds: string[], cabangId: string) {
    return this.prisma.$transaction(async (tx) => {
      const students = await tx.student.findMany({
        where: { id: { in: studentIds } }
      });

      if (students.length !== studentIds.length) {
        throw new BadRequestException('Beberapa siswa tidak ditemukan');
      }

      for (const student of students) {
        if (student.statusPool !== StatusPool.TERSEDIA) {
          throw new BadRequestException(`Siswa dengan ID ${student.id} tidak tersedia di pool`);
        }
      }
      
      const updatedStudents = await tx.student.updateMany({
        where: { id: { in: studentIds } },
        data: {
          statusPool: StatusPool.AKTIF_CABANG,
          cabangId: cabangId,
        },
      });

      const riwayatData = studentIds.map(id => ({
        studentId: id,
        cabangId: cabangId,
        tanggalMasuk: new Date(),
      }));

      await tx.riwayatPendidikan.createMany({
        data: riwayatData,
      });

      return updatedStudents;
    });
  }

  async lepasSiswa(studentId: string, dto: { statusAkhir: StatusPool, catatan?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) {
        throw new BadRequestException('Siswa tidak ditemukan');
      }
      if (student.statusPool !== StatusPool.AKTIF_CABANG) {
        throw new BadRequestException('Siswa tidak sedang aktif di cabang');
      }

      // Update current riwayat
      const activeRiwayat = await tx.riwayatPendidikan.findFirst({
        where: {
          studentId: studentId,
          tanggalKeluar: null,
        },
        orderBy: {
          tanggalMasuk: 'desc',
        },
      });

      if (activeRiwayat) {
        await tx.riwayatPendidikan.update({
          where: { id: activeRiwayat.id },
          data: {
            tanggalKeluar: new Date(),
            statusAkhir: dto.statusAkhir,
            catatan: dto.catatan,
          },
        });
      }

      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          statusPool: dto.statusAkhir,
          cabangId: null,
        },
      });

      return updatedStudent;
    });
  }
}
