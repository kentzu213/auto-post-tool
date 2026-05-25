import { Module } from '@nestjs/common';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/services/crypto.module';

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [SocialAuthController],
  providers: [SocialAuthService],
  exports: [SocialAuthService],
})
export class SocialAuthModule {}
