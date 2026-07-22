import { Injectable, BadRequestException, Inject, ForbiddenException } from '@nestjs/common';
import { StatusPool } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AuditLogService } from '../../audit-log/audit-log.service.js';
import * as fs from 'fs';
import * as path from 'path';

// Jenis dokumen yang didukung
export const DOKUMEN_JENIS = [
  'passfoto', 'kk', 'ijazah', 'akte', 'surat_mutasi',
  'rapor', 'skhun', 'surat_kesehatan', 'surat_domisili', 'lainnya'
] as const;
export type DokumenJenis = typeof DOKUMEN_JENIS[number];

// Pemetaan jenis dokumen → field biodata
const JENIS_TO_FIELD: Record<DokumenJenis, string> = {
  passfoto:         'fotoUrl',
  kk:               'kkUrl',
  ijazah:           'ijazahUrl',
  akte:             'akteUrl',
  surat_mutasi:     'suratMutasiUrl',
  rapor:            'raporUrl',
  skhun:            'skhunUrl',
  surat_kesehatan:  'suratKesehatanUrl',
  surat_domisili:   'suratDomisiliUrl',
  lainnya:          'dokumenLainUrl',
};

@Injectable()
export class StudentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService
  ) {}

  async createStudent(user: any, data: any) {
    const { 
      nisn, nik, noKk, nisLokal, noGlodemy, fullName, tempatLahir, tanggalLahir, jenisKelamin, kewarganegaraan,
      jumlahSaudara, anakKe,
      namaAyah, statusHidupAyah, nikAyah, tempatLahirAyah, tanggalLahirAyah, pekerjaanAyah, pendidikanAyah, penghasilanAyah,
      namaIbu, statusHidupIbu, nikIbu, tempatLahirIbu, tanggalLahirIbu, pekerjaanIbu, pendidikanIbu, penghasilanIbu,
      address, phone, 
      kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
      wilayahId, cabangId, tanggalMasuk,
      jenisSiswa, grupDaimi,
      alamatProvId, alamatProvName, alamatKabId, alamatKabName, alamatKecId, alamatKecName, alamatKelId, alamatKelName, alamatJalan
    } = data;
    
    // determine initial pool status
    const initialStatus = cabangId ? StatusPool.AKTIF_CABANG : StatusPool.TERSEDIA;
    
    return this.prisma.$transaction(async (tx) => {
      const biodata = await tx.biodata.create({
        data: {
          nik: nik?.trim() ? nik.trim() : null,
          noKk: noKk?.trim() ? noKk.trim() : null,
          nisn: nisn?.trim() ? nisn.trim() : null,
          nisLokal: nisLokal?.trim() ? nisLokal.trim() : null,
          noGlodemy: noGlodemy?.trim() ? noGlodemy.trim() : null,
          fullName, tempatLahir,
          tanggalLahir: tanggalLahir ? new Date(tanggalLahir) : null,
          jenisKelamin, kewarganegaraan,
          jumlahSaudara: jumlahSaudara !== undefined && jumlahSaudara !== '' ? Number(jumlahSaudara) : null,
          anakKe: anakKe !== undefined && anakKe !== '' ? Number(anakKe) : null,
          namaAyah, statusHidupAyah, nikAyah, tempatLahirAyah,
          tanggalLahirAyah: tanggalLahirAyah ? new Date(tanggalLahirAyah) : null,
          pekerjaanAyah, pendidikanAyah, penghasilanAyah,
          namaIbu, statusHidupIbu, nikIbu, tempatLahirIbu,
          tanggalLahirIbu: tanggalLahirIbu ? new Date(tanggalLahirIbu) : null,
          pekerjaanIbu, pendidikanIbu, penghasilanIbu,
          address, phone,
          kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
          alamatProvId, alamatProvName, alamatKabId, alamatKabName, alamatKecId, alamatKecName, alamatKelId, alamatKelName, alamatJalan
        }
      });

      const student = await tx.student.create({
        data: {
          biodataId: biodata.id,
          wilayahId,
          cabangId,
          statusPool: initialStatus,
          jenisSiswa: jenisSiswa || null,
          grupDaimi: grupDaimi || null,
        }
      });

      await this._processTempAndDocUrls(tx, biodata.id, data);

      if (cabangId) {
        await tx.riwayatPendidikan.create({
          data: {
            studentId: student.id,
            cabangId,
            tanggalMasuk: tanggalMasuk ? new Date(tanggalMasuk) : new Date(),
          }
        });
      }

      if (data.isVerval !== undefined) {
        await tx.siswaFormal.create({
          data: {
            studentId: student.id,
            isVerval: data.isVerval
          }
        });
      }

      if (user) {
        await this.auditLogService.log('CREATE', 'STUDENT', student.id, fullName || 'Siswa Baru', user, `Menambahkan siswa baru "${fullName}"`);
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
            const noHp = String(getValue(['no_hp', 'noHp', 'No HP', 'Phone', 'Telepon', 'no_telp', 'noTelp', 'No Telp'], ['nohp', 'telepon', 'phone', 'notelp', 'telp', 'hp'])).trim() || null;
            const namaIbu = String(getValue(['nama_ibu', 'namaIbu', 'Nama Ibu'], ['namaibu'])).trim() || null;
            const namaAyah = String(getValue(['nama_ayah', 'namaAyah', 'Nama Ayah'], ['namaayah'])).trim() || null;
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
            
            const jenisKelaminRaw = String(getValue(['jenis_kelamin', 'jenisKelamin', 'Jenis Kelamin'], ['jeniskelamin', 'jk', 'gender', 'sex'])).trim();
            let jenisKelamin = null;
            if (jenisKelaminRaw) {
              const jkLower = jenisKelaminRaw.toLowerCase();
              if (jkLower.startsWith('l') || jkLower.includes('laki') || jkLower === 'male' || jkLower === 'm') {
                jenisKelamin = 'L';
              } else if (jkLower.startsWith('p') || jkLower.includes('perempuan') || jkLower === 'female' || jkLower === 'f') {
                jenisKelamin = 'P';
              } else {
                jenisKelamin = jenisKelaminRaw;
              }
            }
            
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
                  tempatLahir: tempatLahir || existingBiodata.tempatLahir,
                  address: alamat || existingBiodata.address,
                  phone: noHp || existingBiodata.phone,
                  namaIbu: namaIbu || existingBiodata.namaIbu,
                  namaAyah: namaAyah || existingBiodata.namaAyah,
                  nisn: nisn || existingBiodata.nisn,
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
                     statusPool: cabangId ? StatusPool.AKTIF_CABANG : StatusPool.TERSEDIA,
                   }
                 });
                 chunkRes.push(student);
                 studentCache.set(biodata.id, student);
              }
            } else {
              // Create new
              const biodata = await tx.biodata.create({
                data: {
                  noGlodemy,
                  nik,
                  nisn,
                  nisLokal,
                  fullName,
                  tanggalLahir,
                  jenisKelamin,
                  tempatLahir,
                  address: alamat,
                  phone: noHp,
                  namaIbu,
                  namaAyah,
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
                  statusPool: cabangId ? StatusPool.AKTIF_CABANG : StatusPool.TERSEDIA,
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

  async updateStudent(id: string, data: any, user?: any) {
    const { 
      nisn, nik, noKk, nisLokal, noGlodemy, fullName, tempatLahir, tanggalLahir, jenisKelamin, kewarganegaraan,
      jumlahSaudara, anakKe,
      namaAyah, statusHidupAyah, nikAyah, tempatLahirAyah, tanggalLahirAyah, pekerjaanAyah, pendidikanAyah, penghasilanAyah,
      namaIbu, statusHidupIbu, nikIbu, tempatLahirIbu, tanggalLahirIbu, pekerjaanIbu, pendidikanIbu, penghasilanIbu,
      address, phone, 
      kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
      wilayahId, cabangId, isActive,
      alamatProvId, alamatProvName, alamatKabId, alamatKabName, alamatKecId, alamatKecName, alamatKelId, alamatKelName, alamatJalan
    } = data;

    const student = await this.prisma.student.findUnique({ where: { id }, include: { biodata: true } });
    if (!student) throw new BadRequestException('Student not found');

    if (user && user.scope !== 'GLOBAL') {
      if (user.scope === 'WILAYAH' && student.wilayahId !== user.wilayahId) {
        throw new ForbiddenException('Akses ditolak: Siswa berada di luar wilayah Anda.');
      }
      if (user.scope === 'CABANG' && student.cabangId !== user.cabangId) {
        throw new ForbiddenException('Akses ditolak: Siswa berada di luar cabang Anda.');
      }
    }

    let targetCabangId = cabangId;
    let targetWilayahId = wilayahId;

    if (user && user.scope === 'CABANG') {
      targetCabangId = user.cabangId;
      targetWilayahId = user.wilayahId;
    } else if (user && user.scope === 'WILAYAH') {
      targetWilayahId = user.wilayahId;
      if (targetCabangId && targetCabangId !== student.cabangId) {
        const targetCabang = await this.prisma.cabang.findUnique({ where: { id: targetCabangId } });
        if (!targetCabang || targetCabang.wilayahId !== user.wilayahId) {
          throw new ForbiddenException('Akses ditolak: Cabang tujuan berada di luar wilayah Anda.');
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const biodata = await tx.biodata.update({
        where: { id: student.biodataId },
        data: {
          nik: nik?.trim() ? nik.trim() : null,
          noKk: noKk?.trim() ? noKk.trim() : null,
          nisn: nisn?.trim() ? nisn.trim() : null,
          nisLokal: nisLokal?.trim() ? nisLokal.trim() : null,
          noGlodemy: noGlodemy?.trim() ? noGlodemy.trim() : null,
          fullName, tempatLahir,
          tanggalLahir: tanggalLahir ? new Date(tanggalLahir) : null,
          jenisKelamin, kewarganegaraan,
          jumlahSaudara: jumlahSaudara !== undefined && jumlahSaudara !== '' ? Number(jumlahSaudara) : null,
          anakKe: anakKe !== undefined && anakKe !== '' ? Number(anakKe) : null,
          namaAyah, statusHidupAyah, nikAyah, tempatLahirAyah,
          tanggalLahirAyah: tanggalLahirAyah ? new Date(tanggalLahirAyah) : null,
          pekerjaanAyah, pendidikanAyah, penghasilanAyah,
          namaIbu, statusHidupIbu, nikIbu, tempatLahirIbu,
          tanggalLahirIbu: tanggalLahirIbu ? new Date(tanggalLahirIbu) : null,
          pekerjaanIbu, pendidikanIbu, penghasilanIbu,
          address, phone,
          kontakDaruratNama, kontakDaruratTelp, kontakDaruratHubungan,
          alamatProvId, alamatProvName, alamatKabId, alamatKabName, alamatKecId, alamatKecName, alamatKelId, alamatKelName, alamatJalan
        }
      });

      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
          wilayahId: targetWilayahId,
          cabangId: targetCabangId,
          jenisSiswa: data.jenisSiswa || null,
          grupDaimi: data.grupDaimi || null,
          isActive: data.isActive !== undefined ? data.isActive : student.isActive
        }
      });

      await this._processTempAndDocUrls(tx, student.biodataId, data);

      if (data.isVerval !== undefined) {
        const existingFormal = await tx.siswaFormal.findUnique({ where: { studentId: id } });
        if (existingFormal) {
          await tx.siswaFormal.update({
            where: { studentId: id },
            data: { isVerval: data.isVerval }
          });
        } else {
          await tx.siswaFormal.create({
            data: {
              studentId: id,
              isVerval: data.isVerval
            }
          });
        }
      }
      if (user) {
        const fieldLabels: Record<string, string> = {
          fullName: 'Nama Lengkap',
          nik: 'NIK',
          nisn: 'NISN',
          nisLokal: 'NIS Lokal',
          noGlodemy: 'No Glodemy',
          tempatLahir: 'Tempat Lahir',
          tanggalLahir: 'Tanggal Lahir',
          jenisKelamin: 'Jenis Kelamin',
          kewarganegaraan: 'Kewarganegaraan',
          namaAyah: 'Nama Ayah',
          namaIbu: 'Nama Ibu',
          alamatJalan: 'Alamat Jalan',
          jenisSiswa: 'Jenis Siswa',
          grupDaimi: 'Grup Daimi',
          isActive: 'Status Aktif'
        };

        const changes: string[] = [];
        for (const key of Object.keys(fieldLabels)) {
          let oldVal = (student.biodata as any)[key] !== undefined ? (student.biodata as any)[key] : (student as any)[key];
          let newVal = (data as any)[key];

          if (key === 'tanggalLahir') {
            if (oldVal instanceof Date) oldVal = oldVal.toISOString().split('T')[0];
            if (newVal) newVal = new Date(newVal).toISOString().split('T')[0];
          }

          const normalizedOld = oldVal === null || oldVal === undefined ? '' : String(oldVal).trim();
          const normalizedNew = newVal === null || newVal === undefined ? '' : String(newVal).trim();

          if (normalizedOld !== normalizedNew) {
            changes.push(`${fieldLabels[key]}: "${normalizedOld || '-'}" ➔ "${normalizedNew || '-'}"`);
          }
        }

        const changesStr = changes.length > 0 ? ` (${changes.join(', ')})` : '';
        await this.auditLogService.log('UPDATE', 'STUDENT', id, fullName || 'Siswa', user, `Memperbarui biodata siswa "${fullName}"${changesStr}`);
      }
      return updatedStudent;
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
        await tx.kehadiran.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.siswaFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.dataDaimi.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.riwayatKelasFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.permintaanTarikData.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: studentIds } } });
        await tx.biodata.deleteMany({ where: { id: { in: biodataIds } } });
      }
      
      return { success: true, count: studentIds.length };
    });
  }

  async deleteStudent(id: string, user?: any) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id } });
      if (!student) throw new BadRequestException('Student not found');

      // Due to constraints, we might need to delete related data or rely on cascade
      // But typically we should just delete riwayat, log, etc if needed.
      // Assuming cascade is not on, let's delete riwayat first
      await tx.riwayatPendidikan.deleteMany({ where: { studentId: id } });
      await tx.kehadiran.deleteMany({ where: { studentId: id } });
      await tx.siswaFormal.deleteMany({ where: { studentId: id } });
      await tx.dataDaimi.deleteMany({ where: { studentId: id } });
      await tx.riwayatKelasFormal.deleteMany({ where: { studentId: id } });
      await tx.permintaanTarikData.deleteMany({ where: { studentId: id } });

      await tx.student.delete({ where: { id } });
      await tx.biodata.delete({ where: { id: student.biodataId } });
      
      if (user) {
        await this.auditLogService.log('DELETE', 'STUDENT', id, 'Siswa', user, `Menghapus siswa permanen`);
      }
      return { success: true };
    });
  }

  async getStudents(user: any) {
    const { scope, wilayahId, cabangId } = user;
    
    let whereClause: any = {
      statusPool: { not: 'TERSEDIA' }
    };

    if (scope === 'WILAYAH' && wilayahId) {
      whereClause.wilayahId = wilayahId;
    } else if (scope === 'CABANG' && cabangId) {
      whereClause.cabangId = cabangId;
    }

    return this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        siswaFormal: {
          include: { 
            kelas: {
              include: { lembagaMuadalah: true }
            } 
          }
        },
        dataDaimi: {
          include: {
            grup: true
          }
        },
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      },
    });
  }

  async exportStudentDetail(user: any) {
    const { scope, wilayahId, cabangId } = user;
    
    let whereClause: any = {
      statusPool: { not: 'TERSEDIA' }
    };

    if (scope === 'WILAYAH' && wilayahId) {
      whereClause.wilayahId = wilayahId;
    } else if (scope === 'CABANG' && cabangId) {
      whereClause.cabangId = cabangId;
    }

    return this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        siswaFormal: {
          include: {
            kelas: true,
          }
        },
        dataDaimi: {
          include: {
            kelas: true,
            grup: true,
          }
        },
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      },
    });
  }

  async getPoolStudents(user: any) {
    const { scope, wilayahId, cabangId } = user;
    // For Cabang users, they can pull from TERSEDIA and AKTIF_CABANG from other branches
    let whereClause: any = {
      OR: [
        { statusPool: StatusPool.TERSEDIA },
        ...(scope === 'CABANG' && cabangId ? [{
          statusPool: StatusPool.AKTIF_CABANG,
          cabangId: { not: cabangId }
        }] : []),
        ...(scope === 'WILAYAH' && wilayahId ? [{
          statusPool: StatusPool.AKTIF_CABANG,
          wilayahId: { not: wilayahId }
        }] : []),
        ...(scope === 'GLOBAL' ? [{
          statusPool: StatusPool.AKTIF_CABANG
        }] : [])
      ]
    };

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
        await tx.kehadiran.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.siswaFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.dataDaimi.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.riwayatKelasFormal.deleteMany({ where: { studentId: { in: studentIds } } });
        await tx.permintaanTarikData.deleteMany({ where: { studentId: { in: studentIds } } });
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
      
      // If student is available in pool, pull immediately
      if (student.statusPool === StatusPool.TERSEDIA) {
        const updatedStudent = await tx.student.update({
          where: { id: studentId },
          data: {
            statusPool: StatusPool.AKTIF_CABANG,
            cabangId: cabangId,
            wilayahId: student.wilayahId, // Optionally update to cabang's wilayah
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
      }
      
      // If student is in another branch, create a request to the center
      if (student.statusPool === StatusPool.AKTIF_CABANG && student.cabangId !== cabangId) {
        const existingRequest = await tx.permintaanTarikData.findFirst({
          where: {
            studentId,
            requestingCabangId: cabangId,
            status: 'PENDING'
          }
        });
        
        if (existingRequest) {
          throw new BadRequestException('Permintaan penarikan untuk siswa ini sedang diproses (PENDING)');
        }
        
        await tx.permintaanTarikData.create({
          data: {
            studentId,
            requestingCabangId: cabangId,
            targetCabangId: student.cabangId,
            status: 'PENDING'
          }
        });
        
        return { message: 'Permintaan penarikan data lintas cabang berhasil dikirim ke Pusat', isPendingRequest: true };
      }
      
      throw new BadRequestException('Siswa tidak tersedia untuk ditarik');
    });
  }

  async getPermintaanTarik(user: any) {
    const { scope, cabangId } = user;
    
    let whereClause: any = {};
    if (scope === 'CABANG' && cabangId) {
      whereClause = {
        OR: [
          { requestingCabangId: cabangId },
          { targetCabangId: cabangId }
        ]
      };
    }
    
    return this.prisma.permintaanTarikData.findMany({
      where: whereClause,
      include: {
        student: {
          include: {
            biodata: true
          }
        },
        requestingCabang: true,
        targetCabang: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async approvePermintaanTarik(id: string, user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new BadRequestException('Hanya admin pusat yang dapat menyetujui permintaan tarik data');
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.permintaanTarikData.findUnique({
        where: { id },
        include: { student: true }
      });
      
      if (!request) {
        throw new BadRequestException('Permintaan tidak ditemukan');
      }
      
      if (request.status !== 'PENDING') {
        throw new BadRequestException('Permintaan sudah diproses sebelumnya');
      }

      const targetCabang = await tx.cabang.findUnique({
        where: { id: request.requestingCabangId },
      });

      if (!targetCabang) {
        throw new BadRequestException('Cabang tujuan tidak ditemukan');
      }

      // Update student
      await tx.student.update({
        where: { id: request.studentId },
        data: {
          cabangId: request.requestingCabangId,
          wilayahId: targetCabang.wilayahId,
          statusPool: StatusPool.AKTIF_CABANG
        }
      });
      
      // Add riwayat
      await tx.riwayatPendidikan.create({
        data: {
          studentId: request.studentId,
          cabangId: request.requestingCabangId,
          tanggalMasuk: new Date(),
          catatan: `Ditarik lintas cabang dari persetujuan pusat`
        }
      });
      
      // Update request status
      return tx.permintaanTarikData.update({
        where: { id },
        data: { status: 'APPROVED' }
      });
    });
  }

  async rejectPermintaanTarik(id: string, user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new BadRequestException('Hanya admin pusat yang dapat menolak permintaan tarik data');
    }

    const request = await this.prisma.permintaanTarikData.findUnique({ where: { id } });
    if (!request) {
      throw new BadRequestException('Permintaan tidak ditemukan');
    }
    if (request.status !== 'PENDING') {
      throw new BadRequestException('Permintaan sudah diproses sebelumnya');
    }

    return this.prisma.permintaanTarikData.update({
      where: { id },
      data: { status: 'REJECTED' }
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

      const availableStudents = students.filter(s => s.statusPool === StatusPool.TERSEDIA);
      const activeStudents = students.filter(s => s.statusPool === StatusPool.AKTIF_CABANG && s.cabangId !== cabangId);

      const targetCabang = await tx.cabang.findUnique({
        where: { id: cabangId },
      });

      if (!targetCabang) {
        throw new BadRequestException('Cabang tujuan tidak ditemukan');
      }

      let pulledCount = 0;
      let requestedCount = 0;

      // 1. Process TERSEDIA students (immediate pull)
      if (availableStudents.length > 0) {
        const availableIds = availableStudents.map(s => s.id);
        await tx.student.updateMany({
          where: { id: { in: availableIds } },
          data: {
            statusPool: StatusPool.AKTIF_CABANG,
            cabangId: cabangId,
            wilayahId: targetCabang.wilayahId,
          },
        });

        const riwayatData = availableIds.map(id => ({
          studentId: id,
          cabangId: cabangId,
          tanggalMasuk: new Date(),
        }));

        await tx.riwayatPendidikan.createMany({
          data: riwayatData,
        });
        pulledCount = availableIds.length;
      }

      // 2. Process AKTIF_CABANG students (create request)
      if (activeStudents.length > 0) {
        // Find existing pending requests to avoid duplicates
        const activeIds = activeStudents.map(s => s.id);
        const existingRequests = await tx.permintaanTarikData.findMany({
          where: {
            studentId: { in: activeIds },
            requestingCabangId: cabangId,
            status: 'PENDING'
          }
        });
        
        const existingStudentIds = new Set(existingRequests.map(r => r.studentId));
        const newRequests = activeStudents
          .filter(s => !existingStudentIds.has(s.id))
          .map(s => ({
            studentId: s.id,
            requestingCabangId: cabangId,
            targetCabangId: s.cabangId,
            status: 'PENDING' as const
          }));
          
        if (newRequests.length > 0) {
          await tx.permintaanTarikData.createMany({
            data: newRequests
          });
          requestedCount = newRequests.length;
        }
      }

      return { 
        message: 'Proses penarikan siswa selesai',
        pulledCount, 
        requestedCount,
        success: true
      };
    });
  }

  async getPendingPermintaanCount() {
    return this.prisma.permintaanTarikData.count({
      where: { status: 'PENDING' }
    });
  }
  async lepasSiswa(studentId: string, dto: { statusAkhir: StatusPool, catatan?: string }, user: any) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) {
        throw new BadRequestException('Siswa tidak ditemukan');
      }
      
      if (user.scope !== 'GLOBAL' && student.cabangId !== user.cabangId) {
        throw new BadRequestException('Tidak memiliki akses');
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

      let isActive = true;
      if (dto.statusAkhir === StatusPool.MUTASI || dto.statusAkhir === StatusPool.DROP_OUT) {
        isActive = false;
      }

      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: {
          statusPool: dto.statusAkhir,
          cabangId: (dto.statusAkhir === StatusPool.TERSEDIA) ? null : student.cabangId,
          wilayahId: (dto.statusAkhir === StatusPool.TERSEDIA) ? null : student.wilayahId,
          isActive,
        },
      });

      return updatedStudent;
    });
  }

  async lepasMassalSiswa(studentIds: string[], dto: { statusAkhir: StatusPool, catatan?: string }, user: any) {
    if (!studentIds || studentIds.length === 0) {
      throw new BadRequestException('Siswa tidak terpilih');
    }

    return this.prisma.$transaction(async (tx) => {
      const students = await tx.student.findMany({
        where: { id: { in: studentIds } }
      });

      if (students.length === 0) {
        throw new BadRequestException('Siswa tidak ditemukan');
      }

      for (const student of students) {
        if (user.scope !== 'GLOBAL' && student.cabangId !== user.cabangId) {
          throw new BadRequestException(`Tidak memiliki akses untuk siswa ${student.id}`);
        }

        // Update current riwayat
        const activeRiwayat = await tx.riwayatPendidikan.findFirst({
          where: {
            studentId: student.id,
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

        let isActive = true;
        if (dto.statusAkhir === StatusPool.MUTASI || dto.statusAkhir === StatusPool.DROP_OUT) {
          isActive = false;
        }

        await tx.student.update({
          where: { id: student.id },
          data: {
            statusPool: dto.statusAkhir,
            cabangId: (dto.statusAkhir === StatusPool.TERSEDIA) ? null : student.cabangId,
            wilayahId: (dto.statusAkhir === StatusPool.TERSEDIA) ? null : student.wilayahId,
            isActive,
          },
        });
      }

      return { count: students.length };
    });
  }

  async verifyDaftarUlang({ nik, kodeDaftarUlang }: { nik: string, kodeDaftarUlang: string }) {
    const setting = await this.prisma.pengaturanAkademik.findFirst();
    if (!setting || !setting.kodeDaftarUlang || setting.kodeDaftarUlang.toUpperCase() !== kodeDaftarUlang?.toUpperCase()) {
      throw new BadRequestException('Kode daftar ulang salah atau tidak tersedia');
    }

    if (!nik || !nik.trim()) {
      return { exists: false };
    }

    const searchVal = nik.trim();
    let biodata = await this.prisma.biodata.findFirst({
      where: { nik: searchVal }
    });
    
    // Fallback search by NISN or NIS Lokal if NIK not found
    if (!biodata) {
      biodata = await this.prisma.biodata.findFirst({
        where: { 
          OR: [
            { nisn: searchVal },
            { nisLokal: searchVal }
          ]
        }
      });
    }

    if (!biodata) {
      return { exists: false };
    }

    const student = await this.prisma.student.findFirst({
      where: { biodataId: biodata.id },
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        siswaFormal: { include: { kelas: true } },
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      }
    });

    if (!student) {
      return { exists: false };
    }

    return { exists: true, student };
  }

  async submitDaftarUlang(data: any) {
    const { kodeDaftarUlang, studentId, ...studentData } = data;
    
    const setting = await this.prisma.pengaturanAkademik.findFirst();
    if (!setting || !setting.kodeDaftarUlang || setting.kodeDaftarUlang.toUpperCase() !== kodeDaftarUlang?.toUpperCase()) {
      throw new BadRequestException('Kode daftar ulang salah atau tidak tersedia');
    }

    if (studentId) {
      // Re-registration of existing student
      return this.updateStudent(studentId, studentData, null);
    } else {
      // New student registration
      return this.createStudent(null, studentData);
    }
  }

  // ─── Upload Dokumen Siswa (membutuhkan auth) ───────────────────────────────

  async uploadDokumenSiswa(studentId: string, jenis: DokumenJenis, file: Express.Multer.File) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { biodata: true }
    });
    if (!student) throw new BadRequestException('Siswa tidak ditemukan');

    return this._simpanDokumenBiodata(student.biodataId, jenis, file);
  }

  // ─── Upload Dokumen Publik untuk Daftar Ulang ──────────────────────────────

  async uploadDokumenPublik(biodataId: string, jenis: DokumenJenis, file: Express.Multer.File) {
    const biodata = await this.prisma.biodata.findUnique({ where: { id: biodataId } });
    if (!biodata) throw new BadRequestException('Data biodata tidak ditemukan');

    return this._simpanDokumenBiodata(biodataId, jenis, file);
  }

  // ─── Internal helper ───────────────────────────────────────────────────────

  private async _simpanDokumenBiodata(
    biodataId: string,
    jenis: DokumenJenis,
    file: Express.Multer.File
  ) {
    const field = JENIS_TO_FIELD[jenis];
    if (!field) throw new BadRequestException(`Jenis dokumen tidak valid: ${jenis}`);

    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const allowedExt = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
    if (!allowedExt.includes(ext)) {
      throw new BadRequestException(`Format file tidak didukung. Gunakan: ${allowedExt.join(', ')}`);
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('Ukuran file maksimal 10MB');
    }

    const uploadDir = path.join(process.cwd(), 'uploads', jenis);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `biodata_${biodataId}_${jenis}${ext}`;
    const filePath = path.join(uploadDir, filename);

    // Hapus file lama jika ada
    const biodata = await this.prisma.biodata.findUnique({ where: { id: biodataId } });
    const oldUrl: string | null = (biodata as any)?.[field] ?? null;
    if (oldUrl) {
      const oldPath = path.join(process.cwd(), oldUrl.startsWith('/') ? oldUrl.slice(1) : oldUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/${jenis}/${filename}`;
    await this.prisma.biodata.update({
      where: { id: biodataId },
      data: { [field]: fileUrl } as any
    });

    return { url: fileUrl, jenis, filename };
  }

  // ─── Upload File Sementara ─────────────────────────────────────────────────

  async uploadTemp(jenis: DokumenJenis, file: Express.Multer.File) {
    if (!JENIS_TO_FIELD[jenis]) {
      throw new BadRequestException(`Jenis dokumen tidak valid: ${jenis}`);
    }

    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const allowedExt = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
    if (!allowedExt.includes(ext)) {
      throw new BadRequestException(`Format file tidak didukung. Gunakan: ${allowedExt.join(', ')}`);
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('Ukuran file maksimal 10MB');
    }

    const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, file.buffer);

    const fileUrl = `/uploads/temp/${filename}`;
    return { url: fileUrl, jenis, filename };
  }

  // ─── Pindahkan File Temp & Simpan URL Dokumen ke Biodata ──────────────────

  private async _processTempAndDocUrls(tx: any, biodataId: string, data: any) {
    const updates: any = {};
    for (const [jenis, field] of Object.entries(JENIS_TO_FIELD)) {
      const url = data[field];
      if (url && typeof url === 'string' && url.includes('/uploads/temp/')) {
        const tempPath = path.join(process.cwd(), url.startsWith('/') ? url.slice(1) : url);
        if (fs.existsSync(tempPath)) {
          const ext = path.extname(tempPath) || '.jpg';
          const uploadDir = path.join(process.cwd(), 'uploads', jenis);
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const filename = `biodata_${biodataId}_${jenis}${ext}`;
          const newPath = path.join(uploadDir, filename);
          fs.copyFileSync(tempPath, newPath);
          try { fs.unlinkSync(tempPath); } catch {}
          updates[field] = `/uploads/${jenis}/${filename}`;
        } else {
          updates[field] = url;
        }
      } else if (url !== undefined) {
        updates[field] = url;
      }
    }
    if (Object.keys(updates).length > 0) {
      await tx.biodata.update({
        where: { id: biodataId },
        data: updates
      });
    }
  }
}

