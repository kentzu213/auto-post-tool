import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { Interval, Cron } from '@nestjs/schedule';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { CryptoService } from '../../common/services/crypto.service';
import { FacebookPublisher } from '../publisher/services/facebook.publisher';
import { YouTubePublisher } from '../publisher/services/youtube.publisher';
import { TikTokPublisher } from '../publisher/services/tiktok.publisher';
import { Platform } from '@prisma/client';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue('publishing-queue') private readonly publishingQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly socialAuthService: SocialAuthService,
    private readonly crypto: CryptoService,
    private readonly facebookPublisher: FacebookPublisher,
    private readonly youtubePublisher: YouTubePublisher,
    private readonly tiktokPublisher: TikTokPublisher,
  ) {}

  onModuleInit() {
    this.logger.log('📅 Advanced Scheduler & Queue Service initialized. Outbox Sweeper is active.');
    // Chạy outbox sweeper ngay khi khởi động để nạp lại các delayed jobs nếu Redis bị mất dữ liệu
    this.outboxSweeper();
  }

  /**
   * Đẩy bài đăng vào Queue BullMQ dạng Delayed Job (Idempotent theo scheduleId)
   */
  async addDelayedPublishJob(scheduleId: string, scheduledAt: Date, priority = 10) {
    const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now());
    
    this.logger.log(
      `📥 Đăng ký delayed job cho Schedule ID ${scheduleId} (Delay: ${Math.floor(delay / 1000)} giây, Priority: ${priority})`
    );

    // Enqueue job với delayed options và unique jobId
    await this.publishingQueue.add(
      'publish-post',
      { scheduleId },
      {
        delay,
        jobId: `schedule_${scheduleId}`, // Idempotency: BullMQ tự động loại bỏ duplicate nếu jobId đã tồn tại trên Redis
        priority, // Hỗ trợ hàng đợi ưu tiên (1 = Cao nhất, 10 = Mặc định)
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 1000, // Tối ưu hóa dọn dẹp Redis
        },
        removeOnFail: false, // Lưu logs lỗi trong Redis để giám sát
      }
    );
  }

  /**
   * API công khai để tạo bài và lên lịch đăng bài lập tức
   */
  async scheduleNewPost(scheduleId: string, scheduledAt: Date, priority = 10) {
    // 1. Cập nhật trạng thái trong database
    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: { status: 'scheduled' },
    });

    // 2. Enqueue trực tiếp BullMQ với delay tính toán
    await this.addDelayedPublishJob(scheduleId, scheduledAt, priority);
  }

  /**
   * Outbox Sweeper: Quét DB định kỳ 5 phút bảo vệ hệ thống khỏi thất lạc Jobs.
   * Sử dụng cơ chế khóa PostgreSQL "FOR UPDATE SKIP LOCKED" để loại bỏ hoàn toàn tranh chấp giữa các Cluster API nodes.
   */
  @Interval(300000) // 5 phút (300,000ms)
  async outboxSweeper() {
    this.logger.log('🕒 [Outbox Sweeper] Bắt đầu quét và đồng bộ các delayed jobs từ Database lên Redis...');

    try {
      // 1. Quét tìm các schedule đang trạng thái 'scheduled' có thời gian đăng nằm trong vòng 10 phút tới
      // Sử dụng FOR UPDATE SKIP LOCKED để khóa các dòng dữ liệu đang xử lý, loại bỏ tranh chấp giữa các instances.
      const now = new Date();
      const next10Min = new Date(now.getTime() + 10 * 60_000);

      const pendingSchedules: any[] = await this.prisma.$queryRaw`
        SELECT s.*, p."workspaceId" 
        FROM "schedules" s
        JOIN "posts" p ON s."postId" = p."id"
        WHERE s."status" = 'scheduled' AND s."scheduledAt" <= ${next10Min}
        FOR UPDATE SKIP LOCKED
      `;

      if (pendingSchedules.length === 0) {
        this.logger.log('ℹ️ [Outbox Sweeper] Không phát hiện bài đăng nào bị thất lạc.');
        return;
      }

      this.logger.log(`🔥 [Outbox Sweeper] Phát hiện ${pendingSchedules.length} schedules sắp đến hạn đăng. Tiến hành khôi phục trên Redis...`);

      for (const rawSchedule of pendingSchedules) {
        // Kiểm tra xem User của Workspace đó có phải là Premium hay không để gán priority thích hợp
        // Đối với mock demo, ta mặc định priority cao cho owner
        const priority = 10;

        // Đẩy bù lại Delayed Job lên BullMQ (nếu đã có trên Redis, BullMQ sẽ bỏ qua nhờ cấu hình jobId)
        await this.addDelayedPublishJob(rawSchedule.id, rawSchedule.scheduledAt, priority);
      }

      this.logger.log('✔ [Outbox Sweeper] Khôi phục và đồng bộ hoàn thành.');
    } catch (error: any) {
      this.logger.error(`💥 [Outbox Sweeper] Lỗi trong quá trình quét outbox: ${error.message}`);
    }
  }

  /**
   * Hourly early token refresh: Quét và tự động làm mới các token sắp hết hạn trong 24h tới
   */
  @Cron('0 * * * *') // Chạy mỗi giờ
  async earlyTokenRefreshCron() {
    this.logger.log('🕒 [Early Token Refresh Cron] Bắt đầu quét các tài khoản MXH sắp hết hạn token...');
    try {
      const refreshedCount = await this.socialAuthService.refreshExpiringTokens();
      this.logger.log(`✔ [Early Token Refresh Cron] Đã tự động làm mới thành công ${refreshedCount} tài khoản.`);
    } catch (error: any) {
      this.logger.error(`💥 [Early Token Refresh Cron] Lỗi khi chạy cron early refresh: ${error.message}`);
    }
  }

  /**
   * Đồng bộ số liệu THỰC TẾ từ nền tảng MXH về bảng Analytics — chạy mỗi 15 phút.
   *
   * Vì sao đặt ở API process (SchedulerService) thay vì worker:
   *   Worker (apps/worker) là tiến trình tách biệt, KHÔNG nằm trong Nest DI container nên
   *   không truy cập được các Publisher service. Đặt job tại đây cho phép tái sử dụng trực
   *   tiếp publisher.getInsights() đã có sẵn (vốn là dead code trước đây) qua Nest DI.
   *
   * Nguyên tắc TRUNG THỰC & degrade gracefully:
   *   - Chỉ xử lý các SocialAccount status='active'.
   *   - Chỉ xử lý Schedule status='published', có publishedPostId, và đăng trong N ngày gần đây
   *     (giới hạn chi phí gọi API).
   *   - Tài khoản/token MOCK (token giải mã bắt đầu bằng 'mock_') hoặc publishedPostId chứa
   *     '_mock_' → BỎ QUA, không bịa số liệu (getInsights của publisher trả random cho id mock,
   *     nên ta KHÔNG gọi nó cho các bài mock). Dashboard sẽ hiển thị nhãn "demo" một cách trung thực.
   *   - Lỗi rate-limit / token / API → getInsights trả về {} → GIỮ NGUYÊN bản ghi Analytics cũ,
   *     log cảnh báo và tiếp tục. KHÔNG xóa, KHÔNG random-fill.
   *   - Dùng upsert theo @unique scheduleId để re-sync cập nhật tại chỗ và đóng dấu updatedAt.
   */
  @Interval(15 * 60 * 1000) // 15 phút
  async syncRealAnalytics() {
    this.logger.log('📈 [Analytics Sync] Bắt đầu đồng bộ số liệu thực tế từ các nền tảng MXH...');

    const RECENT_DAYS = 7;
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

    let synced = 0;
    let skipped = 0;
    let degraded = 0;

    try {
      const accounts = await this.prisma.socialAccount.findMany({
        where: { status: 'active' },
      });

      for (const account of accounts) {
        // Giải mã token (tái sử dụng cùng cơ chế crypto của hệ thống). Lỗi giải mã → bỏ qua account.
        let accessToken: string;
        try {
          accessToken = this.crypto.decrypt(account.accessToken);
        } catch (e: any) {
          this.logger.warn(`⚠️ [Analytics Sync] Không giải mã được token của ${account.displayName}: ${e.message}. Bỏ qua.`);
          continue;
        }

        const isMockToken = accessToken.startsWith('mock_');

        const schedules = await this.prisma.schedule.findMany({
          where: {
            socialAccountId: account.id,
            status: 'published',
            publishedPostId: { not: null },
            scheduledAt: { gte: since },
          },
        });

        for (const schedule of schedules) {
          const publishedPostId = schedule.publishedPostId as string;

          // MOCK/DEMO: không bịa số liệu. Bỏ qua để dashboard hiển thị nhãn demo trung thực.
          if (isMockToken || publishedPostId.includes('_mock_')) {
            skipped++;
            continue;
          }

          try {
            const insights = await this.fetchInsights(account.platform, publishedPostId, accessToken);

            // getInsights trả {} khi lỗi rate-limit/token/API → giữ nguyên bản ghi cũ.
            if (!insights || Object.keys(insights).length === 0) {
              degraded++;
              this.logger.warn(
                `⚠️ [Analytics Sync] Không lấy được insights cho schedule ${schedule.id} (${account.platform}). Giữ nguyên số liệu cũ.`,
              );
              continue;
            }

            const data = this.normalizeInsights(insights);
            await this.prisma.analytics.upsert({
              where: { scheduleId: schedule.id },
              create: { scheduleId: schedule.id, ...data },
              update: data,
            });
            synced++;
          } catch (err: any) {
            // Bất kỳ lỗi ngoài dự kiến nào: GIỮ NGUYÊN dữ liệu cũ, log và tiếp tục.
            degraded++;
            this.logger.warn(
              `⚠️ [Analytics Sync] Lỗi đồng bộ schedule ${schedule.id} (${account.platform}): ${err.message}. Giữ nguyên số liệu cũ.`,
            );
          }
        }
      }

      this.logger.log(
        `✔ [Analytics Sync] Hoàn tất. Đã đồng bộ ${synced} bài, bỏ qua ${skipped} bài mock/demo, giữ nguyên ${degraded} bài do lỗi/không có dữ liệu.`,
      );
    } catch (error: any) {
      this.logger.error(`💥 [Analytics Sync] Lỗi tổng thể khi đồng bộ analytics: ${error.message}`);
    }
  }

  /**
   * Gọi getInsights() của publisher tương ứng theo nền tảng, truyền access token đã giải mã.
   * Publisher tự xử lý resilience (circuit breaker + retry) và trả {} khi lỗi/không có dữ liệu.
   */
  private async fetchInsights(
    platform: Platform,
    publishedPostId: string,
    accessToken: string,
  ): Promise<Record<string, any>> {
    switch (platform) {
      case 'facebook':
        return this.facebookPublisher.getInsights(publishedPostId, accessToken);
      case 'youtube':
        return this.youtubePublisher.getInsights(publishedPostId, accessToken);
      case 'tiktok':
        return this.tiktokPublisher.getInsights(publishedPostId, accessToken);
      default:
        return {};
    }
  }

  /**
   * Chuẩn hóa kết quả insights (mỗi nền tảng trả tập field khác nhau) về schema Analytics.
   * Field nào nền tảng không trả → mặc định 0 (chỉ phản ánh đúng dữ liệu API cung cấp).
   */
  private normalizeInsights(insights: Record<string, any>) {
    const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      reach: Math.round(num(insights.reach)),
      impressions: Math.round(num(insights.impressions)),
      engagement: Math.round(num(insights.engagement)),
      views: Math.round(num(insights.views)),
      watchTime: num(insights.watchTime),
      clicks: Math.round(num(insights.clicks)),
      shares: Math.round(num(insights.shares)),
      comments: Math.round(num(insights.comments)),
      likes: Math.round(num(insights.likes)),
      saves: Math.round(num(insights.saves)),
    };
  }
}
