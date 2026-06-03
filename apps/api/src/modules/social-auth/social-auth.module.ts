import { Module } from '@nestjs/common';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';
import { CredentialsService } from './credentials.service';
import { CredentialsController } from './credentials.controller';
import { FacebookProvider } from './providers/facebook.provider';
import { YouTubeProvider } from './providers/youtube.provider';
import { TikTokProvider } from './providers/tiktok.provider';
import { ProviderManager } from './providers/provider-manager';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/services/crypto.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [PrismaModule, CryptoModule, AuthorizationModule],
  controllers: [SocialAuthController, CredentialsController],
  providers: [
    SocialAuthService,
    CredentialsService,
    FacebookProvider,
    YouTubeProvider,
    TikTokProvider,
    ProviderManager,
  ],
  exports: [SocialAuthService, CredentialsService, ProviderManager],
})
export class SocialAuthModule {}
