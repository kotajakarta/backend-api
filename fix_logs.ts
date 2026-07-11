import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { PrismaService } from './src/common/prisma/prisma.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  
  const logs = await prisma.auditLog.findMany({
    where: { actorName: 'System', actorId: { not: 'system' } }
  });

  console.log(`Found ${logs.length} logs to fix.`);
  
  for (const log of logs) {
    const user = await prisma.user.findUnique({
      where: { id: log.actorId },
      include: { cabang: true, wilayah: true }
    });

    if (user) {
      let newActorName = user.username;
      if (user.scope === 'CABANG' && user.cabang) {
        newActorName = `${user.username} - ${user.cabang.name}`;
      } else if (user.scope === 'WILAYAH' && user.wilayah) {
        newActorName = `${user.username} - ${user.wilayah.name}`;
      }
      
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { actorName: newActorName }
      });
      console.log(`Updated log ${log.id} to ${newActorName}`);
    }
  }
  
  await app.close();
}
bootstrap();
