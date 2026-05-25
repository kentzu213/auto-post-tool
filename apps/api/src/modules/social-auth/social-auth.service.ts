import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { Platform, AccountStatus } from '@prisma/client';
import { ProviderManager } from './providers/provider-manager';
import { TikTokProvider } from './providers/tiktok.provider';
import { CredentialsService } from './credentials.service';

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  /**
   * In-memory storage cho PKCE code_verifier.
   * Key = state (workspaceId), Value = { codeVerifier, createdAt }
   * Entries tự động cleanup sau 10 phút.
   */
  private readonly pkceStore = new Map<string, { codeVerifier: string; createdAt: number }>();
  private readonly PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly providerManager: ProviderManager,
    private readonly credentialsService: CredentialsService,
  ) {}

  /**
   * Lấy danh sách các tài khoản MXH đã liên kết
   */
  async getAccounts(workspaceId: string): Promise<any[]> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    const whereClause = workspace ? { workspaceId } : {};

    return this.prisma.socialAccount.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });
  }

  /**
   * Tạo URL chuyển hướng OAuth — sử dụng Provider thật hoặc Mock
   */
  async getAuthRedirectUrl(platform: Platform, workspaceId: string): Promise<string> {
    // Cleanup expired PKCE entries
    this.cleanupExpiredPKCE();

    // Try to get real credentials
    const credentials = await this.credentialsService.getCredentials(workspaceId, platform);

    if (credentials) {
      // ✅ REAL OAUTH — redirect tới platform thật
      const provider = this.providerManager.getProvider(platform);

      // TikTok cần PKCE — tạo code_verifier và lưu vào memory
      if (platform === Platform.tiktok && provider instanceof TikTokProvider) {
        const { url, codeVerifier } = provider.generateAuthUrlWithPKCE(credentials, workspaceId);
        
        // Lưu code_verifier theo state (= workspaceId) để dùng khi callback
        this.pkceStore.set(workspaceId, { codeVerifier, createdAt: Date.now() });
        this.logger.log(`🔗 [TikTok] Auth URL generated with PKCE. code_verifier stored for state=${workspaceId}`);
        
        return url;
      }

      // Các platform khác (Facebook, YouTube) — không cần PKCE
      const url = provider.generateAuthUrl(credentials, workspaceId);
      this.logger.log(`🔗 [${platform}] Real OAuth URL generated → redirect tới ${platform}.com`);
      return url;
    }

    // ⚠️ MOCK FALLBACK — chưa cấu hình credentials
    this.logger.warn(`⚠️ [${platform}] Chưa cấu hình API credentials. Sử dụng Mock OAuth.`);
    return `http://localhost:3005/auth/mock-oauth?platform=${platform}&state=${workspaceId}`;
  }

  /**
   * Xử lý OAuth callback — sử dụng Provider thật hoặc Mock
   */
  async handleOAuthCallback(platform: Platform, code: string, workspaceId: string): Promise<any[]> {
    this.logger.log(`🔗 OAuth callback: platform=${platform}, workspace=${workspaceId}`);

    // MOCK FLOW
    if (code.startsWith('mock_code_')) {
      return this.handleMockCallback(platform, workspaceId);
    }

    // REAL OAUTH FLOW — sử dụng Provider
    const credentials = await this.credentialsService.getCredentials(workspaceId, platform);
    if (!credentials) {
      throw new Error(`Không tìm thấy API credentials cho ${platform}. Vui lòng cấu hình trong Settings.`);
    }

    // Ensure workspace exists
    const validWorkspaceId = await this.ensureWorkspace(workspaceId);

    const provider = this.providerManager.getProvider(platform);

    // TikTok: Retrieve stored PKCE code_verifier
    let result;
    if (platform === Platform.tiktok && provider instanceof TikTokProvider) {
      const pkceEntry = this.pkceStore.get(workspaceId);
      if (!pkceEntry) {
        this.logger.error(`❌ [TikTok] Không tìm thấy PKCE code_verifier cho state=${workspaceId}. Có thể đã hết hạn.`);
        throw new Error('Phiên xác thực TikTok đã hết hạn (PKCE). Vui lòng thử kết nối lại.');
      }

      this.logger.log(`[TikTok] Retrieved PKCE code_verifier for state=${workspaceId}`);
      
      // Exchange code với code_verifier
      result = await provider.authenticate(code, credentials, pkceEntry.codeVerifier);
      
      // Xóa code_verifier sau khi dùng (one-time use)
      this.pkceStore.delete(workspaceId);
    } else {
      // Facebook, YouTube — không cần PKCE
      result = await provider.authenticate(code, credentials);
    }

    this.logger.log(`✅ [${platform}] OAuth thành công. ${result.accounts.length} tài khoản được liên kết.`);

    // Save all accounts to DB
    const savedAccounts = [];
    for (const account of result.accounts) {
      const encryptedAccessToken = this.crypto.encrypt(account.accessToken);
      const encryptedRefreshToken = account.refreshToken
        ? this.crypto.encrypt(account.refreshToken)
        : undefined;

      const socialAccount = await this.prisma.socialAccount.upsert({
        where: {
          platform_platformAccountId: {
            platform,
            platformAccountId: account.platformAccountId,
          },
        },
        update: {
          displayName: account.displayName,
          username: account.username,
          avatarUrl: account.avatarUrl,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: account.tokenExpiresAt,
          status: AccountStatus.active,
          workspaceId: validWorkspaceId,
        },
        create: {
          workspaceId: validWorkspaceId,
          platform,
          platformAccountId: account.platformAccountId,
          displayName: account.displayName,
          username: account.username,
          avatarUrl: account.avatarUrl,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: account.tokenExpiresAt,
          status: AccountStatus.active,
        },
      });

      savedAccounts.push(socialAccount);
    }

    return savedAccounts;
  }

  /**
   * Refresh token cho một tài khoản — sử dụng Provider
   */
  async refreshAccountToken(socialAccountId: string): Promise<string> {
    const acc = await this.prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
    });
    if (!acc) throw new Error(`Social account not found: ${socialAccountId}`);
    if (!acc.refreshToken) return this.crypto.decrypt(acc.accessToken);

    const decryptedRefreshToken = this.crypto.decrypt(acc.refreshToken);

    // Skip refresh for mock tokens
    if (decryptedRefreshToken.startsWith('mock_')) {
      return this.crypto.decrypt(acc.accessToken);
    }

    // Get credentials for this platform
    const credentials = await this.credentialsService.getCredentials(acc.workspaceId, acc.platform);
    if (!credentials) {
      this.logger.warn(`[refreshToken] No credentials for ${acc.platform}. Returning existing token.`);
      return this.crypto.decrypt(acc.accessToken);
    }

    try {
      const provider = this.providerManager.getProvider(acc.platform);
      const result = await provider.refreshToken(decryptedRefreshToken, credentials);

      const encryptedAccessToken = this.crypto.encrypt(result.accessToken);
      const tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);

      const updateData: any = {
        accessToken: encryptedAccessToken,
        tokenExpiresAt,
        status: AccountStatus.active,
      };

      if (result.refreshToken) {
        updateData.refreshToken = this.crypto.encrypt(result.refreshToken);
      }

      await this.prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: updateData,
      });

      this.logger.log(`✅ Token refreshed for ${acc.displayName} (${acc.platform})`);
      return result.accessToken;
    } catch (err: any) {
      this.logger.error(`❌ Token refresh failed for ${acc.displayName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Cron: Quét và refresh token sắp hết hạn trong 24h tới
   */
  async refreshExpiringTokens(): Promise<number> {
    const twentyFourHours = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiringAccounts = await this.prisma.socialAccount.findMany({
      where: {
        tokenExpiresAt: { lte: twentyFourHours },
        refreshToken: { not: null },
      },
    });

    this.logger.log(`⏳ [Cron] ${expiringAccounts.length} tài khoản sắp hết hạn token.`);

    let successCount = 0;
    for (const acc of expiringAccounts) {
      try {
        await this.refreshAccountToken(acc.id);
        successCount++;
      } catch {
        this.logger.error(`[Cron] Lỗi refresh token: ${acc.displayName} (${acc.id})`);
      }
    }

    return successCount;
  }

  /**
   * Hủy kết nối một hoặc nhiều tài khoản MXH
   */
  async disconnectAccounts(ids: string[]): Promise<{ success: boolean; count: number }> {
    if (!ids || ids.length === 0) {
      return { success: true, count: 0 };
    }

    this.logger.log(`🔌 [Disconnect Accounts] Đang xóa ${ids.length} tài khoản MXH: [${ids.join(', ')}]`);
    
    const result = await this.prisma.socialAccount.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    this.logger.log(`✅ [Disconnect Accounts] Đã xóa thành công ${result.count} tài khoản.`);
    return {
      success: true,
      count: result.count,
    };
  }

  /**
   * DIRECT CONNECT — Kết nối bằng App ID + Page Access Token trực tiếp
   * 
   * Flow đơn giản nhất cho ứng dụng Windows desktop:
   * 1. User dán App ID + Page Access Token
   * 2. Hệ thống gọi Graph API validate token → lấy thông tin Page
   * 3. Lưu token (encrypted) → sẵn sàng đăng bài tự động
   */
  async directConnect(
    platform: Platform,
    appId: string,
    accessToken: string,
    workspaceId: string,
  ): Promise<any> {
    this.logger.log(`🔗 [Direct Connect] Platform=${platform}, AppID=${appId.slice(0, 6)}...`);

    const validWorkspaceId = await this.ensureWorkspace(workspaceId);

    if (platform === 'facebook') {
      return this.directConnectFacebook(appId, accessToken, validWorkspaceId);
    }
    if (platform === 'youtube') {
      return this.directConnectGeneric(platform, appId, accessToken, validWorkspaceId, 'YouTube Channel');
    }
    if (platform === 'tiktok') {
      return this.directConnectGeneric(platform, appId, accessToken, validWorkspaceId, 'TikTok Account');
    }

    throw new Error(`Platform không hỗ trợ: ${platform}`);
  }

  /**
   * Facebook Direct Connect — validate token bằng Graph API thật
   */
  private async directConnectFacebook(appId: string, accessToken: string, workspaceId: string) {
    const axios = (await import('axios')).default;

    // Step 1: Validate token — lấy thông tin Pages mà token có quyền truy cập
    let pages: any[] = [];
    let userInfo: any = null;

    try {
      // Thử lấy Pages (nếu là Page Access Token)
      const pagesResponse = await axios.get('https://graph.facebook.com/v22.0/me/accounts', {
        params: { access_token: accessToken, fields: 'id,name,access_token,picture{url}' },
      });
      pages = pagesResponse.data.data || [];
    } catch {
      // Nếu không lấy được pages, thử lấy info của chính token (có thể là Page Token trực tiếp)
    }

    // Lấy info của token holder
    try {
      const meResponse = await axios.get('https://graph.facebook.com/v22.0/me', {
        params: { access_token: accessToken, fields: 'id,name,picture{url}' },
      });
      userInfo = meResponse.data;
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`Token không hợp lệ! Facebook trả lỗi: ${msg}`);
    }

    this.logger.log(`✅ [Facebook] Token hợp lệ. User/Page: "${userInfo.name}" (ID: ${userInfo.id}). Pages found: ${pages.length}`);

    // Nếu có Pages → lưu từng Page; nếu không → lưu token gốc (có thể là Page Token trực tiếp)
    const savedAccounts = [];

    if (pages.length > 0) {
      for (const page of pages) {
        const account = await this.prisma.socialAccount.upsert({
          where: { platform_platformAccountId: { platform: 'facebook', platformAccountId: page.id } },
          update: {
            displayName: page.name,
            username: `@fbpage_${page.id}`,
            avatarUrl: page.picture?.data?.url || `https://graph.facebook.com/${page.id}/picture?type=normal`,
            accessToken: this.crypto.encrypt(page.access_token),
            status: 'active',
            workspaceId,
          },
          create: {
            workspaceId,
            platform: 'facebook',
            platformAccountId: page.id,
            displayName: page.name,
            username: `@fbpage_${page.id}`,
            avatarUrl: page.picture?.data?.url || `https://graph.facebook.com/${page.id}/picture?type=normal`,
            accessToken: this.crypto.encrypt(page.access_token),
            status: 'active',
          },
        });
        savedAccounts.push(account);
      }
    } else {
      // Lưu chính token đã nhập (có thể là Page Access Token trực tiếp)
      const account = await this.prisma.socialAccount.upsert({
        where: { platform_platformAccountId: { platform: 'facebook', platformAccountId: userInfo.id } },
        update: {
          displayName: userInfo.name,
          username: `@fb_${userInfo.id}`,
          avatarUrl: userInfo.picture?.data?.url || `https://graph.facebook.com/${userInfo.id}/picture?type=normal`,
          accessToken: this.crypto.encrypt(accessToken),
          status: 'active',
          workspaceId,
        },
        create: {
          workspaceId,
          platform: 'facebook',
          platformAccountId: userInfo.id,
          displayName: userInfo.name,
          username: `@fb_${userInfo.id}`,
          avatarUrl: userInfo.picture?.data?.url || `https://graph.facebook.com/${userInfo.id}/picture?type=normal`,
          accessToken: this.crypto.encrypt(accessToken),
          status: 'active',
        },
      });
      savedAccounts.push(account);
    }

    // Lưu App ID vào credentials cho reference
    await this.credentialsService.saveCredentials(workspaceId, {
      platform: 'facebook',
      clientId: appId,
      clientSecret: 'direct_token_mode',
    });

    this.logger.log(`✅ [Facebook Direct Connect] Đã lưu ${savedAccounts.length} tài khoản. Sẵn sàng đăng bài!`);

    return {
      success: true,
      message: `Kết nối thành công! ${savedAccounts.length} Facebook Page đã được liên kết.`,
      accounts: savedAccounts.map(a => ({
        id: a.id,
        displayName: a.displayName,
        username: a.username,
        avatarUrl: a.avatarUrl,
        platform: a.platform,
        status: a.status,
      })),
    };
  }

  /**
   * Generic Direct Connect for YouTube/TikTok
   */
  private async directConnectGeneric(
    platform: Platform, appId: string, accessToken: string,
    workspaceId: string, displayLabel: string,
  ) {
    const axios = (await import('axios')).default;
    let platformAccountId = `direct_${platform}_${Date.now()}`;
    let displayName = `${displayLabel} (Direct)`;
    let username = `@${platform}_direct`;
    let avatarUrl = `https://ui-avatars.com/api/?name=${platform.charAt(0).toUpperCase()}&background=6366f1&color=fff&size=150`;

    if (!accessToken.startsWith('mock_')) {
      try {
        if (platform === 'youtube') {
          this.logger.log(`[Direct Connect] Đang tải thông tin kênh YouTube từ API thật...`);
          const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
            params: { part: 'snippet,statistics', mine: true },
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const channel = channelResponse.data.items?.[0];
          if (channel) {
            platformAccountId = channel.id;
            displayName = channel.snippet.title;
            username = channel.snippet.customUrl || `@yt_${channel.id}`;
            avatarUrl = channel.snippet.thumbnails?.high?.url || channel.snippet.thumbnails?.default?.url || avatarUrl;
            this.logger.log(`[Direct Connect] Lấy thông tin YouTube thành công: "${displayName}"`);
          } else {
            throw new Error('Tài khoản Google này không có kênh YouTube nào được tạo hoặc chưa kích hoạt!');
          }
        } else if (platform === 'tiktok') {
          this.logger.log(`[Direct Connect] Đang tải thông tin TikTok từ API thật...`);
          const response = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const user = response.data.data?.user;
          if (user) {
            platformAccountId = user.open_id || user.union_id || platformAccountId;
            displayName = user.display_name || displayName;
            username = `@${user.username || 'tiktok_user'}`;
            avatarUrl = user.avatar_url || avatarUrl;
            this.logger.log(`[Direct Connect] Lấy thông tin TikTok thành công: "${displayName}"`);
          } else {
            throw new Error('Không tìm thấy thông tin người dùng TikTok!');
          }
        }
      } catch (err: any) {
        const errorData = err.response?.data ? JSON.stringify(err.response.data) : '';
        this.logger.error(`❌ [Direct Connect] Lỗi khi lấy profile thật cho ${platform}: ${err.message} ${errorData}`);
        this.logger.error(`Stack trace: ${err.stack}`);
        const apiErrorMsg = err.response?.data?.error?.message || err.message;
        throw new Error(`Lỗi kết nối ${platform}: ${apiErrorMsg}`);
      }
    }

    const account = await this.prisma.socialAccount.upsert({
      where: { platform_platformAccountId: { platform, platformAccountId } },
      update: {
        displayName,
        username,
        avatarUrl,
        accessToken: this.crypto.encrypt(accessToken),
        status: 'active',
        workspaceId,
      },
      create: {
        workspaceId,
        platform,
        platformAccountId,
        displayName,
        username,
        avatarUrl,
        accessToken: this.crypto.encrypt(accessToken),
        status: 'active',
      },
    });

    // Lưu App ID / Client ID vào credentials làm tham chiếu
    try {
      await this.credentialsService.saveCredentials(workspaceId, {
        platform,
        clientId: appId,
        clientSecret: 'direct_token_mode',
      });
    } catch (e: any) {
      this.logger.warn(`⚠️ [Direct Connect] Không thể lưu credentials tham chiếu: ${e.message}`);
    }

    return {
      success: true,
      message: `Kết nối ${displayLabel} thành công!`,
      accounts: [{ id: account.id, displayName: account.displayName, username: account.username, avatarUrl: account.avatarUrl, platform, status: 'active' }],
    };
  }

  // ================================================================
  // PRIVATE HELPERS
  // ================================================================

  /**
   * Mock OAuth callback — tạo demo account khi chưa có credentials thật
   */
  private async handleMockCallback(platform: Platform, workspaceId: string): Promise<any[]> {
    this.logger.log(`[MOCK] Mock OAuth cho ${platform}...`);

    const validWorkspaceId = await this.ensureWorkspace(workspaceId);

    const mockAccountId = `mock_acc_${platform}_${Date.now()}`;
    const mockInfo: Record<string, { name: string; user: string; avatar: string }> = {
      facebook: { name: 'AutoPost Facebook Page', user: '@autopost.fb', avatar: 'https://ui-avatars.com/api/?name=FB&background=1877F2&color=fff&size=150' },
      youtube: { name: 'AutoPost YouTube Channel', user: '@autopost_yt', avatar: 'https://ui-avatars.com/api/?name=YT&background=FF0000&color=fff&size=150' },
      tiktok: { name: 'AutoPost TikTok Creator', user: '@autopost.tiktok', avatar: 'https://ui-avatars.com/api/?name=TT&background=00F2EA&color=000&size=150' },
    };

    const info = mockInfo[platform] || { name: `Mock ${platform}`, user: `@mock_${platform}`, avatar: '' };

    const socialAccount = await this.prisma.socialAccount.upsert({
      where: {
        platform_platformAccountId: { platform, platformAccountId: mockAccountId },
      },
      update: {
        displayName: info.name,
        username: info.user,
        avatarUrl: info.avatar,
        accessToken: this.crypto.encrypt(`mock_access_token_${Date.now()}`),
        refreshToken: this.crypto.encrypt(`mock_refresh_token_${Date.now()}`),
        status: AccountStatus.active,
        workspaceId: validWorkspaceId,
      },
      create: {
        workspaceId: validWorkspaceId,
        platform,
        platformAccountId: mockAccountId,
        displayName: info.name,
        username: info.user,
        avatarUrl: info.avatar,
        accessToken: this.crypto.encrypt(`mock_access_token_${Date.now()}`),
        refreshToken: this.crypto.encrypt(`mock_refresh_token_${Date.now()}`),
        status: AccountStatus.active,
      },
    });

    return [socialAccount];
  }

  /**
   * Đảm bảo workspace tồn tại — tạo demo workspace nếu cần
   */
  private async ensureWorkspace(workspaceId: string): Promise<string> {
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (existing) return workspaceId;

    this.logger.log(`[ensureWorkspace] Tạo Demo workspace...`);

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

  /**
   * Cleanup PKCE entries quá hạn (> 10 phút)
   */
  private cleanupExpiredPKCE(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.pkceStore.entries()) {
      if (now - entry.createdAt > this.PKCE_TTL_MS) {
        this.pkceStore.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`[PKCE Cleanup] Đã xóa ${cleaned} entries hết hạn.`);
    }
  }
}
