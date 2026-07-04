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
}
