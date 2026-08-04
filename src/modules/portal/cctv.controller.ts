import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Controller('cctv')
@UseGuards(AccessControlGuard)
@RequireScope('CABANG')
export class CctvController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('channels')
  async getChannels(@Request() req: any, @Query('cabangId') cabangId?: string) {
    const user = req.user;
    let targetCabangId = cabangId;

    if (user.scope === 'CABANG') {
      targetCabangId = user.cabangId;
    }

    const where: any = {};
    if (targetCabangId) {
      where.cabangId = targetCabangId;
    }

    return this.prisma.cctvChannel.findMany({
      where,
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('channels')
  async createChannel(@Request() req: any, @Body() body: any) {
    const user = req.user;
    const targetCabangId = user.scope === 'CABANG' ? user.cabangId : body.cabangId;

    if (!targetCabangId) {
      throw new ForbiddenException('Cabang ID wajib diisi');
    }

    return this.prisma.cctvChannel.create({
      data: {
        cabangId: targetCabangId,
        name: body.name,
        category: body.category || 'KELAS',
        streamUrl: body.streamUrl,
        location: body.location || null,
        description: body.description || null,
        isActive: body.isActive !== undefined ? body.isActive : true,
      },
    });
  }

  @Put('channels/:id')
  async updateChannel(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    const channel = await this.prisma.cctvChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Kamera CCTV tidak ditemukan');

    if (req.user.scope === 'CABANG' && channel.cabangId !== req.user.cabangId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke CCTV cabang lain');
    }

    return this.prisma.cctvChannel.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.category && { category: body.category }),
        ...(body.streamUrl && { streamUrl: body.streamUrl }),
        ...(body.location !== undefined && { location: body.location }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
  }

  @Delete('channels/:id')
  async deleteChannel(@Request() req: any, @Param('id') id: string) {
    const channel = await this.prisma.cctvChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Kamera CCTV tidak ditemukan');

    if (req.user.scope === 'CABANG' && channel.cabangId !== req.user.cabangId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke CCTV cabang lain');
    }

    return this.prisma.cctvChannel.delete({ where: { id } });
  }
}
