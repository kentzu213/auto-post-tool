import { Module, Global } from '@nestjs/common';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';
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
  providers: [MediaService, StorageService],
  exports: [MediaService, StorageService],
})
export class MediaModule {}

