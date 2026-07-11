import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ProgramType, KehadiranStatus } from '@prisma/client';

@Injectable()
export class AbsensiService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPrograms(activeOnly?: boolean, userScope?: string, page?: number, limit?: number) {
    const whereClause: any = {};
    if (activeOnly) {
      whereClause.isActive = true;
    }
    if (userScope === 'CABANG' || userScope === 'WILAYAH') {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      whereClause.date = {
        lte: today
      };
    }

    if (page && limit) {
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        this.prisma.programAbsensi.findMany({
          where: whereClause,
          orderBy: { date: 'desc' },
          skip,
          take: limit
        }),
        this.prisma.programAbsensi.count({
          where: whereClause
        })
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    }

    return this.prisma.programAbsensi.findMany({
      where: whereClause,
      orderBy: { date: 'desc' }
    });
  }

  async createProgram(data: { name: string; type: ProgramType; date: string }) {
    return this.prisma.programAbsensi.create({
      data: {
        name: data.name,
        type: data.type,
        date: new Date(data.date)
      }
    });
  }

  async updateProgram(id: string, data: { name?: string; type?: ProgramType; date?: string; isActive?: boolean }) {
    const updateData: any = { ...data };
    if (data.date) {
      updateData.date = new Date(data.date);
    }
    return this.prisma.programAbsensi.update({
      where: { id },
      data: updateData
    });
  }

  async deleteProgram(id: string) {
    return this.prisma.programAbsensi.delete({
      where: { id }
    });
  }

  async deleteAllPrograms() {
    return this.prisma.programAbsensi.deleteMany();
  }

  async generateProgramsBulk(data: { namePrefix: string; dayOfWeek: number; startMonth: string; endMonth: string }) {
    const { namePrefix, dayOfWeek, startMonth, endMonth } = data;

    const [startYear, startM] = startMonth.split('-').map(Number);
    const [endYear, endM] = endMonth.split('-').map(Number);

    const startDate = new Date(startYear, startM - 1, 1);
    const endDate = new Date(endYear, endM, 0); // last day of target month

    const matchingDates: Date[] = [];
    let current = new Date(startDate);
    while (current <= endDate) {
      if (current.getDay() === dayOfWeek) {
        matchingDates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }

    const results = [];
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const daysIndonesian = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

    for (const d of matchingDates) {
      const dayStr = String(d.getDate()).padStart(2, '0');
      const monthStr = months[d.getMonth()];
      const yearStr = d.getFullYear();
      const dayName = daysIndonesian[dayOfWeek];
      const name = `${namePrefix} ${dayName} - ${dayStr} ${monthStr} ${yearStr}`;

      const existing = await this.prisma.programAbsensi.findFirst({
        where: {
          date: d
        }
      });

      if (!existing) {
        const created = await this.prisma.programAbsensi.create({
          data: {
            name,
            type: 'PELAJARAN',
            date: d,
            isActive: true
          }
        });
        results.push(created);
      }
    }

    return {
      totalGenerated: results.length,
      programs: results
    };
  }

  async getKehadiran(programId: string, kelasId: string, cabangId: string) {
    if (!cabangId) throw new BadRequestException('Cabang ID is required');
    
    const students = await this.prisma.student.findMany({
      where: {
        cabangId,
        isActive: true,
        siswaFormal: {
          kelasId
        }
      },
      include: {
        biodata: {
          select: {
            fullName: true,
            nisLokal: true
          }
        }
      },
      orderBy: {
        biodata: {
          fullName: 'asc'
        }
      }
    });

    const existingLogs = await this.prisma.kehadiran.findMany({
      where: {
        programId,
        cabangId
      }
    });

    return students.map(student => {
      const log = existingLogs.find(l => l.studentId === student.id);
      return {
        studentId: student.id,
        fullName: student.biodata.fullName,
        nisLokal: student.biodata.nisLokal,
        status: log?.status || 'HADIR',
        catatan: log?.catatan || ''
      };
    });
  }

  async saveKehadiranBulk(programId: string, cabangId: string, logs: Array<{ studentId: string; status: KehadiranStatus; catatan?: string }>) {
    if (!cabangId) throw new BadRequestException('Cabang ID is required');

    return this.prisma.$transaction(
      logs.map(log => 
        this.prisma.kehadiran.upsert({
          where: {
            programId_studentId: {
              programId,
              studentId: log.studentId
            }
          },
          update: {
            status: log.status,
            catatan: log.catatan || null
          },
          create: {
            programId,
            studentId: log.studentId,
            cabangId,
            status: log.status,
            catatan: log.catatan || null
          }
        })
      )
    );
  }
}
