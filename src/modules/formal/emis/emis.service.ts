import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { EmisCryptoService } from './emis-crypto.service.js';
import { VervalStudentItem } from './verval.service.js';

export interface EmisStudentDetail {
  id: string;
  nisn: string;
  nik?: string;
  fullName: string;
  birthPlace: string;
  birthDate: string;
  gender: string;
  motherName?: string;
  fatherName?: string;
  studyGroupName?: string;
  raw?: any;
}

export interface ReconciledStudentItem {
  id: string; // eSantri student ID
  nama: string;
  cabangId?: string;
  cabangName: string;
  wilayahName: string;
  lembagaMuadalahName?: string;
  tingkat?: string;
  kelasName?: string;
  nisnEsantri: string;
  nikEsantri: string;
  tempatLahirEsantri: string;
  tanggalLahirEsantri: string;
  jenisKelaminEsantri: string;

  // Status EMIS
  statusEmis: 'TERDAFTAR' | 'BELUM_TERDAFTAR' | 'DISKREPANSI';
  emisId?: string;
  nisnEmis?: string;
  rombelEmis?: string;

  // Status Verval
  statusVerval: 'VERVAL_OK' | 'RESIDU_VERVAL' | 'BELUM_TERDAFTAR';
  vervalPdId?: string;
  nisnVerval?: string;
  residuDetail?: Record<string, string>;

  // Status Audit & Tindak Lanjut
  butuhTindakan: boolean;
  discrepancies: string[];
  rekomendasiTindakan: string;
}

export interface ReconciliationSummary {
  totalSantriEsantri: number;
  totalTerdaftarEmis: number;
  totalBelumEmis: number;
  totalVervalOk: number;
  totalResiduVerval: number;
  totalBelumVerval: number;
  totalDiskrepansi: number;
  totalButuhTindakan: number;
  cabangBreakdown: {
    cabangId: string;
    cabangName: string;
    wilayahName: string;
    totalSantri: number;
    terdaftarEmis: number;
    belumEmis: number;
    vervalOk: number;
    residuVerval: number;
    butuhTindakan: number;
  }[];
  students: ReconciledStudentItem[];
  unmatchedExternal: {
    emisOnly: any[];
    vervalOnly: any[];
  };
}

