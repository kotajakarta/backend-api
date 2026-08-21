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
  HeadingLevel,
} from 'docx';

@Injectable()
export class DocxExportService {
  /**
   * Mengubah HTML sederhana menjadi array TextRun dengan formatting (Bold, Italic, Code, dll)
   */
  private parseHtmlToTextRuns(html: string, baseFont = 'Times New Roman', defaultSize = 22): TextRun[] {
    if (!html) return [new TextRun({ text: '', font: baseFont, size: defaultSize })];

    // Decode basic entities
    let text = html
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Replace line breaks
    text = text.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<p[^>]*>/gi, '');

    // Tokenize text into formatted chunks
    const runs: TextRun[] = [];
    const segments = text.split(/(<\/?(?:b|strong|i|em|u|code|span)[^>]*>)/gi);

    let isBold = false;
    let isItalic = false;
    let isUnderline = false;
    let isCode = false;

    for (const seg of segments) {
      if (!seg) continue;
      const lower = seg.toLowerCase();
      if (lower.startsWith('<b') || lower.startsWith('<strong')) {
        isBold = true;
      } else if (lower.startsWith('</b') || lower.startsWith('</strong')) {
        isBold = false;
      } else if (lower.startsWith('<i') || lower.startsWith('<em')) {
        isItalic = true;
      } else if (lower.startsWith('</i') || lower.startsWith('</em')) {
        isItalic = false;
      } else if (lower.startsWith('<u')) {
        isUnderline = true;
      } else if (lower.startsWith('</u')) {
        isUnderline = false;
      } else if (lower.startsWith('<code')) {
        isCode = true;
      } else if (lower.startsWith('</code')) {
        isCode = false;
      } else if (seg.startsWith('<') && seg.endsWith('>')) {
        // Skip other HTML tags
        continue;
      } else {
        // Clean remaining tag artifacts
        const cleanContent = seg.replace(/<[^>]+>/g, '');
        if (cleanContent) {
          runs.push(
            new TextRun({
              text: cleanContent,
              bold: isBold,
              italics: isItalic || isCode,
              underline: isUnderline ? {} : undefined,
              font: isCode ? 'Courier New' : baseFont,
              size: defaultSize,
            }),
          );
        }
      }
    }

    if (runs.length === 0) {
      runs.push(new TextRun({ text: html.replace(/<[^>]+>/g, '').trim(), font: baseFont, size: defaultSize }));
    }

