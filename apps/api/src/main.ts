import 'dotenv/config';
import { otelSDK } from './otel-sdk';
// Khởi động OpenTelemetry SDK trước khi tải bất kỳ module/framework nào khác
otelSDK.start();
console.log('⚡ [OTel] OpenTelemetry SDK started successfully.');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ============================================================
  // SECURITY LAYER
  // ============================================================

  // 1. Helmet — bảo vệ HTTP headers (XSS, clickjacking, MIME sniffing, etc.)
  app.use(helmet({
    crossOriginResourcePolicy: false, // Cho phép Next.js (port 3005) load ảnh/video từ API (port 3001)
  }));

  // Phục vụ tĩnh thư mục uploads cục bộ phục vụ cho đăng media từ ổ đĩa
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // 2. CORS — chỉ cho phép origins được chỉ định (không wildcard)
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3005')
    .split(',')
    .map(origin => origin.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // 3. Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // ============================================================
  // API DOCUMENTATION (Swagger)
  // ============================================================
  const config = new DocumentBuilder()
    .setTitle('Auto-Post Tool API')
    .setDescription('The multi-platform auto-posting tool API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Đăng ký, đăng nhập, quản lý session')
    .addTag('social-auth', 'Liên kết OAuth tài khoản mạng xã hội')
    .addTag('posts', 'CRUD bài viết, lên lịch, đăng bài')
    .addTag('scheduler', 'Quản lý hàng đợi và lịch đăng bài')
    .addTag('analytics', 'Thống kê, insights, báo cáo')
    .addTag('media', 'Xử lý video, hình ảnh, FFmpeg pipeline')
    .addTag('ai', 'AI sinh nội dung, hashtags, captions')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // Bảo vệ Swagger UI ở production (chỉ mở ở dev/staging)
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, document);
    console.log(`📄 Swagger documentation available at http://localhost:${process.env.PORT || 3001}/docs`);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 API Server running on http://localhost:${port}`);
  console.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`📦 Bull Board dashboard at http://localhost:${port}/admin/queues`);
}
bootstrap();

