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
  sourceLembagaEmis?: string;

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
  batchId?: string;
  executedAt?: Date;
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

    const cleanToken = token.trim().replace(/^Bearer\s+/i, '');
    const url = 'https://api-emis.kemenag.go.id/v1/students/pontrens/institution/student-list?per_page=10000';

    try {
      this.logger.log('Mengambil daftar santri dari API EMIS Kemenag...');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Origin': 'https://emis.kemenag.go.id',
          'Referer': 'https://emis.kemenag.go.id/',
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        let errBody = '';
        try {
          errBody = await response.text();
        } catch {}
        this.logger.error(`EMIS API returned status ${response.status}: ${errBody}`);

        if (response.status === 401) {
          throw new HttpException('Bearer Token EMIS kedaluwarsa atau tidak valid (401). Silakan login ke portal EMIS dan salin Bearer Token baru.', HttpStatus.UNAUTHORIZED);
        }
        if (response.status === 403) {
          throw new HttpException(`Akses ke API EMIS ditolak (403 Forbidden). Pastikan akun operator memiliki hak akses lembaga santri. (${errBody.slice(0, 100)})`, HttpStatus.FORBIDDEN);
        }
        throw new HttpException(`Server EMIS Kemenag merespons HTTP ${response.status}: ${errBody.slice(0, 120) || 'Gagal'}`, HttpStatus.BAD_GATEWAY);
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
  normalizeText(str: any): string {
    return String(str || '')
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
  parseEmisRombel(rawRombelOrTingkat: any): { tingkat: string; rombel: string } {
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
  normalizeRombel(str: any): string {
    if (!str) return '';
    const parsed = this.parseEmisRombel(str);
    const target = parsed.rombel || str;
    return this.normalizeText(target).replace(/[\s-_]/g, '');
  }

  createMergeKey(nama: any, tempatLahir: any): string {
    return `${this.normalizeText(nama)}|${this.normalizeText(tempatLahir)}`;
  }

  createNameBirthDateKey(nama: any, rawDate: any): string {
    const normName = this.normalizeText(nama);
    const normDate = this.normalizeDate(rawDate);
    if (!normName || !normDate) return '';
    return `${normName}|${normDate}`;
  }

  createNameRombelKey(nama: any, rawRombel: any): string {
    const normName = this.normalizeText(nama);
    const normRombel = this.normalizeRombel(rawRombel);
    if (!normName || !normRombel) return '';
    return `${normName}|${normRombel}`;
  }

  normalizeNik(rawNik: any): string {
    if (!rawNik) return '';
    return String(rawNik).replace(/\D/g, '').trim();
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
   * Mengambil snapshot santri EMIS yang terdaftar dari batch komparasi terakhir.
   * Memastikan data EMIS kemarin tidak hilang ketika pengguna melakukan komparasi VervalPD secara terpisah.
   */
  async getFallbackEmisStudents(): Promise<any[]> {
    try {
      const lastEmisBatch = await this.prisma.komparasiEmisBatch.findFirst({
        where: { totalTerdaftarEmis: { gt: 0 } },
        orderBy: { executedAt: 'desc' },
        select: { id: true, executedAt: true },
      });

      if (!lastEmisBatch) return [];

      const prevRecords = await this.prisma.komparasiEmis.findMany({
        where: {
          batchId: lastEmisBatch.id,
          statusEmis: { in: ['TERDAFTAR', 'DISKREPANSI'] },
        },
      });

      return prevRecords.map((r: any) => ({
        id: r.emisId || r.id,
        _emis_id: r.emisId,
        nik: r.nikEsantri,
        nisn: r.nisnEmis && r.nisnEmis !== '-' ? r.nisnEmis : r.nisnEsantri,
        full_name: r.nama,
        birth_place: r.tempatLahirEsantri,
        birth_date: r.tanggalLahirEsantri,
        tingkat: r.tingkat,
        rombel: r.rombelEmis,
        la_study_group_name: r.rombelEmis,
        _parsed_rombel: r.rombelEmis,
        _source_lembaga: r.sourceLembagaEmis || 'Snapshot EMIS Tersimpan',
        _is_snapshot_fallback: true,
      }));
    } catch (err: any) {
      this.logger.error(`Gagal mengambil fallback snapshot EMIS: ${err.message}`);
      return [];
    }
  }

  /**
   * Mengambil snapshot siswa VervalPD dari batch komparasi terakhir.
   * Memastikan data Verval tidak hilang ketika pengguna melakukan komparasi EMIS secara terpisah.
   */
  async getFallbackVervalStudents(): Promise<VervalStudentItem[]> {
    try {
      const lastVervalBatch = await this.prisma.komparasiEmisBatch.findFirst({
        where: {
          OR: [
            { totalVervalOk: { gt: 0 } },
            { totalResiduVerval: { gt: 0 } },
          ],
        },
        orderBy: { executedAt: 'desc' },
        select: { id: true, executedAt: true },
      });

      if (!lastVervalBatch) return [];

      const prevRecords = await this.prisma.komparasiEmis.findMany({
        where: {
          batchId: lastVervalBatch.id,
          statusVerval: { in: ['VERVAL_OK', 'RESIDU_VERVAL'] },
        },
      });

      return prevRecords.map((r: any) => ({
        pesertaDidikId: r.vervalPdId || r.id,
        nik: r.nikEsantri,
        nisn: r.nisnVerval && r.nisnVerval !== '-' ? r.nisnVerval : r.nisnEsantri,
        nama: r.nama,
        tempatLahir: r.tempatLahirEsantri,
        tanggalLahir: r.tanggalLahirEsantri,
        namaIbuKandung: '',
        jenisKelamin: r.jenisKelaminEsantri,
        isResidu: r.statusVerval === 'RESIDU_VERVAL',
        residuDetail: r.residuDetail as any,
        _source_lembaga: 'Snapshot Verval Tersimpan',
      }));
    } catch (err: any) {
      this.logger.error(`Gagal mengambil fallback snapshot Verval: ${err.message}`);
      return [];
    }
  }

  /**
   * INTI ALGORITMA REKONSILIASI & VALIDASI:
   * Membandingkan data riil database eSantri dengan data hasil fetch EMIS & Verval.
   * Tidak ada data di database yang diubah (Murni Read-Only Audit).
   * Mendukung Smart Snapshot Merge (jika salah satu sumber tidak dikirim, otomatis mewarisi snapshot terakhir).
   */
  async reconcileWithDatabase(options: {
    emisStudents?: any[];
    vervalStudents?: VervalStudentItem[];
    cabangId?: string;
    wilayahId?: string;
    executedById?: string;
    catatan?: string;
    resetEmis?: boolean;
    resetVerval?: boolean;
  }): Promise<ReconciliationSummary> {
    const { cabangId, wilayahId } = options;
    let emisStudents = options.emisStudents || [];
    let vervalStudents = options.vervalStudents || [];
    const autoNotes: string[] = [];

    // Auto-Inherit EMIS: Jika data live EMIS tidak dikirim (misal komparasi VervalPD saja), pertahankan dari batch terakhir
    if (emisStudents.length === 0 && !options.resetEmis) {
      const fallbackEmis = await this.getFallbackEmisStudents();
      if (fallbackEmis.length > 0) {
        emisStudents = fallbackEmis;
        autoNotes.push(`Data EMIS dipertahankan dari sesi sebelumnya (${fallbackEmis.length} santri)`);
        this.logger.log(`[Smart-Merge] Otomatis mempertahankan ${fallbackEmis.length} data EMIS dari batch sebelumnya`);
      }
    }

    // Auto-Inherit VervalPD: Jika data live Verval tidak dikirim (misal komparasi EMIS saja), pertahankan dari batch terakhir
    if (vervalStudents.length === 0 && !options.resetVerval) {
      const fallbackVerval = await this.getFallbackVervalStudents();
      if (fallbackVerval.length > 0) {
        vervalStudents = fallbackVerval;
        autoNotes.push(`Data VervalPD dipertahankan dari sesi sebelumnya (${fallbackVerval.length} siswa)`);
        this.logger.log(`[Smart-Merge] Otomatis mempertahankan ${fallbackVerval.length} data VervalPD dari batch sebelumnya`);
      }
    }

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
    // Kunci 1: NIK (Prioritas Tertinggi / Unik Nasional)
    // Kunci 2: NISN
    // Kunci 3: Nama + Tanggal Lahir (sangat presisi)
    // Kunci 4: Nama + Tempat Lahir
    // Kunci 5: Nama + Rombel
    const emisByNik = new Map<string, any>();
    const emisByNisn = new Map<string, any>();
    const emisByNameBirthDate = new Map<string, any>();
    const emisByNameBirthPlace = new Map<string, any>();
    const emisByNameRombel = new Map<string, any>();
    const processedEmisKeys = new Set<string>();

    for (const em of emisStudents) {
      const nik = this.normalizeNik(em.nik || em.list_nik || em.identity_number || em.no_identitas || em.no_kk);
      const nisn = String(em.nisn || em.list_nisn || '').trim();
      const nama = String(em.full_name || em.nama || em.list_full_name || em.list_nama || '').trim();
      const tmptLahir = String(em.birth_place || em.tempat_lahir || em.list_birth_place || '').trim();
      const tglLahir = String(em.birth_date || em.tanggal_lahir || em.list_birth_date || '').trim();

      // Parsing format EMIS: "Kelas 7 - 7-W2060" atau "Kelas 12 - U2352"
      const rawRombelOrTingkat = String(em.tingkat || em.la_study_group_name || em.study_group_name || em.rombel || em.nama_rombel || '').trim();
      const { rombel: parsedRombel, tingkat: parsedTingkat } = this.parseEmisRombel(rawRombelOrTingkat);
      em._parsed_rombel = parsedRombel || rawRombelOrTingkat;
      em._parsed_tingkat = parsedTingkat;

      const keyNameBirthDate = this.createNameBirthDateKey(nama, tglLahir);
      const keyNameBirthPlace = this.createMergeKey(nama, tmptLahir);
      const keyNameRombel = this.createNameRombelKey(nama, em._parsed_rombel);

      if (nik && nik.length >= 10) emisByNik.set(nik, em);
      if (nisn) emisByNisn.set(nisn, em);
      if (keyNameBirthDate) emisByNameBirthDate.set(keyNameBirthDate, em);
      if (keyNameBirthPlace) emisByNameBirthPlace.set(keyNameBirthPlace, em);
      if (keyNameRombel) emisByNameRombel.set(keyNameRombel, em);
    }

    // 3. Buat Lookup Map untuk Verval
    const vervalByNik = new Map<string, VervalStudentItem>();
    const vervalByNisn = new Map<string, VervalStudentItem>();
    const vervalByNameBirthDate = new Map<string, VervalStudentItem>();
    const vervalByNameBirthPlace = new Map<string, VervalStudentItem>();
    const processedVervalKeys = new Set<string>();

    for (const vv of vervalStudents) {
      const nik = this.normalizeNik(vv.nik);
      const nisn = String(vv.nisn || '').trim();
      const nama = String(vv.nama || '').trim();
      const tmpt = String(vv.tempatLahir || '').trim();
      const tgl = String(vv.tanggalLahir || '').trim();
      const keyNameBirthDate = this.createNameBirthDateKey(nama, tgl);
      const keyNameBirthPlace = this.createMergeKey(nama, tmpt);

      if (nik && nik.length >= 10) vervalByNik.set(nik, vv);
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

      const namaEsantri = String(bio.fullName || '').trim();
      const tmptLahirEsantri = String(bio.tempatLahir || '').trim();
      const tglLahirEsantriStr = this.normalizeDate(bio.tanggalLahir);
      const nisnEsantri = String(sf?.nisn || bio.nisn || '').trim();
      const nikEsantriClean = this.normalizeNik(bio.nik);
      const esantriRombel = String(sf?.kelas?.name || '').trim();
      const esantriTingkat = String(sf?.tingkat || sf?.kelas?.tingkat || '').trim();

      const keyNameBirthDate = this.createNameBirthDateKey(namaEsantri, bio.tanggalLahir);
      const keyNameBirthPlace = this.createMergeKey(namaEsantri, tmptLahirEsantri);
      const keyNameRombel = this.createNameRombelKey(namaEsantri, esantriRombel);

      // --- Matching EMIS (Hirarki: NIK -> NISN -> Nama+TglLahir -> Nama+TmptLahir -> Nama+Rombel) ---
      let matchedEmis: any = null;
      let matchMethodEmis = '';
      if (nikEsantriClean && nikEsantriClean.length >= 10 && emisByNik.has(nikEsantriClean)) {
        matchedEmis = emisByNik.get(nikEsantriClean);
        matchMethodEmis = 'NIK';
      } else if (nisnEsantri && emisByNisn.has(nisnEsantri)) {
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

      // --- Matching Verval (Hirarki: NIK -> NISN -> Nama+TglLahir -> Nama+TmptLahir) ---
      let matchedVerval: VervalStudentItem | null = null;
      let matchMethodVerval = '';
      if (nikEsantriClean && nikEsantriClean.length >= 10 && vervalByNik.has(nikEsantriClean)) {
        matchedVerval = vervalByNik.get(nikEsantriClean)!;
        matchMethodVerval = 'NIK';
      } else if (nisnEsantri && vervalByNisn.has(nisnEsantri)) {
        matchedVerval = vervalByNisn.get(nisnEsantri)!;
        matchMethodVerval = 'NISN';
      } else if (keyNameBirthDate && vervalByNameBirthDate.has(keyNameBirthDate)) {
        matchedVerval = vervalByNameBirthDate.get(keyNameBirthDate)!;
        matchMethodVerval = 'NAMA_TGL_LAHIR';
      } else if (keyNameBirthPlace && vervalByNameBirthPlace.has(keyNameBirthPlace)) {
        matchedVerval = vervalByNameBirthPlace.get(keyNameBirthPlace)!;
        matchMethodVerval = 'NAMA_TMPT_LAHIR';
      }

      const discrepancies: string[] = [];
      let statusEmis: 'TERDAFTAR' | 'BELUM_TERDAFTAR' | 'DISKREPANSI' = 'BELUM_TERDAFTAR';
      let statusVerval: 'VERVAL_OK' | 'RESIDU_VERVAL' | 'BELUM_TERDAFTAR' = 'BELUM_TERDAFTAR';
      let butuhTindakan = false;
      const rekomendasiList: string[] = [];

      // Evaluasi EMIS
      if (matchedEmis) {
        if (matchedEmis._emis_id) processedEmisKeys.add(String(matchedEmis._emis_id));
        if (matchedEmis.id) processedEmisKeys.add(String(matchedEmis.id));
        if (nikEsantriClean) processedEmisKeys.add(nikEsantriClean);
        if (keyNameBirthDate) processedEmisKeys.add(keyNameBirthDate);
        if (keyNameBirthPlace) processedEmisKeys.add(keyNameBirthPlace);
        if (keyNameRombel) processedEmisKeys.add(keyNameRombel);

        const emisNik = this.normalizeNik(matchedEmis.nik || matchedEmis.list_nik || matchedEmis.identity_number || matchedEmis.no_identitas || matchedEmis.no_kk);
        if (emisNik) processedEmisKeys.add(emisNik);

        const emisNisn = String(matchedEmis.nisn || matchedEmis.list_nisn || '').trim();
        const emisTgl = this.normalizeDate(matchedEmis.birth_date || matchedEmis.tanggal_lahir);
        const emisRombelName = String(matchedEmis._parsed_rombel || matchedEmis.la_study_group_name || matchedEmis.study_group_name || '').trim();

        if (nikEsantriClean && emisNik && nikEsantriClean !== emisNik) {
          discrepancies.push(`NIK Berbeda: eSantri (${nikEsantriClean}) vs EMIS (${emisNik})`);
          statusEmis = 'DISKREPANSI';
        }

        if (nisnEsantri && emisNisn && nisnEsantri !== emisNisn) {
          discrepancies.push(`NISN Berbeda: eSantri (${nisnEsantri}) vs EMIS (${emisNisn})`);
          statusEmis = 'DISKREPANSI';
        } else if (statusEmis !== 'DISKREPANSI') {
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
        if (matchedVerval.pesertaDidikId) processedVervalKeys.add(String(matchedVerval.pesertaDidikId));
        if (nikEsantriClean) processedVervalKeys.add(nikEsantriClean);
        if (keyNameBirthDate) processedVervalKeys.add(keyNameBirthDate);
        if (keyNameBirthPlace) processedVervalKeys.add(keyNameBirthPlace);

        const vervalNik = this.normalizeNik(matchedVerval.nik);
        if (vervalNik) processedVervalKeys.add(vervalNik);

        if (nikEsantriClean && vervalNik && nikEsantriClean !== vervalNik) {
          discrepancies.push(`NIK Berbeda: eSantri (${nikEsantriClean}) vs Verval (${vervalNik})`);
        }

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
        emisId: matchedEmis?._emis_id || matchedEmis?.id,
        nisnEmis: matchedEmis?.nisn || matchedEmis?.list_nisn || '-',
        rombelEmis: matchedEmis?._parsed_rombel || matchedEmis?.la_study_group_name || matchedEmis?.study_group_name || '-',
        sourceLembagaEmis: matchedEmis?._source_lembaga || matchedEmis?.sourceLembagaEmis || undefined,

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
      const id = String(em._emis_id || em.id || '');
      const key = this.createMergeKey(em.full_name || em.nama || '', em.birth_place || em.tempat_lahir || '');
      if ((id && !processedEmisKeys.has(id)) || (!id && !processedEmisKeys.has(key))) {
        emisOnly.push(em);
      }
    }

    const vervalOnly: any[] = [];
    for (const vv of vervalStudents) {
      const id = String(vv.pesertaDidikId || '');
      const key = this.createMergeKey(vv.nama, vv.tempatLahir);
      if ((id && !processedVervalKeys.has(id)) || (!id && !processedVervalKeys.has(key))) {
        vervalOnly.push(vv);
      }
    }

    // 6. Simpan hasil snapshot komparasi & audit ke database tabel formal.komparasi_emis_batch dan formal.komparasi_emis
    let savedBatchId: string | undefined = undefined;
    let savedExecutedAt: Date = new Date();
    try {
      const batch = await this.prisma.komparasiEmisBatch.create({
        data: {
          executedById: options.executedById || null,
          totalSantriEsantri: dbStudents.length,
          totalTerdaftarEmis,
          totalBelumEmis,
          totalVervalOk,
          totalResiduVerval,
          totalBelumVerval,
          totalDiskrepansi,
          totalButuhTindakan,
          cabangBreakdown: Array.from(cabangStatMap.values()) as any,
          catatan: [options.catatan, ...autoNotes].filter(Boolean).join(' | ') || null,
        },
      });
      savedBatchId = batch.id;
      savedExecutedAt = batch.executedAt;

      // Bulk insert data audit komparasi santri dalam batch 500 baris
      const detailRecords = reconciledList.map((item) => ({
        batchId: batch.id,
        studentId: item.id || null,
        nama: item.nama,
        cabangId: item.cabangId || null,
        cabangName: item.cabangName || null,
        wilayahName: item.wilayahName || null,
        lembagaMuadalahName: item.lembagaMuadalahName || null,
        tingkat: item.tingkat || null,
        kelasName: item.kelasName || null,
        nisnEsantri: item.nisnEsantri || null,
        nikEsantri: item.nikEsantri || null,
        tempatLahirEsantri: item.tempatLahirEsantri || null,
        tanggalLahirEsantri: item.tanggalLahirEsantri || null,
        jenisKelaminEsantri: item.jenisKelaminEsantri || null,
        statusEmis: item.statusEmis,
        emisId: item.emisId ? String(item.emisId) : null,
        nisnEmis: item.nisnEmis || null,
        rombelEmis: item.rombelEmis || null,
        sourceLembagaEmis: item.sourceLembagaEmis || null,
        statusVerval: item.statusVerval,
        vervalPdId: item.vervalPdId ? String(item.vervalPdId) : null,
        nisnVerval: item.nisnVerval || null,
        residuDetail: item.residuDetail ? (item.residuDetail as any) : undefined,
        butuhTindakan: item.butuhTindakan,
        discrepancies: item.discrepancies || [],
        rekomendasiTindakan: item.rekomendasiTindakan || null,
      }));

      const CHUNK_SIZE = 500;
      for (let i = 0; i < detailRecords.length; i += CHUNK_SIZE) {
        const chunk = detailRecords.slice(i, i + CHUNK_SIZE);
        await this.prisma.komparasiEmis.createMany({
          data: chunk,
        });
      }
      this.logger.log(`Berhasil menyimpan hasil komparasi ke database (Batch ID: ${batch.id}, ${detailRecords.length} records)`);
    } catch (saveErr: any) {
      this.logger.error(`Gagal menyimpan hasil komparasi ke database: ${saveErr.message}`, saveErr.stack);
    }

    return {
      batchId: savedBatchId,
      executedAt: savedExecutedAt,
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

  /**
   * Mengambil hasil audit & komparasi paling akhir yang tersimpan di database
   */
  async getLatestReconcile(cabangId?: string, wilayahId?: string): Promise<ReconciliationSummary | null> {
    const latestBatch = await this.prisma.komparasiEmisBatch.findFirst({
      orderBy: { executedAt: 'desc' },
    });

    if (!latestBatch) return null;

    const whereDetail: any = { batchId: latestBatch.id };
    if (cabangId && cabangId !== 'ALL') {
      whereDetail.cabangId = cabangId;
    } else if (wilayahId && wilayahId !== 'ALL') {
      const cabangsInWilayah = await this.prisma.cabang.findMany({
        where: { wilayahId },
        select: { id: true },
      });
      const cabangIds = cabangsInWilayah.map((c: any) => c.id);
      whereDetail.cabangId = { in: cabangIds };
    }

    const details = await this.prisma.komparasiEmis.findMany({
      where: whereDetail,
      orderBy: [{ cabangName: 'asc' }, { nama: 'asc' }],
    });

    const mappedStudents: ReconciledStudentItem[] = details.map((d: any) => ({
      id: d.studentId || d.id,
      nama: d.nama,
      cabangId: d.cabangId || undefined,
      cabangName: d.cabangName || '-',
      wilayahName: d.wilayahName || '-',
      lembagaMuadalahName: d.lembagaMuadalahName || '-',
      tingkat: d.tingkat || '-',
      kelasName: d.kelasName || '-',
      nisnEsantri: d.nisnEsantri || '-',
      nikEsantri: d.nikEsantri || '-',
      tempatLahirEsantri: d.tempatLahirEsantri || '-',
      tanggalLahirEsantri: d.tanggalLahirEsantri || '-',
      jenisKelaminEsantri: d.jenisKelaminEsantri || '-',
      statusEmis: d.statusEmis as any,
      emisId: d.emisId || undefined,
      nisnEmis: d.nisnEmis || '-',
      rombelEmis: d.rombelEmis || '-',
      sourceLembagaEmis: d.sourceLembagaEmis || undefined,
      statusVerval: d.statusVerval as any,
      vervalPdId: d.vervalPdId || undefined,
      nisnVerval: d.nisnVerval || '-',
      residuDetail: d.residuDetail as any,
      butuhTindakan: d.butuhTindakan,
      discrepancies: d.discrepancies || [],
      rekomendasiTindakan: d.rekomendasiTindakan || '-',
    }));

    const isFiltered = Boolean((cabangId && cabangId !== 'ALL') || (wilayahId && wilayahId !== 'ALL'));

    const totalSantriEsantri = isFiltered ? details.length : latestBatch.totalSantriEsantri;
    const totalTerdaftarEmis = isFiltered ? details.filter((d: any) => d.statusEmis === 'TERDAFTAR').length : latestBatch.totalTerdaftarEmis;
    const totalBelumEmis = isFiltered ? details.filter((d: any) => d.statusEmis === 'BELUM_TERDAFTAR').length : latestBatch.totalBelumEmis;
    const totalVervalOk = isFiltered ? details.filter((d: any) => d.statusVerval === 'VERVAL_OK').length : latestBatch.totalVervalOk;
    const totalResiduVerval = isFiltered ? details.filter((d: any) => d.statusVerval === 'RESIDU_VERVAL').length : latestBatch.totalResiduVerval;
    const totalBelumVerval = isFiltered ? details.filter((d: any) => d.statusVerval === 'BELUM_TERDAFTAR').length : latestBatch.totalBelumVerval;
    const totalDiskrepansi = isFiltered ? details.filter((d: any) => d.discrepancies && d.discrepancies.length > 0).length : latestBatch.totalDiskrepansi;
    const totalButuhTindakan = isFiltered ? details.filter((d: any) => d.butuhTindakan).length : latestBatch.totalButuhTindakan;

    return {
      batchId: latestBatch.id,
      executedAt: latestBatch.executedAt,
      totalSantriEsantri,
      totalTerdaftarEmis,
      totalBelumEmis,
      totalVervalOk,
      totalResiduVerval,
      totalBelumVerval,
      totalDiskrepansi,
      totalButuhTindakan,
      cabangBreakdown: (latestBatch.cabangBreakdown as any) || [],
      students: mappedStudents,
      unmatchedExternal: { emisOnly: [], vervalOnly: [] },
    };
  }

  /**
   * Mengambil daftar riwayat batch audit komparasi lampau
   */
  async getReconcileHistory(limit = 10) {
    return this.prisma.komparasiEmisBatch.findMany({
      orderBy: { executedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        executedAt: true,
        executedById: true,
        totalSantriEsantri: true,
        totalTerdaftarEmis: true,
        totalBelumEmis: true,
        totalVervalOk: true,
        totalResiduVerval: true,
        totalBelumVerval: true,
        totalDiskrepansi: true,
        totalButuhTindakan: true,
        catatan: true,
      },
    });
  }

  /**
   * Mengambil detail komparasi dari batch ID tertentu
   */
  async getReconcileBatchDetail(batchId: string, cabangId?: string, wilayahId?: string): Promise<ReconciliationSummary | null> {
    const batch = await this.prisma.komparasiEmisBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) return null;

    const whereDetail: any = { batchId: batch.id };
    if (cabangId && cabangId !== 'ALL') {
      whereDetail.cabangId = cabangId;
    } else if (wilayahId && wilayahId !== 'ALL') {
      const cabangsInWilayah = await this.prisma.cabang.findMany({
        where: { wilayahId },
        select: { id: true },
      });
      const cabangIds = cabangsInWilayah.map((c: any) => c.id);
      whereDetail.cabangId = { in: cabangIds };
    }

    const details = await this.prisma.komparasiEmis.findMany({
      where: whereDetail,
      orderBy: [{ cabangName: 'asc' }, { nama: 'asc' }],
    });

    const mappedStudents: ReconciledStudentItem[] = details.map((d: any) => ({
      id: d.studentId || d.id,
      nama: d.nama,
      cabangId: d.cabangId || undefined,
      cabangName: d.cabangName || '-',
      wilayahName: d.wilayahName || '-',
      lembagaMuadalahName: d.lembagaMuadalahName || '-',
      tingkat: d.tingkat || '-',
      kelasName: d.kelasName || '-',
      nisnEsantri: d.nisnEsantri || '-',
      nikEsantri: d.nikEsantri || '-',
      tempatLahirEsantri: d.tempatLahirEsantri || '-',
      tanggalLahirEsantri: d.tanggalLahirEsantri || '-',
      jenisKelaminEsantri: d.jenisKelaminEsantri || '-',
      statusEmis: d.statusEmis as any,
      emisId: d.emisId || undefined,
      nisnEmis: d.nisnEmis || '-',
      rombelEmis: d.rombelEmis || '-',
      sourceLembagaEmis: d.sourceLembagaEmis || undefined,
      statusVerval: d.statusVerval as any,
      vervalPdId: d.vervalPdId || undefined,
      nisnVerval: d.nisnVerval || '-',
      residuDetail: d.residuDetail as any,
      butuhTindakan: d.butuhTindakan,
      discrepancies: d.discrepancies || [],
      rekomendasiTindakan: d.rekomendasiTindakan || '-',
    }));

    const isFiltered = Boolean((cabangId && cabangId !== 'ALL') || (wilayahId && wilayahId !== 'ALL'));

    const totalSantriEsantri = isFiltered ? details.length : batch.totalSantriEsantri;
    const totalTerdaftarEmis = isFiltered ? details.filter((d: any) => d.statusEmis === 'TERDAFTAR').length : batch.totalTerdaftarEmis;
    const totalBelumEmis = isFiltered ? details.filter((d: any) => d.statusEmis === 'BELUM_TERDAFTAR').length : batch.totalBelumEmis;
    const totalVervalOk = isFiltered ? details.filter((d: any) => d.statusVerval === 'VERVAL_OK').length : batch.totalVervalOk;
    const totalResiduVerval = isFiltered ? details.filter((d: any) => d.statusVerval === 'RESIDU_VERVAL').length : batch.totalResiduVerval;
    const totalBelumVerval = isFiltered ? details.filter((d: any) => d.statusVerval === 'BELUM_TERDAFTAR').length : batch.totalBelumVerval;
    const totalDiskrepansi = isFiltered ? details.filter((d: any) => d.discrepancies && d.discrepancies.length > 0).length : batch.totalDiskrepansi;
    const totalButuhTindakan = isFiltered ? details.filter((d: any) => d.butuhTindakan).length : batch.totalButuhTindakan;

    return {
      batchId: batch.id,
      executedAt: batch.executedAt,
      totalSantriEsantri,
      totalTerdaftarEmis,
      totalBelumEmis,
      totalVervalOk,
      totalResiduVerval,
      totalBelumVerval,
      totalDiskrepansi,
      totalButuhTindakan,
      cabangBreakdown: (batch.cabangBreakdown as any) || [],
      students: mappedStudents,
      unmatchedExternal: { emisOnly: [], vervalOnly: [] },
    };
  }
}
