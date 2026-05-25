import { Injectable } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { SocialProviderInterface } from './social-provider.interface';
import { FacebookProvider } from './facebook.provider';
import { YouTubeProvider } from './youtube.provider';
import { TikTokProvider } from './tiktok.provider';

/**
 * Provider Manager — Registry pattern (like Postiz IntegrationManager)
 * 
 * Maps Platform enum → concrete SocialProvider implementation.
 * Inject this service to get the right provider for any platform.
 */
@Injectable()
export class ProviderManager {
  private readonly providers: Map<Platform, SocialProviderInterface>;

  constructor(
    private readonly facebookProvider: FacebookProvider,
    private readonly youtubeProvider: YouTubeProvider,
    private readonly tiktokProvider: TikTokProvider,
  ) {
    this.providers = new Map<Platform, SocialProviderInterface>([
      [Platform.facebook, this.facebookProvider],
      [Platform.youtube, this.youtubeProvider],
      [Platform.tiktok, this.tiktokProvider],
    ]);
  }

  /**
   * Lấy provider cho platform cụ thể
   */
  getProvider(platform: Platform): SocialProviderInterface {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`Không hỗ trợ platform: ${platform}`);
    }
    return provider;
  }

  /**
   * Lấy danh sách tất cả providers đã đăng ký
   */
  getAllProviders(): SocialProviderInterface[] {
    return Array.from(this.providers.values());
  }

  /**
   * Kiểm tra platform có được hỗ trợ không
   */
  isSupported(platform: Platform): boolean {
    return this.providers.has(platform);
  }
}
