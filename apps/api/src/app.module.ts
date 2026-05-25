import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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

@Module({
  imports: [
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
  ],
})
export class AppModule {}
