import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { Platform } from '@prisma/client';
import { ProviderCredentials } from './providers/social-provider.interface';

export interface CredentialInput {
  platform: Platform;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface CredentialOutput {
  platform: Platform;
  clientId: string;           // Masked: only last 4 chars visible
  clientSecretMask: string;   // Masked: ****
  redirectUri: string;
  isActive: boolean;
  updatedAt: Date;
}

/**
 * Service quản lý API credentials cho các Social Providers.
 * 
 * Priority order:
 * 1. .env variables (production override)
 * 2. Database (user-configured via UI)
 * 3. Mock fallback (development only)
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  // Mapping platform → env variable names
  private readonly ENV_KEYS: Record<string, { clientId: string; clientSecret: string; redirectUri: string }> = {
    facebook: {
      clientId: 'FACEBOOK_CLIENT_ID',
      clientSecret: 'FACEBOOK_CLIENT_SECRET',
      redirectUri: 'FACEBOOK_REDIRECT_URI',
    },
    youtube: {
      clientId: 'GOOGLE_CLIENT_ID',
      clientSecret: 'GOOGLE_CLIENT_SECRET',
      redirectUri: 'GOOGLE_REDIRECT_URI',
    },
    tiktok: {
      clientId: 'TIKTOK_CLIENT_KEY',
      clientSecret: 'TIKTOK_CLIENT_SECRET',
      redirectUri: 'TIKTOK_REDIRECT_URI',
    },
  };

  // ⚠️ Defaults chỉ dùng khi .env không set. TikTok BẮT BUỘC HTTPS — luôn set TIKTOK_REDIRECT_URI trong .env
  private readonly DEFAULT_REDIRECT_URIS: Record<string, string> = {
    facebook: 'http://localhost:3001/social-auth/callback/facebook',
    youtube: 'http://localhost:3001/social-auth/callback/youtube',
    tiktok: process.env.TIKTOK_REDIRECT_URI || 'https://localhost:3001/social-auth/callback/tiktok',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Lấy credentials cho platform — ưu tiên .env → DB → null
   * Trả về plaintext credentials sẵn sàng dùng.
   */
  async getCredentials(workspaceId: string, platform: Platform): Promise<ProviderCredentials | null> {
    // Priority 1: .env variables (production)
    const envKeys = this.ENV_KEYS[platform];
    if (envKeys) {
      const envClientId = process.env[envKeys.clientId];
      const envClientSecret = process.env[envKeys.clientSecret];

      if (envClientId && !envClientId.startsWith('mock_') && envClientSecret && !envClientSecret.startsWith('mock_')) {
        this.logger.log(`[${platform}] Using credentials from .env`);
        return {
          clientId: envClientId,
          clientSecret: envClientSecret,
          redirectUri: process.env[envKeys.redirectUri] || this.DEFAULT_REDIRECT_URIS[platform],
        };
      }
    }

    // Priority 2: Database (user-configured)
    const dbCredential = await this.prisma.providerCredential.findUnique({
      where: { workspaceId_platform: { workspaceId, platform } },
    });

    if (dbCredential && dbCredential.isActive) {
      this.logger.log(`[${platform}] Using credentials from database (workspace: ${workspaceId})`);
      return {
        clientId: this.crypto.decrypt(dbCredential.clientId),
        clientSecret: this.crypto.decrypt(dbCredential.clientSecret),
        redirectUri: dbCredential.redirectUri,
      };
    }

    // No credentials found — also check for credentials with no specific workspace (global fallback)
    const anyCredential = await this.prisma.providerCredential.findFirst({
      where: { platform, isActive: true },
    });

    if (anyCredential) {
      this.logger.log(`[${platform}] Using global fallback credentials from database`);
      return {
        clientId: this.crypto.decrypt(anyCredential.clientId),
        clientSecret: this.crypto.decrypt(anyCredential.clientSecret),
        redirectUri: anyCredential.redirectUri,
      };
    }

    this.logger.warn(`[${platform}] ⚠️ Không tìm thấy credentials. Cần cấu hình qua Settings hoặc .env`);
    return null;
  }

