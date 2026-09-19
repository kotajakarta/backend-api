import { Injectable } from '@nestjs/common';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  HeightRule,
} from 'docx';

export interface SpTemplateData {
  nomorSp?: string;
  tingkatSp?: string;
  namaSiswa?: string;
  nis?: string;
  kelas?: string;
  cabang?: string;
  tanggalTerbit?: string;
  berlakuHingga?: string;
  poinAkumulasi?: number;
  alasan?: string;
  tindakanPembinaan?: string;
}

export interface PengeluaranTemplateData {
  nomorSk?: string;
  namaSiswa?: string;
  nis?: string;
  kelas?: string;
  cabang?: string;
  tanggalKeluar?: string;
  tanggalSk?: string;
  alasanPemberhentian?: string;
  kategoriAlasan?: string;
  pejabatTtd?: string;
}

@Injectable()
export class IndisiplinerTemplateService {
  /**
   * Helper membuat kop surat standar pesantren
   */
  private createKopSurat(lembagaName = 'PONDOK PESANTREN & PUSAT DATA PENDIDIKAN') {
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: 'YAYASAN PENDIDIKAN DAN SOSIAL ISLAM',
            font: 'Times New Roman',
            size: 22,
            bold: true,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: lembagaName.toUpperCase(),
            font: 'Times New Roman',
            size: 26,
            bold: true,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: 'BAGIAN KETERTIBAN, PENGASUHAN DAN KEDISIPLINAN SANTRI (KDS)',
            font: 'Times New Roman',
            size: 20,
            bold: true,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        border: {
          bottom: {
            color: '000000',
            space: 1,
            style: BorderStyle.DOUBLE,
            size: 24,
          },
        },
        children: [
          new TextRun({
            text: 'Sekretariat: Kompleks Pondok Pesantren • Email: pusdatin@pesantren.sch.id • Web: pusdatin.sch.id',
            font: 'Times New Roman',
            size: 16,
            italics: true,
          }),
        ],
      }),
    ];
  }

  /**
   * Helper membuat baris identitas santri dalam tabel 2 kolom (label - nilai)
   */
  private createIdentitasRow(label: string, value: string) {
    const noBorder = {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          borders: noBorder,
          children: [
            new Paragraph({
              spacing: { after: 60, before: 60 },
              children: [
                new TextRun({
                  text: label,
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 4, type: WidthType.PERCENTAGE },
          borders: noBorder,
          children: [
            new Paragraph({
              spacing: { after: 60, before: 60 },
              children: [
                new TextRun({
                  text: ':',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: 68, type: WidthType.PERCENTAGE },
          borders: noBorder,
          children: [
            new Paragraph({
              spacing: { after: 60, before: 60 },
              children: [
                new TextRun({
                  text: value,
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  /**
   * Menghasilkan Template DOCX Surat Peringatan (SP 1, SP 2, SP 3)
   */
  async generateSpDocx(data?: SpTemplateData): Promise<Buffer> {
    const rawTingkat = (data?.tingkatSp || 'SP 1').toUpperCase();
    const isSp3 = rawTingkat.includes('3') || rawTingkat.includes('III');
    const isSp2 = rawTingkat.includes('2') || rawTingkat.includes('II');

    const romawi = isSp3 ? 'III' : isSp2 ? 'II' : 'I';
    const judulSp = isSp3
      ? 'SURAT PERINGATAN KETIGA (TERAKHIR)'
      : isSp2
      ? 'SURAT PERINGATAN KEDUA (SP - II)'
      : 'SURAT PERINGATAN PERTAMA (SP - I)';

    const nomorSp = data?.nomorSp || `.../SP-${romawi}/KDS-YTS/${new Date().getFullYear()}`;
    const namaSiswa = data?.namaSiswa || '[ NAMA LENGKAP SANTRI ]';
    const nis = data?.nis || '[ NOMOR INDUK SANTRI / NISN ]';
    const kelas = data?.kelas || '[ KELAS / ROMBEL ]';
    const cabang = data?.cabang || '[ NAMA CABANG / PESANTREN ]';
    const tanggalTerbit = data?.tanggalTerbit || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const berlakuHingga = data?.berlakuHingga || '........................ 2026';
    const poinAkumulasi = data?.poinAkumulasi !== undefined ? `${data.poinAkumulasi} Poin` : '[ ... ] Poin';
    const alasan = data?.alasan || '[ Uraikan akumulasi catatan pelanggaran tata tertib dan disiplin yang telah dilakukan santri ]';

    const konsekuensiText = isSp3
      ? 'Apabila sampai batas waktu yang ditentukan santri bersangkutan kembali melakukan pelanggaran disiplin dalam bentuk apapun, maka pihak lembaga akan langsung menerbitkan SURAT KEPUTUSAN PENGELUARAN (DROP OUT) dan mengembalikan santri seutuhnya kepada orang tua / wali.'
      : isSp2
      ? 'Apabila selama masa pembinaan santri yang bersangkutan tidak menunjukkan perubahan perilaku positif atau mengulangi pelanggaran tata tertib, maka pihak lembaga akan menaikkan status menjadi SURAT PERINGATAN KETIGA / TERAKHIR (SP - III).'
      : 'Apabila santri yang bersangkutan tidak mengindahkan peringatan ini atau mengulangi pelanggaran yang sama, maka pihak lembaga akan menerbitkan SURAT PERINGATAN KEDUA (SP - II).';

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch
                bottom: 1440,
                left: 1440,
                right: 1440,
              },
            },
          },
          children: [
            ...this.createKopSurat(cabang !== '[ NAMA CABANG / PESANTREN ]' ? cabang : undefined),

            // Judul Surat & Nomor
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 200, after: 40 },
              children: [
                new TextRun({
                  text: judulSp,
                  font: 'Times New Roman',
                  size: 26,
                  bold: true,
                  underline: {},
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 240 },
              children: [
                new TextRun({
                  text: `Nomor: ${nomorSp}`,
                  font: 'Times New Roman',
                  size: 20,
                  bold: true,
                }),
              ],
            }),

            // Pembuka
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: 'Berdasarkan catatan Bagian Ketertiban dan Kedisiplinan Santri serta evaluasi berkala mengenai penegakan Tata Tertib Pondok Pesantren, dengan ini memberikan Surat Peringatan kepada:',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Tabel Data Santri
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                this.createIdentitasRow('Nama Lengkap', namaSiswa),
                this.createIdentitasRow('Nomor Induk (NIS)', nis),
                this.createIdentitasRow('Kelas / Tingkat', kelas),
                this.createIdentitasRow('Lembaga / Cabang', cabang),
                this.createIdentitasRow('Akumulasi Poin', poinAkumulasi),
              ],
            }),

            // Alasan Penerbitan
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { before: 160, after: 80 },
              children: [
                new TextRun({
                  text: 'Peringatan ini diterbitkan atas dasar pertimbangan pelanggaran tata tertib sebagai berikut:',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 140 },
              indent: { left: 400 },
              children: [
                new TextRun({
                  text: `"${alasan}"`,
                  font: 'Times New Roman',
                  size: 22,
                  italics: true,
                }),
              ],
            }),

            // Ketetapan & Masa Berlaku
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: `Sehubungan dengan hal tersebut di atas, santri yang bersangkutan diwajibkan menjalani masa pembinaan intensif kedisiplinan sampai dengan tanggal `,
                  font: 'Times New Roman',
                  size: 22,
                }),
                new TextRun({
                  text: berlakuHingga,
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: '. ',
                  font: 'Times New Roman',
                  size: 22,
                }),
                new TextRun({
                  text: konsekuensiText,
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Penutup
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 280 },
              children: [
                new TextRun({
                  text: 'Demikian Surat Peringatan ini dibuat agar menjadi perhatian serius dan introspeksi bagi santri yang bersangkutan serta keluarga / wali santri demi kebaikan dan keberlangsungan proses pendidikan di lembaga ini.',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Tanggal & Tanda Tangan
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 160 },
              children: [
                new TextRun({
                  text: `Diterbitkan pada: ${tanggalTerbit}`,
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Tabel Tanda Tangan (3 Kolom)
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 33, type: WidthType.PERCENTAGE },
                      borders: {
                        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: 'Santri Bersangkutan,', font: 'Times New Roman', size: 20 })],
                        }),
                        new Paragraph({ text: '', spacing: { after: 800 } }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: `( ${namaSiswa} )`, font: 'Times New Roman', size: 20, bold: true })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 34, type: WidthType.PERCENTAGE },
                      borders: {
                        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: 'Mengetahui Orang Tua / Wali,', font: 'Times New Roman', size: 20 })],
                        }),
                        new Paragraph({ text: '', spacing: { after: 800 } }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: '( ........................................ )', font: 'Times New Roman', size: 20, bold: true })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 33, type: WidthType.PERCENTAGE },
                      borders: {
                        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: 'Bagian Ketertiban & Disiplin,', font: 'Times New Roman', size: 20 })],
                        }),
                        new Paragraph({ text: '', spacing: { after: 800 } }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: '( Ust. Petugas Disiplin )', font: 'Times New Roman', size: 20, bold: true })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            // Tembusan
            new Paragraph({
              spacing: { before: 240, after: 40 },
              children: [
                new TextRun({
                  text: 'Tembusan:',
                  font: 'Times New Roman',
                  size: 18,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({
              spacing: { after: 20 },
              indent: { left: 240 },
              children: [
                new TextRun({
                  text: '1. Pimpinan / Mudir Pondok Pesantren\n2. Kepala Lembaga Satuan Pendidikan (Muadalah / Formal)\n3. Wali Kelas yang bersangkutan\n4. Arsip Kedisiplinan Santri',
                  font: 'Times New Roman',
                  size: 18,
                }),
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  /**
   * Menghasilkan Template DOCX Surat Keputusan Pengeluaran Santri (SK DO)
   */
  async generatePengeluaranDocx(data?: PengeluaranTemplateData): Promise<Buffer> {
    const nomorSk = data?.nomorSk || `.../SK-DO/PST-YTS/${new Date().getFullYear()}`;
    const namaSiswa = data?.namaSiswa || '[ NAMA LENGKAP SANTRI ]';
    const nis = data?.nis || '[ NOMOR INDUK SANTRI / NISN ]';
    const kelas = data?.kelas || '[ KELAS / ROMBEL ]';
    const cabang = data?.cabang || '[ NAMA CABANG / PESANTREN ]';
    const tanggalKeluar = data?.tanggalKeluar || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const tanggalSk = data?.tanggalSk || tanggalKeluar;
    const alasanPemberhentian = data?.alasanPemberhentian || '[ Uraikan pertimbangan pelanggaran berat atau akumulasi poin yang mendasari keputusan pengeluaran ]';
    const kategoriAlasan = data?.kategoriAlasan || 'Keputusan Sidang Disiplin Tingkat Tinggi';
    const pejabatTtd = data?.pejabatTtd || 'Pimpinan Pondok Pesantren';

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                bottom: 1440,
                left: 1440,
                right: 1440,
              },
            },
          },
          children: [
            ...this.createKopSurat(cabang !== '[ NAMA CABANG / PESANTREN ]' ? cabang : undefined),

            // Judul SK
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 200, after: 40 },
              children: [
                new TextRun({
                  text: 'SURAT KEPUTUSAN PIMPINAN PONDOK PESANTREN',
                  font: 'Times New Roman',
                  size: 24,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 },
              children: [
                new TextRun({
                  text: `Nomor: ${nomorSk}`,
                  font: 'Times New Roman',
                  size: 20,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [
                new TextRun({
                  text: 'TENTANG\nPEMBERHENTIAN RESMI SANTRI (DROP OUT / PENGELUARAN)',
                  font: 'Times New Roman',
                  size: 20,
                  bold: true,
                  underline: {},
                }),
              ],
            }),

            // Menimbang
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: 'Menimbang: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: 'a. Bahwa dalam rangka menjaga ketertiban, nama baik, dan iklim pendidikan yang kondusif di lingkungan pondok pesantren;\n' +
                    'b. Bahwa santri yang bersangkutan telah terbukti melakukan pelanggaran berat tata tertib dan/atau telah melampaui batas akumulasi poin kedisiplinan yang ditetapkan;\n' +
                    'c. Bahwa pembinaan intensif dan Surat Peringatan (SP) sebelumnya telah diberikan namun tidak menunjukkan perbaikan;',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Mengingat
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: 'Mengingat: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: '1. Anggaran Dasar dan Anggaran Rumah Tangga Yayasan;\n' +
                    '2. Buku Panduan Tata Tertib dan Kode Etik Santri;\n' +
                    '3. Hasil Sidang Pleno Dewan Disiplin dan Musyawarah Pengasuhan Pondok Pesantren.',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Memutuskan
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 120, after: 120 },
              children: [
                new TextRun({
                  text: 'MEMUTUSKAN',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                  underline: {},
                }),
              ],
            }),

            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: 'Menetapkan: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: 'Memberhentikan secara resmi (Dikeluarkan / Drop Out) dari Pondok Pesantren terhadap santri:',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Tabel Data Santri
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                this.createIdentitasRow('Nama Lengkap', namaSiswa),
                this.createIdentitasRow('Nomor Induk (NIS)', nis),
                this.createIdentitasRow('Kelas / Rombel', kelas),
                this.createIdentitasRow('Cabang / Lembaga', cabang),
                this.createIdentitasRow('Kategori Alasan', kategoriAlasan),
                this.createIdentitasRow('Keterangan / Alasan', alasanPemberhentian),
              ],
            }),

            // Diktum
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { before: 140, after: 80 },
              children: [
                new TextRun({
                  text: 'Pertama: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: `Terhitung sejak tanggal ${tanggalKeluar}, santri yang bersangkutan resmi kehilangan hak dan statusnya sebagai peserta didik di lembaga ini dan dikembalikan seutuhnya kepada orang tua / wali santri.`,
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: 'Kedua: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: 'Santri yang bersangkutan diwajibkan menyelesaikan seluruh kewajiban administrasi pesantren dan mengosongkan asrama paling lambat 1x24 jam sejak surat keputusan ini diterbitkan.',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 240 },
              children: [
                new TextRun({
                  text: 'Ketiga: ',
                  font: 'Times New Roman',
                  size: 22,
                  bold: true,
                }),
                new TextRun({
                  text: 'Surat Keputusan ini berlaku sejak tanggal ditetapkan dengan ketentuan apabila di kemudian hari terdapat kekeliruan akan diperbaiki sebagaimana mestinya.',
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            // Tanda Tangan
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: `Ditetapkan di: Pesantren\nPada tanggal: ${tanggalSk}`,
                  font: 'Times New Roman',
                  size: 22,
                }),
              ],
            }),

            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 50, type: WidthType.PERCENTAGE },
                      borders: {
                        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: 'Orang Tua / Wali Santri,', font: 'Times New Roman', size: 20 })],
                        }),
                        new Paragraph({ text: '', spacing: { after: 800 } }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: '( ........................................ )', font: 'Times New Roman', size: 20, bold: true })],
                        }),
                      ],
                    }),
                    new TableCell({
                      width: { size: 50, type: WidthType.PERCENTAGE },
                      borders: {
                        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                      },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: pejabatTtd, font: 'Times New Roman', size: 20, bold: true })],
                        }),
                        new Paragraph({ text: '', spacing: { after: 800 } }),
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun({ text: '( Pimpinan Pondok Pesantren )', font: 'Times New Roman', size: 20, bold: true })],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),

            // Tembusan
            new Paragraph({
              spacing: { before: 200, after: 40 },
              children: [
                new TextRun({
                  text: 'Tembusan:',
                  font: 'Times New Roman',
                  size: 18,
                  bold: true,
                }),
              ],
            }),
            new Paragraph({
              indent: { left: 240 },
              children: [
                new TextRun({
                  text: '1. Ketua Yayasan\n2. Kepala Lembaga Pendidikan Formal / Muadalah\n3. Pembina Asrama & Keamanan\n4. Arsip Bagian Administrasi & Personalia',
                  font: 'Times New Roman',
                  size: 18,
                }),
              ],
            }),
          ],
        },
      ],
    });

    return Packer.toBuffer(doc);
  }
}
