import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { PrismaService } from './src/common/prisma/prisma.service.js';
import jwt from 'jsonwebtoken';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const user = await prisma.user.findFirst({ where: { scope: 'GLOBAL' } });
  if (!user) {
    console.error("No global user found");
    return;
  }

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    scope: user.scope,
    divisi: user.divisi
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
    issuer: 'edaimi-backend-api',
    audience: 'edaimi-clients',
    expiresIn: '1d'
  });

  console.log("TOKEN:", token);

  try {
    const res = await fetch('http://localhost:8080/api/v1/students', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (res.status === 500) {
      const text = await res.text();
      console.log("500 ERROR RESPONSE:", text);
    } else {
      console.log("STATUS:", res.status);
    }
  } catch (e) {
    console.error("FETCH ERROR:", e);
  }

  await app.close();
}

bootstrap().catch(console.error);