  /**
   * Lưu/cập nhật credentials cho platform (encrypted)
   */
  async saveCredentials(workspaceId: string, input: CredentialInput): Promise<CredentialOutput> {
    const redirectUri = input.redirectUri || this.DEFAULT_REDIRECT_URIS[input.platform];

    // Ensure workspace exists (auto-provision for demo/dev)
    const validWorkspaceId = await this.ensureWorkspace(workspaceId);

    const encryptedClientId = this.crypto.encrypt(input.clientId);
    const encryptedClientSecret = this.crypto.encrypt(input.clientSecret);

    const credential = await this.prisma.providerCredential.upsert({
      where: {
        workspaceId_platform: {
          workspaceId: validWorkspaceId,
          platform: input.platform,
        },
      },
      update: {
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        redirectUri,
        isActive: true,
      },
      create: {
        workspaceId: validWorkspaceId,
        platform: input.platform,
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        redirectUri,
        isActive: true,
      },
    });

    this.logger.log(`✅ [${input.platform}] Credentials đã được lưu (encrypted) cho workspace ${workspaceId}`);

    return {
      platform: credential.platform,
      clientId: this.maskString(input.clientId),
      clientSecretMask: '••••••••',
      redirectUri: credential.redirectUri,
      isActive: credential.isActive,
      updatedAt: credential.updatedAt,
    };
  }

  /**
   * Lấy danh sách trạng thái credentials cho tất cả platforms
   */
  async listCredentials(workspaceId: string): Promise<CredentialOutput[]> {
    const platforms = Object.values(Platform);
    const results: CredentialOutput[] = [];

    for (const platform of platforms) {
      const creds = await this.getCredentials(workspaceId, platform);
      const dbCred = await this.prisma.providerCredential.findUnique({
        where: { workspaceId_platform: { workspaceId, platform } },
      });

      results.push({
        platform,
        clientId: creds ? this.maskString(creds.clientId) : '',
        clientSecretMask: creds ? '••••••••' : '',
        redirectUri: this.DEFAULT_REDIRECT_URIS[platform] || '',
        isActive: !!creds,
        updatedAt: dbCred?.updatedAt || new Date(),
      });
    }

    return results;
  }

  /**
   * Xóa credentials cho platform
   */
  async deleteCredentials(workspaceId: string, platform: Platform): Promise<void> {
    await this.prisma.providerCredential.deleteMany({
      where: { workspaceId, platform },
    });
    this.logger.log(`🗑️ [${platform}] Credentials đã bị xóa cho workspace ${workspaceId}`);
  }

  /**
   * Mask chuỗi: chỉ hiện 4 ký tự cuối
   */
  private maskString(str: string): string {
    if (str.length <= 4) return '••••';
    return '••••••' + str.slice(-4);
  }

  /**
   * Đảm bảo workspace tồn tại — tạo demo workspace nếu cần (cho dev/demo)
   */
  private async ensureWorkspace(workspaceId: string): Promise<string> {
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (existing) return workspaceId;

    this.logger.log(`[ensureWorkspace] Workspace "${workspaceId}" chưa tồn tại. Tạo Demo...`);

    let demoUser = await this.prisma.user.findUnique({
      where: { email: 'demo@autopost.local' },
    });

    if (!demoUser) {
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash('demo123456', 10);
      demoUser = await this.prisma.user.create({
        data: { email: 'demo@autopost.local', password: hashedPassword, name: 'Demo User' },
      });
    }

    const workspace = await this.prisma.workspace.create({
      data: { name: 'Demo Workspace', ownerId: demoUser.id },
    });

    await this.prisma.teamMember.create({
      data: { workspaceId: workspace.id, userId: demoUser.id, role: 'owner' },
    });

    return workspace.id;
  }
}
