import { Test, TestingModule } from '@nestjs/testing';
import { SocialAuthService } from './social-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { Platform } from '@prisma/client';

describe('SocialAuthService', () => {
  let service: SocialAuthService;
  let prisma: PrismaService;
  let crypto: CryptoService;

  // Mock PrismaService
  const mockPrisma = {
    socialAccount: {
      upsert: jest.fn().mockImplementation(({ create }) => {
        return {
          id: 'mock_record_id',
          ...create,
        };
      }),
    },
  };

  // Mock CryptoService
  const mockCrypto = {
    encrypt: jest.fn().mockImplementation((text) => `encrypted:${text}`),
    decrypt: jest.fn().mockImplementation((text) => text.replace('encrypted:', '')),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<SocialAuthService>(SocialAuthService);
    prisma = module.get<PrismaService>(PrismaService);
    crypto = module.get<CryptoService>(CryptoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('nên được định nghĩa', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthRedirectUrl', () => {
    it('nên sinh URL Mock OAuth khi client id là mock (Facebook)', () => {
      process.env.FACEBOOK_CLIENT_ID = 'mock_fb';
      const url = service.getAuthRedirectUrl(Platform.facebook, 'workspace_123');
      expect(url).toContain('mock-oauth');
      expect(url).toContain('platform=facebook');
      expect(url).toContain('state=workspace_123');
    });

    it('nên sinh URL Mock OAuth khi client id là mock (YouTube)', () => {
      process.env.GOOGLE_CLIENT_ID = 'mock_google';
      const url = service.getAuthRedirectUrl(Platform.youtube, 'workspace_123');
      expect(url).toContain('mock-oauth');
      expect(url).toContain('platform=youtube');
      expect(url).toContain('state=workspace_123');
    });

    it('nên sinh URL Mock OAuth khi client id là mock (TikTok)', () => {
      process.env.TIKTOK_CLIENT_KEY = 'mock_tiktok';
      const url = service.getAuthRedirectUrl(Platform.tiktok, 'workspace_123');
      expect(url).toContain('mock-oauth');
      expect(url).toContain('platform=tiktok');
      expect(url).toContain('state=workspace_123');
    });
  });

  describe('handleOAuthCallback', () => {
    it('nên xử lý callback mock code thành công', async () => {
      const workspaceId = 'workspace_123';
      const result = await service.handleOAuthCallback(Platform.facebook, 'mock_code_abc', workspaceId);

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe(Platform.facebook);
      expect(result[0].workspaceId).toBe(workspaceId);
      expect(result[0].accessToken).toContain('encrypted:mock_access_token_');
      expect(prisma.socialAccount.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
