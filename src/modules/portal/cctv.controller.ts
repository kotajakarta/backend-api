import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessControlGuard } from '../../common/guards/access-control.guard.js';
import { RequireScope } from '../../common/decorators/access-control.decorator.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { encryptStreamUrl, decryptStreamUrl, encryptStoredStreamUrl, decryptStoredStreamUrl } from '../../common/utils/cctv-crypto.js';
import { assertModuleEnabled } from '../../common/utils/module-guard.js';

@Controller('cctv')
@UseGuards(AccessControlGuard)
@RequireScope('CABANG')
export class CctvController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('channels')
  async getChannels(@Request() req: any, @Query('cabangId') cabangId?: string) {
    assertModuleEnabled('portalWalsanEnabled');
    const user = req.user;
    const where: any = {};

    if (user.scope === 'CABANG') {
      where.cabangId = user.cabangId;
    } else if (user.scope === 'WILAYAH') {
      where.cabang = { wilayahId: user.wilayahId };
    } else if (cabangId) {
      where.cabangId = cabangId;
    }

    const channels = await this.prisma.cctvChannel.findMany({
      where,
      include: { cabang: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return channels.map((c: any) => {
      let raw = decryptStoredStreamUrl(c.streamUrl);
      if (!raw || (!raw.startsWith('http://') && !raw.startsWith('https://'))) {
        raw = 'https://its.binamarga.pu.go.id:8989/play/hls/CT-02/index.m3u8';
      }
      const encrypted = encryptStreamUrl(raw);
      return {
        ...c,
        streamUrl: `/api/v1/cctv/stream-proxy/playlist?token=${encodeURIComponent(encrypted)}`,
        rawStreamUrl: raw,
      };
    });
  }

  @Post('channels')
  async createChannel(@Request() req: any, @Body() body: any) {
    const user = req.user;
    const targetCabangId = user.scope === 'CABANG' ? user.cabangId : body.cabangId;

    if (!targetCabangId) {
      throw new ForbiddenException('Cabang ID wajib diisi');
    }

    const encryptedUrl = encryptStoredStreamUrl(decryptStoredStreamUrl(body.streamUrl));

    return this.prisma.cctvChannel.create({
      data: {
        cabangId: targetCabangId,
        name: body.name,
        category: body.category || 'KELAS',
        streamUrl: encryptedUrl,
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

    const encryptedUrl = body.streamUrl ? encryptStoredStreamUrl(decryptStoredStreamUrl(body.streamUrl)) : undefined;

    return this.prisma.cctvChannel.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.category && { category: body.category }),
        ...(encryptedUrl && { streamUrl: encryptedUrl }),
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
