import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';

export interface VervalStudentItem {
  pesertaDidikId: string;
  nik: string;
  nisn: string;
  nama: string;
  tempatLahir: string;
  tanggalLahir: string;
  namaIbuKandung: string;
  jenisKelamin: string;
  tingkatPendidikan?: string;
  isResidu?: boolean;
  residuDetail?: Record<string, string>;
  _source_lembaga?: string;
}

@Injectable()
export class VervalService {
  private readonly logger = new Logger(VervalService.name);

  private cleanCell(v: any): string {
    if (typeof v !== 'string') return String(v || '');
    const titleMatch = v.match(/title="([^"]*)"/);
    let val = titleMatch ? titleMatch[1] : v;
    val = val.replace(/<[^>]*>?/gm, '').trim();
    if (!val || ['""', '"""', '""""', '"'].includes(val)) {
      return 'Cek Kembali';
    }
    return val;
  }

  private cleanQuotes(str: string): string {
    return (str || '').replace(/^['"]|['"]$/g, '').trim();
  }

  /**
   * Mengambil data siswa dari VervalPD menggunakan Cookie sesi browser
   */
  async fetchDaftarSiswa(cookie: string, limit = 8000): Promise<VervalStudentItem[]> {
    if (!cookie || cookie.trim() === '') {
      throw new HttpException('Cookie sesi VervalPD tidak boleh kosong', HttpStatus.BAD_REQUEST);
    }

    const cleanCookie = cookie.trim();
    const url = `https://vervalpd.data.kemendikdasmen.go.id/index.php/Csekolah/json_data_siswa?sekolah_id=&search=&sort=&order=&offset=0&limit=${limit}`;

    try {
      this.logger.log('Mengambil daftar siswa dari API VervalPD Kemendikbud...');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': cleanCookie,
          'Referer': 'https://vervalpd.data.kemendikdasmen.go.id/index.php/Csekolah/data_siswa',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new HttpException('Sesi cookie VervalPD telah kedaluwarsa atau tidak valid. Silakan perbarui cookie.', HttpStatus.UNAUTHORIZED);
        }
        throw new HttpException(`HTTP ${response.status} dari VervalPD`, HttpStatus.BAD_GATEWAY);
      }

      const data: any = await response.json();
      const rawRows = data?.rows || [];
      return rawRows.map((r: any) => {
        let pdId = r.peserta_didik_id || '';
        const idMatch = typeof pdId === 'string' ? pdId.match(/id=([A-Z0-9-]+)/i) : null;
        if (idMatch) pdId = idMatch[1];

        return {
          pesertaDidikId: pdId,
          nik: this.cleanQuotes(r.nik),
          nisn: this.cleanQuotes(r.nisn),
          nama: (r.nama || '').trim(),
          tempatLahir: (r.tempat_lahir || '').trim(),
          tanggalLahir: (r.tanggal_lahir || '').trim(),
          namaIbuKandung: (r.nama_ibu_kandung || '').trim(),
          jenisKelamin: (r.jenis_kelamin || '').trim(),
          tingkatPendidikan: (r.tingkat_pendidikan || '').trim(),
          isResidu: false,
        };
      });
    } catch (err: any) {
      this.logger.error(`Gagal fetch VervalPD: ${err.message}`);
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new HttpException('Sesi cookie VervalPD telah kedaluwarsa atau tidak valid. Silakan perbarui cookie.', HttpStatus.UNAUTHORIZED);
      }
      throw new HttpException(`Gagal menghubungi VervalPD: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Mengambil data residu siswa dari VervalPD
   */
  async fetchResiduSiswa(cookie: string, limit = 1000): Promise<VervalStudentItem[]> {
    if (!cookie || cookie.trim() === '') {
      throw new HttpException('Cookie sesi VervalPD tidak boleh kosong', HttpStatus.BAD_REQUEST);
    }

    const cleanCookie = cookie.trim();
    const url = `https://vervalpd.data.kemendikdasmen.go.id/index.php/Csekolah/json_residu?sekolah_id=&search=&sort=&order=&offset=0&limit=${limit}`;

    try {
      this.logger.log('Mengambil daftar residu siswa dari API VervalPD Kemendikbud...');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Cookie': cleanCookie,
          'Referer': 'https://vervalpd.data.kemendikdasmen.go.id/index.php/Csekolah/data_residu',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new HttpException(`HTTP ${response.status} dari VervalPD`, HttpStatus.BAD_GATEWAY);
      }

      const data: any = await response.json();
      const rawRows = data?.rows || [];
      const qcMap: Record<string, string> = {
        qc_1: 'rombel_sekolah',
        qc_2: 'nisn',
        qc_3: 'nama',
        qc_4: 'tempat_lahir',
        qc_5: 'tanggal_lahir',
        qc_6: 'ibu_kandung',
        qc_7: 'jenis_kelamin',
        qc_8: 'nik_dukcapil',
        qc_11: 'desa_kelurahan',
        qc_12: 'nik_ganda',
      };

      return rawRows.map((r: any) => {
        let pdId = r.peserta_didik_id || '';
        const idMatch = typeof pdId === 'string' ? pdId.match(/id=([A-Z0-9-]+)/i) : null;
        if (idMatch) pdId = idMatch[1];

        const residuDetail: Record<string, string> = {};
        for (const [qcKey, label] of Object.entries(qcMap)) {
          if (r[qcKey]) {
            residuDetail[label] = this.cleanCell(r[qcKey]);
          }
        }

        return {
          pesertaDidikId: pdId,
          nik: this.cleanQuotes(r.nik),
          nisn: this.cleanQuotes(r.nisn),
          nama: (r.nama || '').trim(),
          tempatLahir: (r.tempat_lahir || '').trim(),
          tanggalLahir: (r.tanggal_lahir || '').trim(),
          namaIbuKandung: (r.nama_ibu_kandung || '').trim(),
          jenisKelamin: (r.jenis_kelamin || '').trim(),
          tingkatPendidikan: (r.tingkat_pendidikan || '').trim(),
          isResidu: true,
          residuDetail,
        };
      });
    } catch (err: any) {
      this.logger.error(`Gagal fetch residu VervalPD: ${err.message}`);
      throw new HttpException(`Gagal menghubungi VervalPD: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
