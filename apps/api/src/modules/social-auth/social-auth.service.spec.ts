import { Test, TestingModule } from '@nestjs/testing';
import { SocialAuthService } from './social-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { ProviderManager } from './providers/provider-manager';
import { CredentialsService } from './credentials.service';
import { TenantScopeService } from '../auth/authorization/tenant-scope.service';
import { verifyOAuthState } from './oauth-state';
import { Platform } from '@prisma/client';

/**
 * Updated for the workspace-authorization changes:
 *  - `SocialAuthService` now depends on ProviderManager, CredentialsService, and
 *    TenantScopeService (all mocked here).
 *  - `getAuthRedirectUrl` is now ASYNC and embeds the workspace in a SIGNED OAuth
 *    `state` (oauth-state.ts) instead of the raw workspaceId — so assertions verify
 *    the signed state decodes back to the workspace, not a plaintext `state=ws`.
 */
describe('SocialAuthService', () => {
  let service: SocialAuthService;
  let prisma: PrismaService;

  const mockPrisma = {
    socialAccount: {
      upsert: jest.fn().mockImplementation(({ create }) => ({
        id: 'mock_record_id',
        ...create,
      })),
    },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ id: 'workspace_123' }),
    },
    teamMember: { create: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn() },
  };

  const mockCrypto = {
    encrypt: jest.fn().mockImplementation((text) => `encrypted:${text}`),
    decrypt: jest.fn().mockImplementation((text) => text.replace('encrypted:', '')),
  };

  // No real provider credentials configured → service takes the Mock OAuth path.
  const mockCredentialsService = {
    getCredentials: jest.fn().mockResolvedValue(null),
    saveCredentials: jest.fn().mockResolvedValue(undefined),
  };

  const mockProviderManager = {
    getProvider: jest.fn(),
  };

  const mockTenantScope = {
    requireOwned: jest.fn(),
    requireAllOwned: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // signOAuthState/verifyOAuthState need a signing secret.
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-social-auth-spec';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: ProviderManager, useValue: mockProviderManager },
        { provide: CredentialsService, useValue: mockCredentialsService },
        { provide: TenantScopeService, useValue: mockTenantScope },
      ],
    }).compile();

    service = module.get<SocialAuthService>(SocialAuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('nên được định nghĩa', () => {
    expect(service).toBeDefined();
  });

  describe('getAuthRedirectUrl (async, signed state)', () => {
    it('sinh URL Mock OAuth với signed state giải mã về đúng workspace (Facebook)', async () => {
      const url = await service.getAuthRedirectUrl(Platform.facebook, 'workspace_123');
      expect(url).toContain('mock-oauth');
      expect(url).toContain('platform=facebook');

      // The state is a SIGNED token, not the raw workspaceId. Decode and verify it.
      const state = new URL(url).searchParams.get('state');
      expect(state).toBeTruthy();
      expect(state).not.toBe('workspace_123'); // not plaintext
      expect(verifyOAuthState(state as string)?.workspaceId).toBe('workspace_123');
    });

    it('sinh URL Mock OAuth với signed state (TikTok)', async () => {
      const url = await service.getAuthRedirectUrl(Platform.tiktok, 'workspace_123');
      expect(url).toContain('mock-oauth');
      expect(url).toContain('platform=tiktok');
      const state = new URL(url).searchParams.get('state');
      expect(verifyOAuthState(state as string)?.workspaceId).toBe('workspace_123');
    });
  });

  describe('handleOAuthCallback (verifies signed state)', () => {
    it('xử lý callback mock code thành công khi state hợp lệ', async () => {
      // Issue a signed state for the workspace, then feed it back to the callback.
      const url = await service.getAuthRedirectUrl(Platform.facebook, 'workspace_123');
      const state = new URL(url).searchParams.get('state') as string;

      const result = await service.handleOAuthCallback(Platform.facebook, 'mock_code_abc', state);

      expect(result).toHaveLength(1);
      expect(result[0].platform).toBe(Platform.facebook);
      expect(result[0].workspaceId).toBe('workspace_123');
      expect(result[0].accessToken).toContain('encrypted:mock_access_token_');
      expect(prisma.socialAccount.upsert).toHaveBeenCalledTimes(1);
    });

    it('từ chối callback khi state không hợp lệ / bị giả mạo (không tạo tài khoản)', async () => {
      await expect(
        service.handleOAuthCallback(Platform.facebook, 'mock_code_abc', 'default_workspace_id'),
      ).rejects.toThrow();
      expect(prisma.socialAccount.upsert).not.toHaveBeenCalled();
    });
  });
});
