import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { Platform, AccountStatus } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Lấy danh sách các tài khoản MXH đã liên kết của một Workspace
   */
  async getAccounts(workspaceId: string): Promise<any[]> {
    return this.prisma.socialAccount.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      }
    });
  }

  /**
   * Tạo URL chuyển hướng đăng nhập OAuth tương ứng cho từng Platform
   */
  getAuthRedirectUrl(platform: Platform, workspaceId: string): string {
    const state = workspaceId; // State dùng để bảo vệ CSRF và truyền workspaceId qua callback

    if (platform === 'facebook') {
      const clientId = process.env.FACEBOOK_CLIENT_ID || 'mock_facebook_client_id';
      const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:3001/social-auth/callback/facebook';
      const scope = 'pages_show_list,pages_read_engagement,pages_manage_posts,public_profile';

      // Nếu đang dùng mock client id, chuyển hướng sang Mock OAuth page giả lập
      if (clientId.startsWith('mock_')) {
        return `http://localhost:3005/auth/mock-oauth?platform=facebook&state=${state}`;
      }

      return `https://www.facebook.com/v22.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${scope}&state=${state}&response_type=code`;
    }

    if (platform === 'youtube') {
      const clientId = process.env.GOOGLE_CLIENT_ID || 'mock_google_client_id';
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/social-auth/callback/youtube';
      const scope = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

      if (clientId.startsWith('mock_')) {
        return `http://localhost:3005/auth/mock-oauth?platform=youtube&state=${state}`;
      }

      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${encodeURIComponent(
        scope
      )}&state=${state}&response_type=code&access_type=offline&prompt=consent`;
    }

    if (platform === 'tiktok') {
      const clientKey = process.env.TIKTOK_CLIENT_KEY || 'mock_tiktok_client_key';
      const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3001/social-auth/callback/tiktok';
      const scope = 'user.info.basic,video.upload,video.publish';

      if (clientKey.startsWith('mock_')) {
        return `http://localhost:3005/auth/mock-oauth?platform=tiktok&state=${state}`;
      }

      return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${scope}&state=${state}&response_type=code`;
    }

    throw new Error(`Nền tảng ${platform} không hỗ trợ đăng nhập OAuth 2.0`);
  }

  /**
   * Xử lý trao đổi Code lấy Token sau khi người dùng xác thực thành công
   */
  async handleOAuthCallback(platform: Platform, code: string, workspaceId: string): Promise<any[]> {
    this.logger.log(`🔗 Đang xử lý OAuth callback cho platform: ${platform}, workspace: ${workspaceId}`);

    // MOCK OAUTH EXCHANGE FLOW
    if (code.startsWith('mock_code_') || process.env.NODE_ENV === 'test') {
      this.logger.log(`[MOCK] Thực hiện trao đổi Mock Code lấy Mock Tokens cho ${platform}...`);
      
      const mockAccountId = `mock_acc_${Math.random().toString(36).substring(7)}`;
      const mockDisplayName = `Mock ${platform.toUpperCase()} User`;
      const mockUsername = `@mock_${platform}`;
      const mockAvatar = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=60';
      const encryptedAccessToken = this.crypto.encrypt(`mock_access_token_${Date.now()}`);
      const encryptedRefreshToken = this.crypto.encrypt(`mock_refresh_token_${Date.now()}`);

      const socialAccount = await this.prisma.socialAccount.upsert({
        where: {
          platform_platformAccountId: {
            platform,
            platformAccountId: mockAccountId,
          },
        },
        update: {
          displayName: mockDisplayName,
          username: mockUsername,
          avatarUrl: mockAvatar,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          status: AccountStatus.active,
          workspaceId,
        },
        create: {
          workspaceId,
          platform,
          platformAccountId: mockAccountId,
          displayName: mockDisplayName,
          username: mockUsername,
          avatarUrl: mockAvatar,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          status: AccountStatus.active,
        },
      });

      return [socialAccount];
    }

    // REAL OAUTH EXCHANGE FLOWS
    if (platform === 'facebook') {
      return this.handleFacebookOAuth(code, workspaceId);
    }
    if (platform === 'youtube') {
      return this.handleYouTubeOAuth(code, workspaceId);
    }
    if (platform === 'tiktok') {
      return this.handleTikTokOAuth(code, workspaceId);
    }

    return [];
  }

  /**
   * Xử lý trao đổi Token & lấy Pages cho Facebook
   */
  private async handleFacebookOAuth(code: string, workspaceId: string): Promise<any[]> {
    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI;

    // 1. Trao đổi Auth Code lấy Short-Lived User Access Token
    const tokenResponse = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    const shortLivedToken = tokenResponse.data.access_token;

    // 2. Trao đổi User Token ngắn hạn lấy User Token dài hạn (60 ngày)
    const longLivedUserResponse = await axios.get('https://graph.facebook.com/v22.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: clientId,
        client_secret: clientSecret,
        fb_exchange_token: shortLivedToken,
      },
    });

    const longLivedUserToken = longLivedUserResponse.data.access_token;

    // 3. Lấy danh sách Facebook Pages quản lý bởi User (Mỗi Page trả về Long-Lived Page Access Token "Never Expires")
    const pagesResponse = await axios.get('https://graph.facebook.com/v22.0/me/accounts', {
      params: { access_token: longLivedUserToken },
    });

    const pages = pagesResponse.data.data || [];
    const connectedAccounts = [];

    for (const page of pages) {
      const encryptedAccessToken = this.crypto.encrypt(page.access_token);
      
      const socialAccount = await this.prisma.socialAccount.upsert({
        where: {
          platform_platformAccountId: {
            platform: Platform.facebook,
            platformAccountId: page.id,
          },
        },
        update: {
          displayName: page.name,
          username: `@fbpage_${page.id}`,
          avatarUrl: `https://graph.facebook.com/v22.0/${page.id}/picture?type=normal`,
          accessToken: encryptedAccessToken,
          status: AccountStatus.active,
          workspaceId,
        },
        create: {
          workspaceId,
          platform: Platform.facebook,
          platformAccountId: page.id,
          displayName: page.name,
          username: `@fbpage_${page.id}`,
          avatarUrl: `https://graph.facebook.com/v22.0/${page.id}/picture?type=normal`,
          accessToken: encryptedAccessToken,
          status: AccountStatus.active,
        },
      });

      connectedAccounts.push(socialAccount);
    }

    return connectedAccounts;
  }

  /**
   * Xử lý trao đổi Token & lấy Channel cho Google/YouTube
   */
  private async handleYouTubeOAuth(code: string, workspaceId: string): Promise<any[]> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    // 1. Trao đổi Auth Code lấy Access Token và Refresh Token dài hạn
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // 2. Fetch thông tin YouTube Channel của người dùng
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'snippet',
        mine: true,
      },
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const channel = channelResponse.data.items?.[0];
    if (!channel) {
      throw new Error('Không tìm thấy kênh YouTube tương ứng với tài khoản Google này.');
    }

    const encryptedAccessToken = this.crypto.encrypt(access_token);
    const encryptedRefreshToken = refresh_token ? this.crypto.encrypt(refresh_token) : undefined;

    const socialAccount = await this.prisma.socialAccount.upsert({
      where: {
        platform_platformAccountId: {
          platform: Platform.youtube,
          platformAccountId: channel.id,
        },
      },
      update: {
        displayName: channel.snippet.title,
        username: channel.snippet.customUrl || `@yt_${channel.id}`,
        avatarUrl: channel.snippet.thumbnails?.default?.url,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken || undefined,
        tokenExpiresAt,
        status: AccountStatus.active,
        workspaceId,
      },
      create: {
        workspaceId,
        platform: Platform.youtube,
        platformAccountId: channel.id,
        displayName: channel.snippet.title,
        username: channel.snippet.customUrl || `@yt_${channel.id}`,
        avatarUrl: channel.snippet.thumbnails?.default?.url,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        status: AccountStatus.active,
      },
    });

    return [socialAccount];
  }

  /**
   * Xử lý trao đổi Token & lấy User Profile cho TikTok
   */
  private async handleTikTokOAuth(code: string, workspaceId: string): Promise<any[]> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    // 1. Trao đổi Auth Code lấy Access Token TikTok
    const tokenResponse = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // 2. Lấy TikTok User Profile info
    const userProfileResponse = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      params: {
        fields: 'open_id,union_id,avatar_url,display_name,username',
      },
    });

    const user = userProfileResponse.data.data?.user;
    if (!user) {
      throw new Error('Không thể tải thông tin profile người dùng từ TikTok API.');
    }

    const encryptedAccessToken = this.crypto.encrypt(access_token);
    const encryptedRefreshToken = refresh_token ? this.crypto.encrypt(refresh_token) : undefined;

    const socialAccount = await this.prisma.socialAccount.upsert({
      where: {
        platform_platformAccountId: {
          platform: Platform.tiktok,
          platformAccountId: user.open_id,
        },
      },
      update: {
        displayName: user.display_name || user.username,
        username: `@${user.username}`,
        avatarUrl: user.avatar_url,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken || undefined,
        tokenExpiresAt,
        status: AccountStatus.active,
        workspaceId,
      },
      create: {
        workspaceId,
        platform: Platform.tiktok,
        platformAccountId: user.open_id,
        displayName: user.display_name || user.username,
        username: `@${user.username}`,
        avatarUrl: user.avatar_url,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        status: AccountStatus.active,
      },
    });

    return [socialAccount];
  }

  /**
   * Refresh token cho một tài khoản cụ thể
   */
  async refreshAccountToken(socialAccountId: string): Promise<string> {
    const acc = await this.prisma.socialAccount.findUnique({
      where: { id: socialAccountId }
    });
    if (!acc) throw new Error(`Social account not found: ${socialAccountId}`);
    if (!acc.refreshToken) return this.crypto.decrypt(acc.accessToken);

    const decryptedRefreshToken = this.crypto.decrypt(acc.refreshToken);

    let newAccessToken = '';
    let newRefreshToken = acc.refreshToken;
    let expiresIn = 3600;

    try {
      if (acc.platform === 'youtube') {
        const response = await axios.post('https://oauth2.googleapis.com/token', {
          client_id: process.env.GOOGLE_CLIENT_ID || 'mock_google_client_id',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || 'mock_google_client_secret',
          refresh_token: decryptedRefreshToken,
          grant_type: 'refresh_token'
        });
        
        newAccessToken = response.data.access_token;
        expiresIn = response.data.expires_in;
        if (response.data.refresh_token) {
          newRefreshToken = this.crypto.encrypt(response.data.refresh_token);
        }
      } else if (acc.platform === 'tiktok') {
        const response = await axios.post(
          'https://open.tiktokapis.com/v2/oauth/token/',
          new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY || 'mock_tiktok_client_key',
            client_secret: process.env.TIKTOK_CLIENT_SECRET || 'mock_tiktok_client_secret',
            grant_type: 'refresh_token',
            refresh_token: decryptedRefreshToken
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );

        newAccessToken = response.data.access_token;
        expiresIn = response.data.expires_in;
        if (response.data.refresh_token) {
          newRefreshToken = this.crypto.encrypt(response.data.refresh_token);
        }
      } else {
        return this.crypto.decrypt(acc.accessToken);
      }

      if (newAccessToken) {
        const encryptedAccessToken = this.crypto.encrypt(newAccessToken);
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

        await this.prisma.socialAccount.update({
          where: { id: socialAccountId },
          data: {
            accessToken: encryptedAccessToken,
            refreshToken: newRefreshToken,
            tokenExpiresAt,
            status: AccountStatus.active
          }
        });

        this.logger.log(`✅ [refreshAccountToken] Refresh thành công token cho ${acc.displayName} (${acc.platform}).`);
        return newAccessToken;
      }
    } catch (err: any) {
      this.logger.error(`❌ [refreshAccountToken] Refresh thất bại cho ${acc.displayName} (${acc.platform}): ${err.message}`);
      if (decryptedRefreshToken.startsWith('mock_')) {
        return this.crypto.decrypt(acc.accessToken);
      }
      throw err;
    }

    return this.crypto.decrypt(acc.accessToken);
  }

  /**
   * Quét và làm mới các token sắp hết hạn trong 24 giờ tới (dành cho Hourly Cron Job)
   */
  async refreshExpiringTokens(): Promise<number> {
    const twentyFourHours = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiringAccounts = await this.prisma.socialAccount.findMany({
      where: {
        tokenExpiresAt: {
          lte: twentyFourHours
        },
        refreshToken: {
          not: null
        }
      }
    });

    this.logger.log(`⏳ [Early Refresh Cron] Phát hiện ${expiringAccounts.length} tài khoản sắp hết hạn token trong 24h tới. Đang xử lý...`);

    let successCount = 0;
    for (const acc of expiringAccounts) {
      try {
        await this.refreshAccountToken(acc.id);
        successCount++;
      } catch (err) {
        this.logger.error(`[Early Refresh Cron] Lỗi khi làm mới token của ${acc.displayName} (ID: ${acc.id})`);
      }
    }

    return successCount;
  }
}
