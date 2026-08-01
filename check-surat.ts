import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { SuratService } from './src/modules/surat/surat.service.js';
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function testAll() {
  const service = new SuratService(prisma as any);
  try {
    console.log('1. Testing getLetterStats()...');
    const stats = await service.getLetterStats();
    console.log('Stats:', stats);

    console.log('2. Testing getDepartments()...');
    const depts = await service.getDepartments();
    console.log('Depts:', depts);

    console.log('3. Testing getInstitutions()...');
    const insts = await service.getInstitutions();
    console.log('Insts:', insts);

    console.log('4. Testing getLetterTypes()...');
    const types = await service.getLetterTypes();
    console.log('Types:', types);

    console.log('5. Testing getFormatTemplate()...');
    const format = await service.getFormatTemplate();
    console.log('Format:', format);

    console.log('6. Testing getLetters()...');
    const letters = await service.getLetters({});
    console.log('Letters count:', letters.length);

    console.log('7. Testing getTemplates()...');
    const templates = await service.getTemplates();
    console.log('Templates count:', templates.length);

    console.log('ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('ERROR ENCOUNTERED:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

testAll();
