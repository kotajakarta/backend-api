import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class PesantrenService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async getGrupDaimi() {
    return this.prisma.grupDaimi.findMany({
      orderBy: { name: 'asc' }
    });
  }

  async createGrupDaimi(data: { name: string }) {
    return this.prisma.grupDaimi.create({
      data
    });
  }

  async updateGrupDaimi(id: string, data: { name: string }) {
    return this.prisma.grupDaimi.update({
      where: { id },
      data
    });
  }

  async deleteGrupDaimi(id: string) {
    // Note: If related records exist and cascade is not set, this will throw an error automatically.
    return this.prisma.grupDaimi.delete({
      where: { id }
    });
  }
}
