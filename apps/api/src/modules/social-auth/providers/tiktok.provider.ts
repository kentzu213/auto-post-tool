import { Injectable, Logger } from '@nestjs/common';
import { Platform } from '@prisma/client';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  SocialProviderInterface,
  ProviderCredentials,
  AuthResult,
  TokenRefreshResult,
  ProviderError,
} from './social-provider.interface';

/**
 * TikTok OAuth Provider — Production-ready with proper PKCE.
 * 
 * Flow: TikTok Login Kit v2 → Content Posting API
 * 1. generateAuthUrl() → tạo code_verifier + code_challenge → redirect tới tiktok.com/v2/auth/authorize
 * 2. User đăng nhập TikTok, authorize
 * 3. authenticate(code, credentials, codeVerifier) → exchange code → access + refresh token → fetch user info
 * 4. refreshToken() → TikTok tokens expire sau 24h, refresh token valid 365 ngày
 * 
 * PKCE Requirements (TikTok-specific):
 * - code_verifier: random string, 43-128 characters, [A-Za-z0-9-._~]
 * - code_challenge: SHA-256(code_verifier) encoded as **HEX** (NOT base64url!)
 * - code_challenge_method: S256
 * - Mỗi request phải tạo cặp MỚI
 */
@Injectable()
export class TikTokProvider implements SocialProviderInterface {
  private readonly logger = new Logger(TikTokProvider.name);

  readonly identifier = Platform.tiktok;
  readonly name = 'TikTok Account';
  readonly scopes = [
    'user.info.basic',
    'video.upload',
    'video.publish',
  ];

  private readonly API_BASE = 'https://open.tiktokapis.com/v2';

  /**
   * Tạo PKCE code_verifier ngẫu nhiên (43-128 chars, URL-safe)
   */
  generateCodeVerifier(): string {
    // Tạo 64 bytes random → encode base64url → cắt lấy 96 ký tự
    const verifier = crypto.randomBytes(64)
      .toString('base64url')
      .replace(/[^A-Za-z0-9\-._~]/g, '') // Chỉ giữ ký tự hợp lệ PKCE
      .slice(0, 96); // Đảm bảo trong khoảng 43-128
    
    this.logger.debug(`[TikTok PKCE] Generated code_verifier (length=${verifier.length})`);
    return verifier;
  }

  /**
   * Tạo code_challenge = SHA-256(code_verifier) dạng HEX
   * 
   * ⚠️ TikTok yêu cầu HEX encoding, KHÔNG phải base64url như chuẩn OAuth 2.0
   */
  generateCodeChallenge(codeVerifier: string): string {
    const challenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('hex'); // TikTok-specific: HEX encoding
    
    this.logger.debug(`[TikTok PKCE] Generated code_challenge (hex, length=${challenge.length})`);
    return challenge;
  }

  /**
   * Tạo URL đăng nhập TikTok OAuth + PKCE
   * 
   * Returns: { url, codeVerifier } — codeVerifier phải được lưu lại cho bước exchange token
   */
  generateAuthUrlWithPKCE(credentials: ProviderCredentials, state: string): { url: string; codeVerifier: string } {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_key: credentials.clientId,
      redirect_uri: credentials.redirectUri,
      scope: this.scopes.join(','),
      state,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

    this.logger.log(`🔗 [TikTok] Auth URL generated with PKCE (code_challenge=${codeChallenge.slice(0, 16)}...)`);
    this.logger.debug(`[TikTok] redirect_uri=${credentials.redirectUri}`);

    return { url, codeVerifier };
  }

  /**
   * Backward-compatible generateAuthUrl — vẫn trả string URL
   * Nhưng codeVerifier sẽ không được lưu → nên dùng generateAuthUrlWithPKCE thay thế
   */
  generateAuthUrl(credentials: ProviderCredentials, state: string): string {
    const { url } = this.generateAuthUrlWithPKCE(credentials, state);
    return url;
  }

