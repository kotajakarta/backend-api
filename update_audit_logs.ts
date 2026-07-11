import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: { actorName: 'System', actorId: { not: 'system' } }
  });

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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
