import { Platform } from '@prisma/client';

/**
 * Thông tin credentials của một OAuth Provider.
 * Được decrypt từ DB hoặc lấy từ .env trước khi truyền vào provider.
 */
export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Kết quả sau khi exchange OAuth code thành công.
 */
export interface AuthResult {
  accounts: AuthAccountInfo[];
}

export interface AuthAccountInfo {
  platformAccountId: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  accessToken: string;      // Plaintext — sẽ được encrypt trước khi lưu DB
  refreshToken?: string;    // Plaintext
  tokenExpiresAt?: Date;
}

/**
 * Kết quả sau khi refresh token.
 */
export interface TokenRefreshResult {
  accessToken: string;       // Plaintext — new access token
  refreshToken?: string;     // Plaintext — new refresh token (nếu rotation)
  expiresIn: number;         // Seconds
}

/**
 * Kết quả xử lý lỗi từ API response.
 */
export interface ProviderError {
  type: 'refresh-token' | 'bad-body' | 'rate-limit';
  message: string;
}

/**
 * Interface chuẩn cho tất cả Social Providers.
 * Mỗi platform (Facebook, YouTube, TikTok) phải implement interface này.
 * 
 * Pattern tham khảo từ Postiz (gitroomhq/postiz-app):
 * - generateAuthUrl() tạo URL redirect tới OAuth provider thật
 * - authenticate() exchange authorization code lấy access token thật
 * - refreshToken() làm mới token khi hết hạn
 * - handleErrors() xử lý lỗi API cụ thể cho từng platform
 */
export interface SocialProviderInterface {
  /** Identifier duy nhất: 'facebook' | 'youtube' | 'tiktok' */
  identifier: Platform;

  /** Tên hiển thị */
  name: string;

  /** OAuth scopes yêu cầu */
  scopes: string[];

  /**
   * Tạo URL chuyển hướng tới OAuth provider thật (facebook.com, google.com, tiktok.com)
   */
  generateAuthUrl(credentials: ProviderCredentials, state: string): string;

  /**
   * Exchange authorization code → access token + user/page info
   * Đây là bước QUAN TRỌNG NHẤT — lấy token thật từ platform
   */
  authenticate(
    code: string,
    credentials: ProviderCredentials,
  ): Promise<AuthResult>;

  /**
   * Làm mới access token bằng refresh token
   */
  refreshToken(
    refreshTokenValue: string,
    credentials: ProviderCredentials,
  ): Promise<TokenRefreshResult>;

  /**
   * Phân tích lỗi từ API response body — trả về loại lỗi cụ thể
   */
  handleErrors(body: string, status: number): ProviderError | undefined;
}