  /**
   * Exchange authorization code → TikTok access/refresh tokens + user profile
   * 
   * @param code - Authorization code từ TikTok callback
   * @param credentials - Client credentials
   * @param codeVerifier - PKCE code_verifier đã tạo ở bước generateAuthUrlWithPKCE
   */
  async authenticate(code: string, credentials: ProviderCredentials, codeVerifier?: string): Promise<AuthResult> {
    this.logger.log('🔐 [TikTok] Bắt đầu exchange authorization code...');

    if (!codeVerifier) {
      this.logger.warn('⚠️ [TikTok] Không có code_verifier! Token exchange có thể thất bại.');
    }

    // Step 1: Exchange code → tokens
    const tokenBody: Record<string, string> = {
      client_key: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: credentials.redirectUri,
    };

    // Chỉ thêm code_verifier nếu có (PKCE)
    if (codeVerifier) {
      tokenBody.code_verifier = codeVerifier;
    }

    this.logger.debug(`[TikTok] Token exchange body keys: ${Object.keys(tokenBody).join(', ')}`);

    let tokenResponse: any;
    try {
      tokenResponse = await axios.post(
        `${this.API_BASE}/oauth/token/`,
        new URLSearchParams(tokenBody).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
    } catch (err: any) {
      const errorData = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      this.logger.error(`❌ [TikTok] Token exchange thất bại: ${errorData}`);
      throw new Error(`TikTok token exchange thất bại: ${errorData}`);
    }

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    
    if (!access_token) {
      const errorMsg = tokenResponse.data?.error_description || tokenResponse.data?.error || 'Không nhận được access_token';
      this.logger.error(`❌ [TikTok] Token response thiếu access_token: ${JSON.stringify(tokenResponse.data)}`);
      throw new Error(`TikTok OAuth thất bại: ${errorMsg}`);
    }

    this.logger.log('✅ [TikTok] Đã lấy được access token + refresh token.');

    // Step 2: Fetch user profile
    let user: any;
    try {
      const userResponse = await axios.get(`${this.API_BASE}/user/info/`, {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { fields: 'open_id,union_id,avatar_url,display_name,username' },
      });
      user = userResponse.data.data?.user;
    } catch (err: any) {
      this.logger.error(`❌ [TikTok] Lỗi khi lấy user info: ${err.message}`);
      throw new Error('Không thể tải thông tin profile TikTok. Vui lòng thử lại.');
    }

    if (!user) {
      throw new Error('Không thể tải thông tin profile TikTok. Vui lòng thử lại.');
    }

    this.logger.log(`✅ [TikTok] User: "${user.display_name}" (@${user.username})`);

    return {
      accounts: [{
        platformAccountId: user.open_id,
        displayName: user.display_name || user.username,
        username: `@${user.username}`,
        avatarUrl: user.avatar_url || '',
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiresAt: new Date(Date.now() + (expires_in || 86400) * 1000),
      }],
    };
  }

  /**
   * Refresh TikTok access token (expires every ~24h, refresh token valid 365 days)
   */
  async refreshToken(
    refreshTokenValue: string,
    credentials: ProviderCredentials,
  ): Promise<TokenRefreshResult> {
    this.logger.log('🔄 [TikTok] Đang refresh access token...');

    const response = await axios.post(
      `${this.API_BASE}/oauth/token/`,
      new URLSearchParams({
        client_key: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshTokenValue,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    this.logger.log('✅ [TikTok] Refresh token thành công.');

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in || 86400,
    };
  }

  /**
   * TikTok API error handling
   */
  handleErrors(body: string, status: number): ProviderError | undefined {
    if (body.includes('access_token_invalid') || body.includes('token_expired')) {
      return { type: 'refresh-token', message: 'Token TikTok đã hết hạn. Vui lòng kết nối lại.' };
    }

    if (body.includes('rate_limit_exceeded') || body.includes('spam_risk_too_many_posts')) {
      return { type: 'rate-limit', message: 'Đã vượt giới hạn đăng bài TikTok. Vui lòng chờ.' };
    }

    if (body.includes('video_review_failed') || body.includes('content_violation')) {
      return { type: 'bad-body', message: 'Video vi phạm chính sách nội dung TikTok.' };
    }

    if (body.includes('scope_not_authorized')) {
      return { type: 'refresh-token', message: 'Thiếu quyền TikTok. Vui lòng kết nối lại với đầy đủ quyền.' };
    }

    if (status === 401) {
      return { type: 'refresh-token', message: 'Phiên đăng nhập TikTok đã hết hạn.' };
    }

    return undefined;
  }
}
