import { Global, Module } from '@nestjs/common';
import { FacebookPublisher } from './services/facebook.publisher';
import { YouTubePublisher } from './services/youtube.publisher';
import { TikTokPublisher } from './services/tiktok.publisher';

@Global()
@Module({
  providers: [FacebookPublisher, YouTubePublisher, TikTokPublisher],
  exports: [FacebookPublisher, YouTubePublisher, TikTokPublisher],
})
export class PublisherModule {}
