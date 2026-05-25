import { Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import axios from 'axios';
import {
  SocialProviderInterface,
  ProviderCredentials,
  AuthResult,
  TokenRefreshResult,
  ProviderError,
} from './social-provider.interface';

/**
 * YouTube/Google OAuth Provider — Production-ready.
 * 
 * Flow: Google OAuth 2.0 → YouTube Data API v3
 * 1. generateAuthUrl() → redirect tới accounts.google.com
 * 2. User đăng nhập Google, chọn channel, authorize
 * 3. authenticate(code) → exchange code → access + refresh token → fetch channel info
 * 4. refreshToken() → dùng refresh_token lấy access_token mới (Google tokens expire sau 1h)
 */
@Injectable()
export class YouTubeProvider implements SocialProviderInterface {
  private readonly logger = new Logger(YouTubeProvider.name);

  readonly identifier = Platform.youtube;
  readonly name = 'YouTube Channel';
  readonly scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ];

  /**
   * Tạo URL đăng nhập Google OAuth THẬT
   */
  generateAuthUrl(credentials: ProviderCredentials, state: string): string {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      scope: this.scopes.join(' '),
      state,
      response_type: 'code',
      access_type: 'offline',    // Request refresh token
      prompt: 'consent',          // Force consent to always get refresh_token
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code → Google access/refresh tokens + YouTube channel info
   */
  async authenticate(code: string, credentials: ProviderCredentials): Promise<AuthResult> {
    this.logger.log('🔐 [YouTube] Bắt đầu exchange authorization code...');

    // Step 1: Exchange code → tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: credentials.redirectUri,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    this.logger.log('✅ [YouTube] Đã lấy được access token + refresh token.');

    // Step 2: Fetch YouTube channel info
    const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet,statistics', mine: true },
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const channel = channelResponse.data.items?.[0];
    if (!channel) {
      throw new Error('Không tìm thấy kênh YouTube nào liên kết với tài khoản Google này.');
    }

    this.logger.log(`✅ [YouTube] Kênh: "${channel.snippet.title}" (${channel.statistics.subscriberCount} subscribers)`);

    return {
      accounts: [{
        platformAccountId: channel.id,
        displayName: channel.snippet.title,
        username: channel.snippet.customUrl || `@yt_${channel.id}`,
        avatarUrl: channel.snippet.thumbnails?.default?.url || '',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + (expires_in || 3600) * 1000),
      }],
    };
  }

  /**
   * Refresh Google access token (expires every ~1 hour)
   */
  async refreshToken(
    refreshTokenValue: string,
    credentials: ProviderCredentials,
  ): Promise<TokenRefreshResult> {
    this.logger.log('🔄 [YouTube] Đang refresh access token...');

    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshTokenValue,
      grant_type: 'refresh_token',
    });

    this.logger.log('✅ [YouTube] Refresh token thành công.');

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token, // Google may rotate
      expiresIn: response.data.expires_in || 3600,
    };
  }

  /**
   * YouTube/Google API error handling
   */
  handleErrors(body: string, status: number): ProviderError | undefined {
    if (body.includes('quotaExceeded') || body.includes('dailyLimitExceeded')) {
      return { type: 'rate-limit', message: 'Đã vượt quota YouTube API hàng ngày (10,000 units).' };
    }

    if (body.includes('forbidden') || body.includes('insufficientPermissions')) {
      return { type: 'refresh-token', message: 'Không đủ quyền YouTube API. Vui lòng kết nối lại.' };
    }

    if (body.includes('invalid_grant') || body.includes('Token has been expired or revoked')) {
      return { type: 'refresh-token', message: 'Token Google đã hết hạn. Vui lòng kết nối lại.' };
    }

    if (body.includes('videoNotFound') || body.includes('uploadLimitExceeded')) {
      return { type: 'bad-body', message: 'Lỗi upload video YouTube. Kiểm tra dung lượng và định dạng.' };
    }

    if (status === 401) {
      return { type: 'refresh-token', message: 'Phiên đăng nhập Google đã hết hạn.' };
    }

    return undefined;
  }
}