    return runs;
  }

  async generateDocxBuffer(bank: any, includeKey = false): Promise<Buffer> {
    const children: (Paragraph | Table)[] = [];
    const font = 'Times New Roman';

    // 1. Kop Lembaga & Judul
    if (bank.institution) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: bank.institution.toUpperCase(),
              bold: true,
              size: 26,
              font,
            }),
          ],
        }),
      );
    }

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: (bank.title || 'NASKAH SOAL UJIAN').toUpperCase(),
            bold: true,
            size: 24,
            font,
          }),
        ],
        spacing: { after: 150 },
      }),
    );

    // 2. Meta Info Table (Mata Pelajaran, Kelas, Waktu, Tahun Ajaran)
    const metaTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `Mata Pelajaran : `, bold: true, font, size: 20 }),
                    new TextRun({ text: bank.subject || '-', font, size: 20 }),
                  ],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `Kelas / Tingkat : `, bold: true, font, size: 20 }),
                    new TextRun({ text: bank.gradeLevel || '-', font, size: 20 }),
                  ],
                }),
              ],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `Tahun Ajaran   : `, bold: true, font, size: 20 }),
                    new TextRun({
                      text: `${bank.academicYear || '-'} ${bank.semester ? `(${bank.semester})` : ''}`,
                      font,
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: `Alokasi Waktu  : `, bold: true, font, size: 20 }),
                    new TextRun({ text: bank.timeLimit ? `${bank.timeLimit} Menit` : 'Sesuai Jadwal', font, size: 20 }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    children.push(metaTable);

    if (bank.instructions) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Petunjuk Umum: ', bold: true, italics: true, font, size: 18 }),
            new TextRun({ text: bank.instructions, italics: true, font, size: 18 }),
          ],
          spacing: { before: 150, after: 200 },
        }),
      );
    }

    const questions = bank.questions || [];
    const mcqQuestions = questions.filter(
      (q: any) => q.type === 'MCQ_4' || q.type === 'MCQ_5' || q.type === 'COMPLEX_MC' || q.type === 'TRUE_FALSE',
    );
    const essayQuestions = questions.filter((q: any) => q.type === 'ESSAY');

    // 3. Bagian Pilihan Ganda
    if (mcqQuestions.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: 'A. PILIHAN GANDA',
              bold: true,
              size: 22,
              font,
            }),
          ],
          spacing: { before: 200, after: 150 },
        }),
      );

      mcqQuestions.forEach((q: any, idx: number) => {
        const questionRuns = [
          new TextRun({ text: `${idx + 1}. `, bold: true, font, size: 22 }),
          ...this.parseHtmlToTextRuns(q.contentHtml, font, 22),
        ];

        children.push(
          new Paragraph({
            children: questionRuns,
            spacing: { before: 120, after: 60 },
          }),
        );

        // Render Options A, B, C, D, E
        (q.options || []).forEach((opt: any) => {
          const isCorrectKey = includeKey && opt.isCorrect;
          const optRuns = [
            new TextRun({ text: `${opt.label}. `, bold: true, font, size: 22 }),
            ...this.parseHtmlToTextRuns(opt.contentHtml, font, 22),
          ];

          if (isCorrectKey) {
            optRuns.push(
              new TextRun({
                text: '  [KUNCI JAWABAN]',
                bold: true,
                color: '2E7D32',
                font,
                size: 20,
              }),
            );
          }

          children.push(
            new Paragraph({
              indent: { left: 720 }, // 0.5 inch indent
              children: optRuns,
              spacing: { after: 40 },
            }),
          );
        });
      });
    }

    // 4. Bagian Soal Esai / Uraian
    if (essayQuestions.length > 0) {
      const sectionLetter = mcqQuestions.length > 0 ? 'B' : 'A';
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: `${sectionLetter}. SOAL URAIAN / ESAI`,
              bold: true,
              size: 22,
              font,
            }),
          ],
          spacing: { before: 300, after: 150 },
        }),
      );

      essayQuestions.forEach((q: any, idx: number) => {
        const questionRuns = [
          new TextRun({ text: `${idx + 1}. `, bold: true, font, size: 22 }),
          ...this.parseHtmlToTextRuns(q.contentHtml, font, 22),
        ];

        children.push(
          new Paragraph({
            children: questionRuns,
            spacing: { before: 120, after: 80 },
          }),
        );

        if (includeKey && q.answerKey) {
          children.push(
            new Paragraph({
              indent: { left: 720 },
              children: [
                new TextRun({
                  text: 'Pedoman Penskoran / Kunci Jawaban: ',
                  bold: true,
                  italics: true,
                  color: '1565C0',
                  font,
                  size: 20,
                }),
                ...this.parseHtmlToTextRuns(q.answerKey, font, 20),
              ],
              spacing: { after: 120 },
            }),
          );
        } else {
          // Provide dotted response lines for paper print
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: '.........................................................................................................................................................................',
                  color: '9E9E9E',
                  font,
                  size: 18,
                }),
              ],
              spacing: { after: 60 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: '.........................................................................................................................................................................',
                  color: '9E9E9E',
                  font,
                  size: 18,
                }),
              ],
              spacing: { after: 120 },
            }),
          );
        }
      });
    }

    // 5. Lembar Ringkasan Kunci Jawaban (jika includeKey === true)
    if (includeKey && mcqQuestions.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: 'RINGKASAN KUNCI JAWABAN PILIHAN GANDA',
              bold: true,
              size: 22,
              font,
            }),
          ],
          spacing: { before: 400, after: 150 },
        }),
      );

      // Create a grid of keys (e.g. 5 keys per row)
      const keyRows: TableRow[] = [];
      const itemsPerRow = 5;
      for (let i = 0; i < mcqQuestions.length; i += itemsPerRow) {
        const chunk = mcqQuestions.slice(i, i + itemsPerRow);
        const cells = chunk.map((q: any, chunkIdx: number) => {
          const num = i + chunkIdx + 1;
          const correctOpt = (q.options || []).find((o: any) => o.isCorrect);
          const keyText = correctOpt ? correctOpt.label : '-';
          return new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${num}. `, font, size: 20 }),
                  new TextRun({ text: keyText, bold: true, color: '1565C0', font, size: 22 }),
                ],
              }),
            ],
          });
        });

        // Fill empty cells if last row has fewer items
        while (cells.length < itemsPerRow) {
          cells.push(new TableCell({ children: [new Paragraph({ children: [] })] }));
        }

        keyRows.push(new TableRow({ children: cells }));
      }

      const keyTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: keyRows,
      });

      children.push(keyTable);
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch all sides
            },
          },
          children,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }
}
