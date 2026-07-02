import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PrismaClientExceptionFilter } from './common/filters/prisma-client-exception.filter.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import cors from 'cors';

async function bootstrap() {
  const server = express();
  
  // Enable CORS dynamically from environment variable
  let corsOptions: cors.CorsOptions = { origin: '*' };
  if (process.env.CORS_ORIGINS && process.env.CORS_ORIGINS !== '*') {
    const origins = process.env.CORS_ORIGINS.split(',').map(o => o.trim());
    corsOptions = { origin: origins };
  }
  server.use(cors(corsOptions));
  server.use(express.json({ limit: '50mb' }));
  server.use(express.urlencoded({ limit: '50mb', extended: true }));

  const nestApp = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false
  });

  // Global API prefix — all routes will be /api/v1/*
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  nestApp.setGlobalPrefix(apiPrefix);

  // Global validation pipe
  nestApp.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  }));

  const config = new DocumentBuilder()
    .setTitle('Edaimi Backend API')
    .setDescription(
      'API Gateway Terpusat untuk semua aplikasi Edaimi (Sekolah App, Pesantren App, dll). ' +
      'Semua akses database disentralisasi melalui API ini.'
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(nestApp, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, nestApp, document);

  nestApp.useGlobalFilters(new PrismaClientExceptionFilter());
  
  // Allow configuring port via environment variable (fallback to 8080 as requested)
  const port = process.env.PORT || 8080;
  await nestApp.listen(port, '0.0.0.0');
  console.log(`🚀 Backend API Gateway is running on http://0.0.0.0:${port}`);
  console.log(`📖 Swagger Docs: http://localhost:${port}/${apiPrefix}/docs`);
  console.log(`❤️  Health Check: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
