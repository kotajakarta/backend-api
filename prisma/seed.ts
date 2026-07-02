import { PrismaClient, UserScope, UserDivisi, StatusPool } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding data...');

  // Clean up existing data first
  await prisma.logKehadiran.deleteMany();
  await prisma.riwayatPendidikan.deleteMany();
  await prisma.student.deleteMany();
  await prisma.biodata.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.user.deleteMany();
  await prisma.cabang.deleteMany();
  await prisma.wilayah.deleteMany();

  // Create Wilayah (2)
  const wilayah1 = await prisma.wilayah.create({
    data: { name: 'Wilayah 1 (Jawa)' },
  });
  const wilayah2 = await prisma.wilayah.create({
    data: { name: 'Wilayah 2 (Luar Jawa)' },
  });

  const wilayahs = [wilayah1, wilayah2];

  // Create Cabang (5)
  const cabangs = [];
  for (let i = 1; i <= 5; i++) {
    const wilayah = i <= 3 ? wilayah1 : wilayah2; // 3 in w1, 2 in w2
    const cabang = await prisma.cabang.create({
      data: {
        name: `Cabang ${i}`,
        wilayahId: wilayah.id,
      },
    });
    cabangs.push(cabang);
  }

  // Create Users
  // Hash passwords
  const adminPass = await bcrypt.hash('admin123', 10);
  const wilayahPass = await bcrypt.hash('wilayah123', 10);
  const cabangPass = await bcrypt.hash('cabang123', 10);

  // Admin
  await prisma.user.create({
    data: {
      username: 'admin',
      password: adminPass,
      scope: UserScope.GLOBAL,
      divisi: UserDivisi.ALL,
    },
  });

  // Wilayah Users (wilayah1, wilayah2)
  await prisma.user.create({
    data: {
      username: 'wilayah1',
      password: wilayahPass,
      scope: UserScope.WILAYAH,
      divisi: UserDivisi.ALL,
      wilayahId: wilayah1.id,
    },
  });
  await prisma.user.create({
    data: {
      username: 'wilayah2',
      password: wilayahPass,
      scope: UserScope.WILAYAH,
      divisi: UserDivisi.ALL,
      wilayahId: wilayah2.id,
    },
  });

  // Cabang Users (cabang1 to cabang5)
  for (let i = 1; i <= 5; i++) {
    await prisma.user.create({
      data: {
        username: `cabang${i}`,
        password: cabangPass,
        scope: UserScope.CABANG,
        divisi: UserDivisi.ALL,
        wilayahId: cabangs[i - 1].wilayahId,
        cabangId: cabangs[i - 1].id,
      },
    });
  }

  // Create Guru / Staff (10)
  for (let i = 1; i <= 10; i++) {
    await prisma.staff.create({
      data: {
        name: `Guru ${i}`,
        position: i <= 2 ? 'Kepala Cabang' : 'Pengajar',
      },
    });
  }

  // Create Siswa (60)
  for (let i = 1; i <= 60; i++) {
    const isPool = i % 5 === 0; // Every 5th student is in the pool (no cabang)
    const cabang = cabangs[i % cabangs.length];
    
    // First create biodata
    const biodata = await prisma.biodata.create({
      data: {
        fullName: `Siswa ${i}`,
        address: `Alamat Siswa ${i}`,
        phone: `081234567${i.toString().padStart(3, '0')}`,
      },
    });

    const student = await prisma.student.create({
      data: {
        biodataId: biodata.id,
        wilayahId: cabang.wilayahId,
        cabangId: isPool ? null : cabang.id,
        statusPool: isPool ? StatusPool.TERSEDIA : StatusPool.AKTIF_CABANG,
      },
    });

    // Create riwayat pendidikan if they are in a cabang or have been
    if (!isPool) {
      await prisma.riwayatPendidikan.create({
        data: {
          studentId: student.id,
          cabangId: cabang.id,
          tanggalMasuk: new Date(new Date().setFullYear(new Date().getFullYear() - Math.floor(Math.random() * 3))),
        },
      });
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
