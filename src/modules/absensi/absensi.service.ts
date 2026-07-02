import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class AbsensiService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async logKehadiran(logs: { studentId: string; status: string }[]) {
    // Bulk insert menggunakan prisma.$transaction sesuai request
    const validLogs = logs.filter(log => log.studentId);
    
    return this.prisma.$transaction(
      validLogs.map(log => 
        this.prisma.logKehadiran.create({
          data: {
            studentId: log.studentId,
          }
        })
      )
    );
  }
}
