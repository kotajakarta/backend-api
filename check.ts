import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  const setting = await prisma.pengaturanAkademik.findFirst();
  console.log('Kode Daftar Ulang:', setting?.kodeDaftarUlang);
}

check().then(() => prisma.$disconnect()).catch(console.error);
