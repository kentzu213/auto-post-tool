import { Module, Global } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'media-queue',
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}

