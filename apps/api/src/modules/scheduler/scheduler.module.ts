import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerService } from './scheduler.service';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { SocialAuthModule } from '../social-auth/social-auth.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'publishing-queue',
    }),
    BullBoardModule.forFeature({
      name: 'publishing-queue',
      adapter: BullMQAdapter,
    }),
    SocialAuthModule,
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
