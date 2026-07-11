import 'dotenv/config';
import { PrismaService } from './src/common/prisma/prisma.service.js';

async function main() {
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  try {
    const data = await prismaService.student.findMany({
      take: 1,
      include: {
        biodata: true,
        wilayah: true,
        cabang: true,
        riwayatPendidikan: {
          include: { cabang: true },
          orderBy: { tanggalMasuk: 'desc' },
        },
      }
    });
    console.log("SUCCESS:", data.length);
  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    await prismaService.onModuleDestroy();
  }
}

main().catch(console.error);
