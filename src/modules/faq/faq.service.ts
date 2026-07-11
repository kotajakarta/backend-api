import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class FaqService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getAll() {
    return this.prisma.faq.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async createFaq(data: { question: string, answer: string }, user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Only admin can create FAQ');
    }
    return this.prisma.faq.create({
      data
    });
  }

  async updateFaq(id: string, data: { question?: string, answer?: string }, user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Only admin can update FAQ');
    }
    const existing = await this.prisma.faq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('FAQ not found');
    
    return this.prisma.faq.update({
      where: { id },
      data
    });
  }

  async deleteFaq(id: string, user: any) {
    if (user.scope !== 'GLOBAL') {
      throw new ForbiddenException('Only admin can delete FAQ');
    }
    const existing = await this.prisma.faq.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('FAQ not found');

    return this.prisma.faq.delete({
      where: { id }
    });
  }
}
