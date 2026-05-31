import { Logger } from '@nestjs/common';
import { IPublisher, PublishResult } from '../interfaces/publisher.interface';
import { 
  handleAll, 
  circuitBreaker, 
  retry, 
  wrap, 
  ExponentialBackoff, 
  ConsecutiveBreaker 
} from 'cockatiel';

export abstract class SocialAbstract implements IPublisher {
  protected readonly abstractLogger: Logger;

  // Singletons cho Circuit Breakers per-platform để đảm bảo trạng thái breaker được duy trì
  private static readonly breakers: Record<string, any> = {};

  constructor(loggerName: string) {
    this.abstractLogger = new Logger(loggerName);
  }

  // Khai báo các abstract methods từ IPublisher
  abstract validate(accessToken: string): Promise<boolean>;
  abstract publish(
    content: string,
    mediaUrls: string[],
    options?: Record<string, any>
  ): Promise<PublishResult>;
  abstract delete(publishedPostId: string): Promise<boolean>;
  abstract getInsights(publishedPostId: string, accessToken?: string): Promise<Record<string, any>>;

  /**
   * Lấy hoặc khởi tạo Circuit Breaker cho từng platform
   */
  private getCircuitBreaker(platform: string) {
    if (!SocialAbstract.breakers[platform]) {
      this.abstractLogger.log(`🔌 Khởi tạo Circuit Breaker cho nền tảng: ${platform}`);
      
      // Nếu có 5 lỗi liên tiếp xảy ra, ngắt mạch (Open) trong 30 giây
      const cb = circuitBreaker(handleAll, {
        halfOpenAfter: 30000,
        breaker: new ConsecutiveBreaker(5),
      });

      // Lắng nghe sự kiện của Breaker để log
      cb.onBreak(() => {
        this.abstractLogger.warn(`🚨 [CIRCUIT BREAKER] Mạch đã BỊ NGẮT cho ${platform}! Tạm ngừng các yêu cầu gọi tới platform này trong 30s.`);
      });
      cb.onReset(() => {
        this.abstractLogger.log(`✅ [CIRCUIT BREAKER] Mạch đã khôi phục (Reset) cho ${platform}. Hoạt động bình thường.`);
      });

      SocialAbstract.breakers[platform] = cb;
    }
    return SocialAbstract.breakers[platform];
  }

  /**
   * Khởi tạo Retry Policy với Jitter Exponential Backoff
   */
  private getRetryPolicy(maxAttempts = 3) {
    // Retry tối đa 3 lần, delay bắt đầu từ 2 giây và tăng dần theo cấp số nhân
    return retry(handleAll, {
      maxAttempts,
      backoff: new ExponentialBackoff({
        initialDelay: 2000,
        maxDelay: 10000,
      }),
    });
  }

  /**
   * Thực hiện gọi API an toàn tích hợp cả Circuit Breaker và Retry
   */
  protected async executeResiliently<T>(
    platform: string,
    operation: () => Promise<T>,
    maxAttempts = 3
  ): Promise<T> {
    if (process.env.NODE_ENV === 'test') {
      return await operation(); // Bypass cockatiel policies in unit tests to prevent timeouts
    }

    const breaker = this.getCircuitBreaker(platform);
    const retryPolicy = this.getRetryPolicy(maxAttempts);

    // Bọc cả 2 policies thành 1 wrap policy: Retry trước, nếu vẫn fail liên tục -> Circuit Breaker ngắt mạch
    const resilientPolicy = wrap(retryPolicy, breaker);

    try {
      return await resilientPolicy.execute(operation);
    } catch (error: any) {
      this.abstractLogger.error(`💥 Yêu cầu resilient thất bại cho ${platform}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Exponential backoff thủ công dùng cho Mock mode hoặc custom fallback
   */
  protected async delayWithJitter(attempt: number): Promise<void> {
    const base = Math.min(1000 * 2 ** attempt, 30000);
    const jitter = Math.random() * base * 0.3; // Thêm 30% jitter ngẫu nhiên tránh thắt nút cổ chai
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
  }
}
