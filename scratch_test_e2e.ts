import 'dotenv/config';
import fs from 'fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { LjkOmrService } from './src/modules/formal/ljk/ljk-omr.service.js';
import { LjkService } from './src/modules/formal/ljk/ljk.service.js';

async function test() {
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  const mockMinioService: any = {
    uploadBuffer: async () => 'http://mock-url',
  };

  const omrService = new LjkOmrService();
  const ljkService = new LjkService(prisma as any, mockMinioService, omrService);

  const images = [
    {
      name: 'Image 1 (Abimayu Al Fathiri)',
      path: '/home/aithendi/.gemini/antigravity-ide/brain/7fddd134-8a0b-446f-9c80-4f2be22449da/.user_uploaded/media_1789703955951.jpg',
    },
    {
      name: 'Image 2 (Ahmad Adzka Aiman Hidayat)',
      path: '/home/aithendi/.gemini/antigravity-ide/brain/7fddd134-8a0b-446f-9c80-4f2be22449da/.user_uploaded/media_1789704010056.jpg',
    },
  ];

  for (const img of images) {
    console.log(`\n================== Testing ${img.name} ==================`);
    const buffer = fs.readFileSync(img.path);
    const mockFile = {
      originalname: 'scan.jpg',
      buffer,
      mimetype: 'image/jpeg',
    };

    // Panggil scanLjkFile tanpa hint apapun untuk menguji auto-detection OMR murni
    const result = await ljkService.scanLjkFile(mockFile, {}, { id: 'test-user' });

    console.log('HASIL SCAN & RESOLUSI DATABASE:');
    console.log(`- NISN: "${result.nisn}"`);
    console.log(`- Status Santri: ${result.student ? `TERDAFTAR (${result.student.fullName})` : 'BELUM TERDAFTAR'}`);
    console.log(`- Cabang: ${result.kodeCabang} -> ${result.cabang ? result.cabang.name : 'Tidak ditemukan'}`);
    console.log(`- Mapel: ${result.kodeMapelNum} -> ${result.mapel || 'Tidak ditemukan'}`);
    console.log(`- Kelas: ${result.kelas}`);
    console.log(`- Semester: ${result.semester}`);
    console.log(`- Skor: ${result.skor}% (${result.jumlahBenar} Benar, ${result.jumlahSalah} Salah dari ${result.totalSoal} Soal)`);
    console.log(`- Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  }

  await prisma.$disconnect();
  await pool.end();
}

test().catch(console.error);
