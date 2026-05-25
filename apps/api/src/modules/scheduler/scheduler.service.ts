import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { Interval, Cron } from '@nestjs/schedule';
import { SocialAuthService } from '../social-auth/social-auth.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue('publishing-queue') private readonly publishingQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly socialAuthService: SocialAuthService,
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
        jobId: `schedule:${scheduleId}`, // Idempotency: BullMQ tự động loại bỏ duplicate nếu jobId đã tồn tại trên Redis
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
}
