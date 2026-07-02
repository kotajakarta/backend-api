import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getStats(user: any) {
    let whereClause = {};

    if (user.scope === 'WILAYAH') {
      whereClause = { wilayahId: user.wilayahId };
    } else if (user.scope === 'CABANG') {
      whereClause = { cabangId: user.cabangId };
    }

    const totalSantri = await this.prisma.student.count({
      where: user.scope === 'GLOBAL' ? {} : whereClause
    });

    const totalKelas = 42; // Mock for now, depending on formal schema
    const totalTahfidz = 8; // Mock for now
    const totalPrestasi = 156; // Mock for now

    return {
      totalSantri,
      totalKelas,
      totalTahfidz,
      totalPrestasi,
      activities: [
        { title: 'Pembaruan Data Santri Baru', time: '2 jam yang lalu', author: 'Admin Pusat' },
        { title: 'Upload Rapor Semester Ganjil', time: '5 jam yang lalu', author: 'Guru Cabang 1' },
        { title: 'Absensi Harian Diperbarui', time: '1 hari yang lalu', author: 'Admin Wilayah' }
      ]
    };
  }
}
