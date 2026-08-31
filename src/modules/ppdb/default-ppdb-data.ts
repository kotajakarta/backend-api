export interface PpdbStructuredData {
  jenjangPendidikan: {
    wustha: { title: string; gender: string; description: string };
    ulya: { title: string; gender: string; description: string };
  };
  programUnggulan: string[];
  fasilitasUnggulan: string[];
  syarat: {
    umum: string[];
    khusus: {
      wustha: {
        title: string;
        targetGender: string;
        items: string[];
      };
      ulya: {
        title: string;
        targetGender: string;
        items: string[];
      };
    };
  };
  timelinePendidikan: {
    wusthaPutra: {
      title: string;
      totalTahun: string;
      steps: { periode: string; durasi: string; target: string }[];
    };
    ulyaPutra: {
      title: string;
      totalTahun: string;
      steps: { periode: string; durasi: string; target: string }[];
    };
    wusthaPutri: {
      title: string;
      totalTahun: string;
      steps: { periode: string; durasi: string; target: string }[];
    };
  };
  alurPendaftaran: {
    no: number;
    tahapan: string;
    jadwal: string;
    catatan?: string;
  }[];
  biaya: {
    items: {
      nama: string;
      jadetabek: number;
      luarJadetabek: number;
    }[];
    total: {
      jadetabek: number;
      luarJadetabek: number;
    };
    sppBulanan: {
      jadetabek: number;
      luarJadetabek: number;
    };
  };
  kontakWilayah: {
    wilayah: string;
    kontakPutra: string;
    waPutra?: string;
    kontakPutri: string;
    waPutri?: string;
  }[];
}

export interface PpdbFullConfig {
  tahunAjaran: string;
  semboyan: string;
  portalUrl: string;
  websiteResmi: string;
  isActive: boolean;
  data: PpdbStructuredData;
}