@Injectable()
export class EmisService {
  private readonly logger = new Logger(EmisService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmisCryptoService) private readonly cryptoService: EmisCryptoService,
  ) {}

  /**
   * Mengambil daftar seluruh santri (list saja) dari API EMIS
   */
  async fetchStudentList(token: string): Promise<any[]> {
    if (!token || token.trim() === '') {
      throw new HttpException('Bearer Token EMIS tidak boleh kosong', HttpStatus.BAD_REQUEST);
    }

    const cleanToken = token.trim();
    const url = 'https://api-emis.kemenag.go.id/v1/students/pontrens/institution/student-list?per_page=10000';

    try {
      this.logger.log('Mengambil daftar santri dari API EMIS Kemenag...');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new HttpException('Bearer Token EMIS kedaluwarsa (401). Silakan perbarui token dari portal EMIS.', HttpStatus.UNAUTHORIZED);
        }
        throw new HttpException(`HTTP ${response.status} dari EMIS API`, HttpStatus.BAD_GATEWAY);
      }

      const data: any = await response.json();
      return data?.results || [];
    } catch (err: any) {
      this.logger.error(`Gagal fetch student list EMIS: ${err.message}`);
      if (err instanceof HttpException) throw err;
      throw new HttpException(`Gagal menghubungi server EMIS Kemenag: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Helper flattening JSON EMIS sesuai logika vermis/index.php
   */
  flattenEmisResult(result: any): any {
    const skip = [
      'vaccine_types', 'student_vaccine_types', 'learning_activity', 'scholarships',
      'achievements', 'parents', 'm_gender', 'm_religion', 'm_life_goal', 'm_hobby',
      'm_residence_distance', 'm_residence_status', 'm_interval_time', 'm_transportation',
      'm_special_need', 'm_fund_source', 'm_disabilities', 'm_province', 'm_city',
      'm_district', 'm_sub_district', 'm_status_dukcapil', 'institution', 'in_satpen'
    ];

    const row: any = {};
    for (const [k, v] of Object.entries(result)) {
      if (!skip.includes(k) && typeof v !== 'object') row[k] = v;
    }

    const lookups: Record<string, string> = {
      m_gender: 'name', m_religion: 'name', m_life_goal: 'name', m_hobby: 'name',
      m_residence_status: 'name', m_residence_distance: 'name', m_interval_time: 'name',
      m_transportation: 'name', m_special_need: 'name', m_fund_source: 'name',
      m_disabilities: 'name', m_province: 'name', m_city: 'name',
      m_district: 'name', m_sub_district: 'name', m_status_dukcapil: 'status'
    };
    for (const [key, field] of Object.entries(lookups)) {
      row[`${key}_${field}`] = result[key] ? result[key][field] : null;
    }

    const la = result.learning_activity;
    if (la) {
      ['absent_number', 'academic_year_id', 'm_level_id', 'm_major_id', 'student_status_id', 'start_date', 'admission_date'].forEach(k => {
        row[`la_${k}`] = la[k];
      });
      row['la_study_group_name'] = la.study_group?.name || null;
      row['la_room_name'] = la.study_group?.room_name || null;
      row['la_academic_year'] = la.academic_year?.name || null;
      row['la_major_name'] = la.m_major?.name || null;
      row['la_student_status'] = la.student_status?.name || null;
    }

    const parents = result.parents;
    if (parents) {
      const scalarFields = [
        'father_full_name', 'father_nik', 'father_birth_place', 'father_birth_date',
        'father_phone_number', 'is_father_phone_null', 'father_domicile', 'father_nationality',
        'father_address', 'father_rt', 'father_rw', 'father_postal_code', 'father_latest_education',
        'mother_full_name', 'mother_nik', 'mother_birth_place', 'mother_birth_date',
        'mother_phone_number', 'is_mother_phone_null', 'mother_domicile', 'mother_nationality',
        'mother_address', 'mother_rt', 'mother_rw', 'mother_postal_code', 'mother_latest_education',
        'wali', 'wali_full_name', 'wali_nik', 'wali_birth_place', 'wali_birth_date',
        'wali_phone_number', 'is_wali_phone_null', 'wali_domicile', 'wali_nationality',
        'wali_address', 'wali_rt', 'wali_rw', 'wali_postal_code', 'is_kk_same_father'
      ];
      scalarFields.forEach(f => {
        row[`parent_${f}`] = parents[f];
      });
    }

    return row;
  }

  /**
   * Mengambil detail santri EMIS secara batch
   */
  async fetchStudentDetails(
    token: string,
    studentIds: string[],
    delayMs = 250
  ): Promise<any[]> {
    if (!studentIds || studentIds.length === 0) return [];

    const cleanToken = token.trim();
    const encodedMap = this.cryptoService.encryptBatch(studentIds);
    const results: any[] = [];

    this.logger.log(`Memulai ekstraksi detail ${studentIds.length} santri EMIS...`);

    for (let i = 0; i < studentIds.length; i++) {
      const id = studentIds[i];
      const encId = encodedMap[id];
      if (!encId) continue;

      const url = `https://api-emis.kemenag.go.id/v1/students/pontrens/students/${encId}`;
      let attempt = 1;
      let success = false;

      while (attempt <= 3 && !success) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${cleanToken}`,
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
          });

          if (res.status === 429) {
            this.logger.warn(`Rate limit 429 EMIS API. Menunggu 5 detik (percobaan ${attempt}/3)...`);
            await new Promise(r => setTimeout(r, 5000));
            attempt++;
            continue;
          }
          if (res.status === 404) {
            break;
          }
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const resData: any = await res.json();
          if (resData?.results) {
            const flattened = this.flattenEmisResult(resData.results);
            flattened._emis_id = id;
            flattened._emis_encoded_id = encId;
            results.push(flattened);
            success = true;
          }
        } catch (err: any) {
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 2000));
          }
          attempt++;
        }
      }

      if (delayMs > 0 && i < studentIds.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    return results;
  }

  // ── Helper Normalisasi String, Tanggal & Rombel ──
  normalizeText(str: string): string {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^a-z0-9\s]/g, '');
  }

  /**
   * Mengurai nama tingkat/rombel versi EMIS.
   * Contoh input: "Kelas 7 - 7-W2060" -> tingkat: "Kelas 7", rombel: "7-W2060"
   * Contoh input: "Kelas 12 - U2352"   -> tingkat: "Kelas 12", rombel: "U2352"
   */
  parseEmisRombel(rawRombelOrTingkat: string): { tingkat: string; rombel: string } {
    if (!rawRombelOrTingkat) return { tingkat: '', rombel: '' };
    const str = String(rawRombelOrTingkat).trim();
    const match = str.match(/Kelas\s*(\d+)\s*-\s*(.+)/i);
    if (match) {
      return {
        tingkat: `Kelas ${match[1].trim()}`,
        rombel: match[2].trim(),
      };
    }
    return {
      tingkat: '',
      rombel: str,
    };
  }

  /**
   * Normalisasi rombel untuk pencocokan toleran terhadap spasi dan tanda hubung
   */
  normalizeRombel(str: string): string {
    if (!str) return '';
    const parsed = this.parseEmisRombel(str);
    const target = parsed.rombel || str;
    return this.normalizeText(target).replace(/[\s-_]/g, '');
  }

  createMergeKey(nama: string, tempatLahir: string): string {
    return `${this.normalizeText(nama)}|${this.normalizeText(tempatLahir)}`;
  }

  createNameBirthDateKey(nama: string, rawDate: any): string {
    const normName = this.normalizeText(nama);
    const normDate = this.normalizeDate(rawDate);
    if (!normName || !normDate) return '';
    return `${normName}|${normDate}`;
  }

  createNameRombelKey(nama: string, rawRombel: string): string {
    const normName = this.normalizeText(nama);
    const normRombel = this.normalizeRombel(rawRombel);
    if (!normName || !normRombel) return '';
    return `${normName}|${normRombel}`;
  }

  normalizeDate(rawDate: any): string | null {
    if (!rawDate) return null;
    const str = String(rawDate).trim();
    if (!str) return null;

    // ISO: yyyy-mm-dd
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    // Tanggal teks indonesia/inggris: "15 Agustus 2008" atau "15 Aug 2008"
    const textMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (textMatch) {
      const day = textMatch[1].padStart(2, '0');
      const monthToken = textMatch[2].toLowerCase();
      const year = textMatch[3];
      const monthMap: Record<string, string> = {
        jan: '01', januari: '01', january: '01',
        feb: '02', februari: '02', february: '02',
        mar: '03', maret: '03', march: '03',
        apr: '04', april: '04',
        mei: '05', may: '05',
        jun: '06', juni: '06', june: '06',
        jul: '07', juli: '07', july: '07',
        agu: '08', ags: '08', agustus: '08', aug: '08', august: '08',
        sep: '09', sept: '09', september: '09',
        okt: '10', oktober: '10', october: '10',
        nov: '11', november: '11',
        des: '12', desember: '12', december: '12',
      };
      const month = monthMap[monthToken] || '01';
      return `${year}-${month}-${day}`;
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return null;
  }

  /**
   * INTI ALGORITMA REKONSILIASI & VALIDASI:
   * Membandingkan data riil database eSantri dengan data hasil fetch EMIS & Verval.
   * Tidak ada data di database yang diubah (Murni Read-Only Audit).
   */
  async reconcileWithDatabase(options: {
    emisStudents?: any[];
    vervalStudents?: VervalStudentItem[];
    cabangId?: string;
    wilayahId?: string;
  }): Promise<ReconciliationSummary> {
    const { emisStudents = [], vervalStudents = [], cabangId, wilayahId } = options;

    // 1. Ambil data seluruh santri aktif dari PostgreSQL
    const whereClause: any = {
      isActive: true,
    };
    if (cabangId) whereClause.cabangId = cabangId;
    if (wilayahId) whereClause.wilayahId = wilayahId;

    const dbStudents = await this.prisma.student.findMany({
      where: whereClause,
      include: {
        biodata: true,
        cabang: true,
        wilayah: true,
        siswaFormal: {
          include: {
            kelas: {
              include: {
                lembagaMuadalah: true,
              },
            },
          },
        },
      },
      orderBy: [
        { cabang: { name: 'asc' } },
        { biodata: { fullName: 'asc' } },
      ],
    });

    // 2. Buat Lookup Map untuk EMIS
    // Kunci 1: NISN
    // Kunci 2: Nama + Tanggal Lahir (sangat presisi)
    // Kunci 3: Nama + Tempat Lahir
    // Kunci 4: Nama + Rombel
    const emisByNisn = new Map<string, any>();
    const emisByNameBirthDate = new Map<string, any>();
    const emisByNameBirthPlace = new Map<string, any>();
    const emisByNameRombel = new Map<string, any>();
    const processedEmisKeys = new Set<string>();

    for (const em of emisStudents) {
      const nisn = (em.nisn || em.list_nisn || '').trim();
      const nama = em.full_name || em.nama || em.list_full_name || em.list_nama || '';
      const tmptLahir = em.birth_place || em.tempat_lahir || em.list_birth_place || '';
      const tglLahir = em.birth_date || em.tanggal_lahir || em.list_birth_date || '';

      // Parsing format EMIS: "Kelas 7 - 7-W2060" atau "Kelas 12 - U2352"
      const rawRombelOrTingkat = em.tingkat || em.la_study_group_name || em.study_group_name || em.rombel || em.nama_rombel || '';
      const { rombel: parsedRombel, tingkat: parsedTingkat } = this.parseEmisRombel(rawRombelOrTingkat);
      em._parsed_rombel = parsedRombel || rawRombelOrTingkat;
      em._parsed_tingkat = parsedTingkat;

      const keyNameBirthDate = this.createNameBirthDateKey(nama, tglLahir);
      const keyNameBirthPlace = this.createMergeKey(nama, tmptLahir);
      const keyNameRombel = this.createNameRombelKey(nama, em._parsed_rombel);

      if (nisn) emisByNisn.set(nisn, em);
      if (keyNameBirthDate) emisByNameBirthDate.set(keyNameBirthDate, em);
      if (keyNameBirthPlace) emisByNameBirthPlace.set(keyNameBirthPlace, em);
      if (keyNameRombel) emisByNameRombel.set(keyNameRombel, em);
    }

    // 3. Buat Lookup Map untuk Verval
    const vervalByNisn = new Map<string, VervalStudentItem>();
    const vervalByNameBirthDate = new Map<string, VervalStudentItem>();
    const vervalByNameBirthPlace = new Map<string, VervalStudentItem>();
    const processedVervalKeys = new Set<string>();

    for (const vv of vervalStudents) {
      const nisn = (vv.nisn || '').trim();
      const keyNameBirthDate = this.createNameBirthDateKey(vv.nama, vv.tanggalLahir);
      const keyNameBirthPlace = this.createMergeKey(vv.nama, vv.tempatLahir);

      if (nisn) vervalByNisn.set(nisn, vv);
      if (keyNameBirthDate) vervalByNameBirthDate.set(keyNameBirthDate, vv);
      if (keyNameBirthPlace) vervalByNameBirthPlace.set(keyNameBirthPlace, vv);
    }

    // 4. Lakukan Komparasi untuk Setiap Santri di Database eSantri
    const reconciledList: ReconciledStudentItem[] = [];
    const cabangStatMap = new Map<string, {
      cabangId: string;
      cabangName: string;
      wilayahName: string;
      totalSantri: number;
      terdaftarEmis: number;
      belumEmis: number;
      vervalOk: number;
      residuVerval: number;
      butuhTindakan: number;
    }>();

    let totalTerdaftarEmis = 0;
    let totalBelumEmis = 0;
    let totalVervalOk = 0;
    let totalResiduVerval = 0;
    let totalBelumVerval = 0;
    let totalDiskrepansi = 0;
    let totalButuhTindakan = 0;

    for (const s of dbStudents) {
      const bio = s.biodata || ({} as any);
      const sf = s.siswaFormal;
      const cabangIdStr = s.cabangId || 'TANPA_CABANG';
      const cabangNameStr = s.cabang?.name || 'Cabang Belum Ditentukan';
      const wilayahNameStr = s.wilayah?.name || s.cabang?.alamatProvName || '-';

      // Inisialisasi statistik cabang
      if (!cabangStatMap.has(cabangIdStr)) {
        cabangStatMap.set(cabangIdStr, {
          cabangId: cabangIdStr,
          cabangName: cabangNameStr,
          wilayahName: wilayahNameStr,
          totalSantri: 0,
          terdaftarEmis: 0,
          belumEmis: 0,
          vervalOk: 0,
          residuVerval: 0,
          butuhTindakan: 0,
        });
      }
      const cStat = cabangStatMap.get(cabangIdStr)!;
      cStat.totalSantri++;

      const namaEsantri = bio.fullName || '';
      const tmptLahirEsantri = bio.tempatLahir || '';
      const tglLahirEsantriStr = this.normalizeDate(bio.tanggalLahir);
      const nisnEsantri = (sf?.nisn || bio.nisn || '').trim();
      const esantriRombel = sf?.kelas?.name || '';
      const esantriTingkat = sf?.tingkat || sf?.kelas?.tingkat || '';

      const keyNameBirthDate = this.createNameBirthDateKey(namaEsantri, bio.tanggalLahir);
      const keyNameBirthPlace = this.createMergeKey(namaEsantri, tmptLahirEsantri);
      const keyNameRombel = this.createNameRombelKey(namaEsantri, esantriRombel);

      // --- Matching EMIS (Hirarki: NISN -> Nama+TglLahir -> Nama+TmptLahir -> Nama+Rombel) ---
      let matchedEmis: any = null;
      let matchMethodEmis = '';
      if (nisnEsantri && emisByNisn.has(nisnEsantri)) {
        matchedEmis = emisByNisn.get(nisnEsantri);
        matchMethodEmis = 'NISN';
      } else if (keyNameBirthDate && emisByNameBirthDate.has(keyNameBirthDate)) {
        matchedEmis = emisByNameBirthDate.get(keyNameBirthDate);
        matchMethodEmis = 'NAMA_TGL_LAHIR';
      } else if (keyNameBirthPlace && emisByNameBirthPlace.has(keyNameBirthPlace)) {
        matchedEmis = emisByNameBirthPlace.get(keyNameBirthPlace);
        matchMethodEmis = 'NAMA_TMPT_LAHIR';
      } else if (keyNameRombel && emisByNameRombel.has(keyNameRombel)) {
        matchedEmis = emisByNameRombel.get(keyNameRombel);
        matchMethodEmis = 'NAMA_ROMBEL';
      }

      // --- Matching Verval (Hirarki: NISN -> Nama+TglLahir -> Nama+TmptLahir) ---
      let matchedVerval: VervalStudentItem | null = null;
      if (nisnEsantri && vervalByNisn.has(nisnEsantri)) {
        matchedVerval = vervalByNisn.get(nisnEsantri)!;
      } else if (keyNameBirthDate && vervalByNameBirthDate.has(keyNameBirthDate)) {
        matchedVerval = vervalByNameBirthDate.get(keyNameBirthDate)!;
      } else if (keyNameBirthPlace && vervalByNameBirthPlace.has(keyNameBirthPlace)) {
        matchedVerval = vervalByNameBirthPlace.get(keyNameBirthPlace)!;
      }

      const discrepancies: string[] = [];
      let statusEmis: 'TERDAFTAR' | 'BELUM_TERDAFTAR' | 'DISKREPANSI' = 'BELUM_TERDAFTAR';
      let statusVerval: 'VERVAL_OK' | 'RESIDU_VERVAL' | 'BELUM_TERDAFTAR' = 'BELUM_TERDAFTAR';
      let butuhTindakan = false;
      const rekomendasiList: string[] = [];

      // Evaluasi EMIS
      if (matchedEmis) {
        processedEmisKeys.add(matchedEmis._emis_id || keyNameBirthDate || keyNameBirthPlace || keyNameRombel);
        const emisNisn = (matchedEmis.nisn || matchedEmis.list_nisn || '').trim();
        const emisTgl = this.normalizeDate(matchedEmis.birth_date || matchedEmis.tanggal_lahir);
        const emisRombelName = matchedEmis._parsed_rombel || matchedEmis.la_study_group_name || matchedEmis.study_group_name || '';

        if (nisnEsantri && emisNisn && nisnEsantri !== emisNisn) {
          discrepancies.push(`NISN Berbeda: eSantri (${nisnEsantri}) vs EMIS (${emisNisn})`);
          statusEmis = 'DISKREPANSI';
        } else {
          statusEmis = 'TERDAFTAR';
        }

        if (tglLahirEsantriStr && emisTgl && tglLahirEsantriStr !== emisTgl) {
          discrepancies.push(`Tanggal Lahir Berbeda: eSantri (${tglLahirEsantriStr}) vs EMIS (${emisTgl})`);
        }

        if (esantriRombel && emisRombelName) {
          const normEsantriRombel = this.normalizeRombel(esantriRombel);
          const normEmisRombel = this.normalizeRombel(emisRombelName);
          if (normEsantriRombel !== normEmisRombel) {
            discrepancies.push(`Rombel Berbeda: eSantri (${esantriRombel}) vs EMIS (${emisRombelName})`);
          }
        }

        cStat.terdaftarEmis++;
        totalTerdaftarEmis++;
      } else {
        statusEmis = 'BELUM_TERDAFTAR';
        butuhTindakan = true;
        rekomendasiList.push('Cabang perlu mendaftarkan santri ini ke EMIS Kemenag');
        cStat.belumEmis++;
        totalBelumEmis++;
      }

      // Evaluasi Verval
      if (matchedVerval) {
        processedVervalKeys.add(matchedVerval.pesertaDidikId || keyNameBirthDate || keyNameBirthPlace);
        if (matchedVerval.isResidu) {
          statusVerval = 'RESIDU_VERVAL';
          butuhTindakan = true;
          const rKeys = Object.keys(matchedVerval.residuDetail || {}).join(', ');
          rekomendasiList.push(`Perbaiki data residu Verval di cabang (${rKeys || 'Cek kembali data identitas'})`);
          cStat.residuVerval++;
          totalResiduVerval++;
        } else {
          statusVerval = 'VERVAL_OK';
          cStat.vervalOk++;
          totalVervalOk++;
        }
      } else {
        statusVerval = 'BELUM_TERDAFTAR';
        if (!matchedEmis) {
          // Jika belum di EMIS dan belum di Verval
          rekomendasiList.push('Belum terdaftar di Verval Kemendikbud');
        }
        totalBelumVerval++;
      }

      if (discrepancies.length > 0) {
        butuhTindakan = true;
        totalDiskrepansi++;
        rekomendasiList.push('Cabang perlu menyelaraskan data NISN/Lahir/Rombel dengan dokumen asli');
      }

      if (butuhTindakan) {
        cStat.butuhTindakan++;
        totalButuhTindakan++;
      }

      reconciledList.push({
        id: s.id,
        nama: namaEsantri,
        cabangId: s.cabangId || undefined,
        cabangName: cabangNameStr,
        wilayahName: wilayahNameStr,
        lembagaMuadalahName: sf?.kelas?.lembagaMuadalah?.name || '-',
        tingkat: sf?.tingkat || sf?.kelas?.tingkat || '-',
        kelasName: sf?.kelas?.name || '-',
        nisnEsantri: nisnEsantri || '-',
        nikEsantri: bio.nik || '-',
        tempatLahirEsantri: tmptLahirEsantri || '-',
        tanggalLahirEsantri: tglLahirEsantriStr || '-',
        jenisKelaminEsantri: bio.jenisKelamin || '-',

        statusEmis,
        emisId: matchedEmis?._emis_id,
        nisnEmis: matchedEmis?.nisn || matchedEmis?.list_nisn || '-',
        rombelEmis: matchedEmis?._parsed_rombel || matchedEmis?.la_study_group_name || matchedEmis?.study_group_name || '-',

        statusVerval,
        vervalPdId: matchedVerval?.pesertaDidikId,
        nisnVerval: matchedVerval?.nisn || '-',
        residuDetail: matchedVerval?.residuDetail,

        butuhTindakan,
        discrepancies,
        rekomendasiTindakan: rekomendasiList.join('. ') || 'Data sudah sesuai & aman.',
      });
    }

    // 5. Kumpulkan data EMIS & Verval yang tidak ada di database eSantri (External Only)
    const emisOnly: any[] = [];
    for (const em of emisStudents) {
      const id = em._emis_id;
      const key = this.createMergeKey(em.full_name || em.nama || '', em.birth_place || em.tempat_lahir || '');
      if ((id && !processedEmisKeys.has(id)) || (!id && !processedEmisKeys.has(key))) {
        emisOnly.push(em);
      }
    }

    const vervalOnly: any[] = [];
    for (const vv of vervalStudents) {
      const id = vv.pesertaDidikId;
      const key = this.createMergeKey(vv.nama, vv.tempatLahir);
      if ((id && !processedVervalKeys.has(id)) || (!id && !processedVervalKeys.has(key))) {
        vervalOnly.push(vv);
      }
    }

    return {
      totalSantriEsantri: dbStudents.length,
      totalTerdaftarEmis,
      totalBelumEmis,
      totalVervalOk,
      totalResiduVerval,
      totalBelumVerval,
      totalDiskrepansi,
      totalButuhTindakan,
      cabangBreakdown: Array.from(cabangStatMap.values()),
      students: reconciledList,
      unmatchedExternal: {
        emisOnly,
        vervalOnly,
      },
    };
  }
}
