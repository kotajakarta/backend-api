import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

try {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  console.log('Success without adapter!');
} catch (e) {
  console.error(e.message);
}