export const DEFAULT_PPDB_CONFIG: PpdbFullConfig = {
  tahunAjaran: '2027–2028',
  semboyan: 'Dari Indonesia, Untuk Indonesia — Mendidik Generasi yang Mengabdi untuk Negeri',
  portalUrl: 'https://pendaftaran.tahfidzsulaimaniyah.org/',
  websiteResmi: 'www.tahfidzsulaimaniyah.org',
  isActive: true,
  data: {
    jenjangPendidikan: {
      wustha: {
        title: 'Jenjang Wustha / SMP',
        gender: 'Putra & Putri',
        description: 'Pendidikan tingkat menengah pertama berbasis integrasi kurikulum kepesantrenan dan tahfidzul Qur\'an metode Utsmani.',
      },
      ulya: {
        title: 'Jenjang Ulya / SMA',
        gender: 'Khusus Putra',
        description: 'Pendidikan tingkat menengah atas untuk pembentukan kader tahfidz, tafaqquh fiddin, dan persiapan beasiswa ke Turki.',
      },
    },
    programUnggulan: [
      'Metode Tahfidz Utsmani',
      'Tafaqquh Fiddin Kitab Kuning',
      'Pendidikan Karakter & Akhlaq',
      'Pendidikan Formal Muadalah',
    ],
    fasilitasUnggulan: [
      'Lingkungan asri dan nyaman',
      'Ruangan asrama & kelas ber-AC',
      'Tenaga pengajar profesional dari dalam & luar negeri',
      'Makan bergizi 3 kali sehari',
      'Mushalla, Perpustakaan, Ruang Tamu, Kamar Tidur, Ruang Belajar, dan Ruang Makan representatif',
    ],
    syarat: {
      umum: [
        'Berakhlak baik, berdisiplin tinggi, dan tidak merokok.',
        'Bersedia mengikuti pendidikan di Indonesia dan Turki hingga selesai bagi penerima beasiswa.',
        'Bersedia ditempatkan di cabang Yayasan Tahfidz Sulaimaniyah sesuai ketentuan yayasan.',
        'Sehat jasmani dan rohani.',
        'Lancar membaca Al-Qur\'an dengan tajwid yang baik (khusus jenjang SMA).',
      ],
      khusus: {
        wustha: {
          title: 'Jenjang Wustha / SMP (Putra & Putri)',
          targetGender: 'Putra & Putri',
          items: [
            'Lulus SD/MI/sederajat pada Agustus 2027.',
            'Usia maksimal 13 tahun per 1 Agustus 2027.',
            'Hafal Surah Ad-Duha s.d. An-Nas.',
          ],
        },
        ulya: {
          title: 'Jenjang Ulya / SMA (Khusus Putra)',
          targetGender: 'Khusus Putra',
          items: [
            'Lulus SMP/MTs/sederajat pada Agustus 2027.',
            'Usia maksimal 16 tahun per 1 Agustus 2027.',
            'Hafal Surah An-Naba s.d. An-Nas.',
          ],
        },
      },
    },
    timelinePendidikan: {
      wusthaPutra: {
        title: 'Jenjang Wustha / SMP - Putra',
        totalTahun: 'Total 6 Tahun',
        steps: [
          { periode: 'Tahun ke-1 (Kelas 7 Sem 1) s.d. Tahun ke-2 (Kelas 8 Sem 1)', durasi: '1,5 Tahun', target: 'Pra-Tahfidz & Pembiasaan Adab' },
          { periode: 'Tahun ke-2 (Kelas 8 Sem 2) s.d. Tahun ke-4 (Kelas 10 Sem 1)', durasi: '2 Tahun', target: 'Tahfidzul Qur\'an 30 Juz' },
          { periode: 'Tahun ke-4 (Kelas 10 Sem 2)', durasi: '6 Bulan', target: 'Pra-Tadris (Persiapan Pengajaran)' },
          { periode: 'Tahun ke-5 (Kelas 11 Sem 1-2)', durasi: '1 Tahun', target: 'Ibtidai (Studi Kitab Dasar)' },
          { periode: 'Tahun ke-6 (Kelas 12 Sem 1-2)', durasi: '1 Tahun', target: 'Ihzari (Pematangan Keilmuan & Pengabdian)' },
        ],
      },
      ulyaPutra: {
        title: 'Jenjang Ulya / SMA - Putra',
        totalTahun: 'Total 5 Tahun',
        steps: [
          { periode: 'Tahun ke-1 (Kelas 10)', durasi: '1 Tahun', target: 'Pra-Tahfidz' },
          { periode: 'Tahun ke-2 (Kelas 11) s.d. Tahun ke-3 (Kelas 12)', durasi: '2 Tahun', target: 'Tahfidzul Qur\'an 30 Juz' },
          { periode: 'Tahun ke-4 (Sesudah Lulus Sekolah Formal)', durasi: '1 Tahun', target: '6 Bulan Ulang Hafalan + 6 Bulan Pra-Tadris' },
          { periode: 'Tahun ke-5', durasi: '1 Tahun', target: 'Ibtidai (Studi Kitab Lanjutan)' },
        ],
      },
      wusthaPutri: {
        title: 'Jenjang Wustha / SMP - Putri',
        totalTahun: 'Total 6 Tahun',
        steps: [
          { periode: 'Tahun ke-1 (Kelas 7) s.d. Tahun ke-2 (Kelas 8 Sem 1)', durasi: '1,5 Tahun', target: 'Pra-Tahfidz' },
          { periode: 'Tahun ke-2 (Kelas 8 Sem 2) s.d. Tahun ke-5 (Kelas 11 Sem 1)', durasi: '3 Tahun', target: 'Tahfidz & Ibtidai' },
          { periode: 'Tahun ke-5 (Kelas 11 Sem 2)', durasi: '6 Bulan', target: 'Hataman Kubro' },
          { periode: 'Tahun ke-6 (Kelas 12)', durasi: '1 Tahun', target: 'Ihzari' },
        ],
      },
    },
    alurPendaftaran: [
      { no: 1, tahapan: 'Pendaftaran Online & Pengumpulan Berkas', jadwal: '.... s.d 12 Desember 2026', catatan: 'Pengisian biodata & unggah dokumen di portal resmi' },
      { no: 2, tahapan: 'Ujian Tahap 1', jadwal: '12 Desember 2026', catatan: 'Ujian seleksi akademik dan kelancaran membaca Al-Qur\'an' },
      { no: 3, tahapan: 'Ujian Tahap 2', jadwal: '24–26 Desember 2026', catatan: 'Wawancara calon santri dan orang tua / wali santri' },
      { no: 4, tahapan: 'Pengumuman Hasil Seleksi', jadwal: 'Januari 2027', catatan: 'Pengumuman resmi via portal dan WhatsApp' },
      { no: 5, tahapan: 'Masuk Pesantren', jadwal: '12 Juli 2027', catatan: 'Orientasi santri baru di asrama masing-masing' },
    ],
    biaya: {
      items: [
        { nama: 'Infaq Masuk', jadetabek: 8000000, luarJadetabek: 5000000 },
        { nama: 'Infaq Bangunan', jadetabek: 3000000, luarJadetabek: 2000000 },
        { nama: 'Infaq Buku Pelajaran', jadetabek: 2000000, luarJadetabek: 2000000 },
        { nama: 'Infaq Seragam', jadetabek: 2000000, luarJadetabek: 2000000 },
      ],
      total: {
        jadetabek: 15000000,
        luarJadetabek: 11000000,
      },
      sppBulanan: {
        jadetabek: 1500000,
        luarJadetabek: 1250000,
      },
    },
    kontakWilayah: [
      {
        wilayah: 'Jakarta & Kalimantan',
        kontakPutra: '+62 821-1299-8521',
        waPutra: '6282112998521',
        kontakPutri: '+62 859-4741-1216',
        waPutri: '6285947411216',
      },
      {
        wilayah: 'Banten',
        kontakPutra: '+62 821-1365-719',
        waPutra: '628211365719',
        kontakPutri: '+62 822-6072-9598',
        waPutri: '6282260729598',
      },
      {
        wilayah: 'Jawa Barat, Bali, NTB, Makassar',
        kontakPutra: '+62 822-1319-9083',
        waPutra: '6282213199083',
        kontakPutri: '+62 858-1175-2654',
        waPutri: '6285811752654',
      },
      {
        wilayah: 'Jawa Tengah',
        kontakPutra: '+62 811-2919-120',
        waPutra: '628112919120',
        kontakPutri: '—',
        waPutri: '',
      },
      {
        wilayah: 'Jawa Timur',
        kontakPutra: '+62 815-5307-6512',
        waPutra: '6281553076512',
        kontakPutri: '+62 811-3692-017',
        waPutri: '628113692017',
      },
      {
        wilayah: 'Sumatera Selatan, Jambi, Bengkulu, Lampung',
        kontakPutra: '+62 899-0210-855',
        waPutra: '628990210855',
        kontakPutri: '+62 822-1074-1839',
        waPutri: '6282210741839',
      },
      {
        wilayah: 'Aceh, Sumatera Utara, Sumatera Barat, Riau',
        kontakPutra: '+62 813-7503-3715',
        waPutra: '6281375033715',
        kontakPutri: '+62 813-9672-5334',
        waPutri: '6281396725334',
      },
    ],
  },
};
