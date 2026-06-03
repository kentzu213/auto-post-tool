import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/services/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { PublisherModule } from './modules/publisher/publisher.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AIModule } from './modules/ai/ai.module';
import { MediaModule } from './modules/media/media.module';
import { SocialAuthModule } from './modules/social-auth/social-auth.module';
import { HealthModule } from './modules/health/health.module';
import { PostsModule } from './modules/posts/posts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { buildLoggerParams } from './common/logging/logger.config';
import { bullBoardAuthMiddleware } from './common/security/bull-board-auth.middleware';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { WorkspaceContextGuard } from './modules/auth/guards/workspace-context.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuthorizationModule } from './modules/auth/authorization/authorization.module';

@Module({
  imports: [
    // Structured JSON logging (Req 12.1, 12.7) — pino as the Nest logger with
    // secret redaction. Registered first so it is available app-wide.
    LoggerModule.forRoot(buildLoggerParams()),
    PrismaModule,
    CryptoModule,
    AuthModule,
    PublisherModule,
    SchedulerModule,
    AIModule,
    MediaModule,
    SocialAuthModule,
    HealthModule,
    PostsModule,
    AnalyticsModule,
    InboxModule,
    CampaignsModule,
    TemplatesModule,
    NotificationsModule,
    ApprovalsModule,
    // Authorization helpers (TenantScopeService, AuthorizationAuditService,
    // AuthorizationAuditFilter). Imported so the global guards/filter resolve
    // their dependencies and feature modules can inject the exported services.
    AuthorizationModule,
    ScheduleModule.forRoot(),
    // Rate Limiting — 100 requests per 60 seconds mặc định cho tất cả endpoints
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
      // Req 15.4: gate the queue dashboard behind HTTP Basic auth. The
      // middleware runs BEFORE the dashboard router — it enforces credentials
      // when BULL_BOARD_USER/BULL_BOARD_PASSWORD are set, fails closed (503) in
      // production when they are unset, and stays open locally in dev for
      // convenience. See bull-board-auth.middleware.ts.
      middleware: bullBoardAuthMiddleware,
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Áp dụng ThrottlerGuard toàn cục cho tất cả endpoints
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global authorization pipeline (task 6.1). APP_GUARD providers execute in
    // array (registration) order — verified against @nestjs/core's
    // GuardsConsumer, which iterates guards without reversing them — so this
    // enforces auth → membership → role:
    //   1. JwtAuthGuard         — verify JWT / honor @Public()           (Req 1.1)
    //   2. WorkspaceContextGuard — derive + verify membership context    (Req 2.6, 3.2)
    //   3. RolesGuard           — enforce @RequireRole vs PermissionMatrix (Req 9.2)
    // After this, EVERY route requires a valid JWT + membership unless marked
    // @Public() (added in task 6.2).
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: WorkspaceContextGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
