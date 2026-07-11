import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async searchAll(query: string, user: any) {
    if (!query || query.length < 2) return [];

    const scopeFilter = user.scope === 'GLOBAL' ? {} : user.scope === 'WILAYAH' ? { wilayahId: user.wilayahId } : { cabangId: user.cabangId };
    const q = query.toLowerCase();

    const [students, staffs, cabangs] = await Promise.all([
      // Search students
      this.prisma.student.findMany({
        where: {
          ...scopeFilter,
          biodata: {
            fullName: { contains: q, mode: 'insensitive' }
          }
        },
        include: { biodata: true },
        take: 5
      }),
      
      // Search staff
      this.prisma.staff.findMany({
        where: {
          ...scopeFilter,
          name: { contains: q, mode: 'insensitive' }
        },
        take: 5
      }),
      
      // Search cabang (only if GLOBAL or WILAYAH and matching scope)
      (user.scope === 'GLOBAL' || user.scope === 'WILAYAH') ? this.prisma.cabang.findMany({
        where: {
          ...(user.scope === 'WILAYAH' ? { wilayahId: user.wilayahId } : {}),
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { nameGlodemy: { contains: q, mode: 'insensitive' } },
            { nameResmi: { contains: q, mode: 'insensitive' } },
          ]
        },
        take: 5
      }) : Promise.resolve([])
    ]);

    const results: any[] = [];
    
    students.forEach(s => {
      results.push({
        id: s.id,
        type: 'Siswa',
        name: s.biodata?.fullName || 'Tanpa Nama',
        subtitle: s.biodata?.nisn || s.jenisSiswa || 'Siswa',
        link: `/core/siswa?viewId=${s.id}`
      });
    });

    staffs.forEach(s => {
      results.push({
        id: s.id,
        type: 'Guru',
        name: s.name,
        subtitle: s.position || 'Staff',
        link: `/core/guru?viewId=${s.id}`
      });
    });

    cabangs.forEach(c => {
      results.push({
        id: c.id,
        type: 'Cabang',
        name: c.name,
        subtitle: c.nameResmi || 'Cabang',
        link: `/core/cabang?viewId=${c.id}`
      });
    });

    return results;
  }
}
