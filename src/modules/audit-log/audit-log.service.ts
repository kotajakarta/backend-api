import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(action: string, entity: string, entityId: string, entityName: string, actor: any, details: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          entity,
          entityId,
          entityName,
          actorId: actor?.id || 'system',
          actorName: actor?.scope === 'CABANG' && actor?.cabangName 
            ? `${actor.username || 'User'} - ${actor.cabangName}`
            : actor?.scope === 'WILAYAH' && actor?.wilayahName
            ? `${actor.username || 'User'} - ${actor.wilayahName}`
            : actor?.username || 'System',
          actorScope: actor?.scope || 'GLOBAL',
          wilayahId: actor?.wilayahId || null,
          cabangId: actor?.cabangId || null,
          details,
        },
      });
    } catch (error) {
      console.error('Gagal menulis audit log:', error);
    }
  }

  async getLogs(user: any, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    let whereClause: any = {};

    if (user.scope === 'WILAYAH' && user.wilayahId) {
      whereClause.wilayahId = user.wilayahId;
    } else if (user.scope === 'CABANG' && user.cabangId) {
      whereClause.cabangId = user.cabangId;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({
        where: whereClause,
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
