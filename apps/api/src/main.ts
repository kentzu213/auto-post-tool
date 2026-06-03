import 'dotenv/config';
import { otelSDK } from './otel-sdk';
// Khởi động OpenTelemetry SDK trước khi tải bất kỳ module/framework nào khác
otelSDK.start();
console.log('⚡ [OTel] OpenTelemetry SDK started successfully.');

import { NestFactory } from '@nestjs/core';
import { HttpAdapterHost } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { loadConfig } from './common/config/config-loader';
import { initSentry } from './common/observability/sentry';
import { AllExceptionsFilter } from './common/observability/all-exceptions.filter';
import { AuthorizationAuditFilter } from './modules/auth/authorization/authorization-audit.filter';

async function bootstrap() {
  // Fail-fast config validation BEFORE creating the Nest app. On any missing or
  // invalid Required_Config_Variable this logs the offending names (never the
  // values) and exits non-zero, so the process never starts listening with a
  // bad config. (Req 6.1, 6.2)
  const appConfig = loadConfig(process.env, 'api');

  // Initialize the Sentry error sink BEFORE the app is created so early errors
  // are captured. No-op when SENTRY_DSN is unset (graceful degrade). (Req 12.2)
  initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Use pino as the application logger so framework + HTTP request logs are
  // emitted as structured JSON with secrets redacted. (Req 12.1, 12.7)
  app.useLogger(app.get(PinoLogger));

  // Global exception filter: Sentry capture + error-rate metric + threshold
  // alert, without changing the HTTP error response. (Req 12.2, 12.3, 12.4)
  //
  // Filter ordering (task 6.1): NestJS merges global filters as
  //   [ ...APP_FILTER providers (bound during module init),
  //     ...useGlobalFilters entries (bound here, later) ]
  // then REVERSES that array and matches with `Array.find` (first match wins) —
  // verified against @nestjs/core (router-exception-filters.js `.reverse()` +
  // select-exception-filter-metadata.util.js `.find()`). Because
  // `AllExceptionsFilter` is a catch-all `@Catch()` it matches EVERY exception,
  // so whichever catch-all is appended last ends up first after the reverse and
  // would shadow a more specific filter. Binding `AuthorizationAuditFilter`
  // (a specific `@Catch(MembershipDenied | RoleDenied | CrossTenantNotFound)`)
  // via APP_FILTER would therefore NEVER run — the catch-all always wins on
  // array position, not on @Catch specificity, in this version.
  //
  // The reliable fix is to bind both filters here, registering the specific
  // `AuthorizationAuditFilter` AFTER `AllExceptionsFilter`. After the reverse it
  // sits first and handles the three typed authorization exceptions (writing the
  // audit row, then re-sending the original 401/403/404 body), while the
  // catch-all `AllExceptionsFilter` still handles every other exception. This
  // matches the design's "registered after AllExceptionsFilter" intent.
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapterHost.httpAdapter),
    app.get(AuthorizationAuditFilter),
  );

  // Trust the reverse proxy (Caddy) so X-Forwarded-Proto/Host are honored and
  // the app constructs correct external URLs (OAuth redirects, signed URLs)
  // behind TLS termination. One hop = the Reverse_Proxy. (Req 4.5)
  app.set('trust proxy', 1);

  // ============================================================
  // SECURITY LAYER
  // ============================================================

  // 1. Helmet — bảo vệ HTTP headers (XSS, clickjacking, MIME sniffing, etc.)
  app.use(helmet({
    crossOriginResourcePolicy: false, // Cho phép Next.js (port 3005) load ảnh/video từ API (port 3001)
  }));

  // 2. CORS — chỉ cho phép origins được chỉ định (không wildcard).
  // ============================================================
  // PRODUCTION CORS / EXTERNAL URLs (Req 6.6, 15.2)
  // Origins come exclusively from the validated Config_Loader (CORS_ORIGINS),
  // never hard-coded or wildcarded. In production these MUST be the real
  // public domains (e.g. https://app.example.com) supplied via the VPS .env —
  // no localhost. The Config_Loader fail-fast guarantees CORS_ORIGINS is set
  // before the app ever listens. Do not weaken to `origin: true` / `*`.
  // ============================================================
  const allowedOrigins = appConfig.corsOrigins;

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

  // Bảo vệ Swagger UI ở production (chỉ mở ở dev/staging).
  // Req 15.3: Swagger/OpenAPI is mounted ONLY when NODE_ENV !== 'production',
  // so the API docs are never exposed on the public production surface. Keep
  // this gate — do not mount /docs unconditionally.
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, document);
    console.log(`📄 Swagger documentation available at http://localhost:${process.env.PORT || 3001}/docs`);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 API Server running on http://localhost:${port}`);
  console.log(`🔒 CORS allowed origins: ${allowedOrigins.join(', ')}`);
  // Bull Board is mounted behind HTTP Basic auth (Req 15.4) — see app.module.ts.
  console.log(`📦 Bull Board dashboard at http://localhost:${port}/admin/queues`);
}
bootstrap();

