import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/services/crypto.service';
import { Platform, SocialAccount } from '@prisma/client';

/**
 * InboxIngestionService — Nạp tin nhắn/bình luận THẬT từ các nền tảng MXH vào bảng InboxMessage.
 *
 * Nguyên tắc TRUNG THỰC (mirror SchedulerService.syncRealAnalytics):
 *   - Chỉ xử lý SocialAccount status='active'.
 *   - Token MOCK (giải mã bắt đầu 'mock_') → BỎ QUA hoàn toàn, KHÔNG bịa dữ liệu. UI sẽ rỗng một
 *     cách trung thực thay vì hiển thị tin giả.
 *   - Lỗi rate-limit / token hết hạn / API trả lỗi → log cảnh báo, GIỮ NGUYÊN các bản ghi cũ,
 *     bỏ qua account đó. KHÔNG xóa, KHÔNG fabricate.
 *   - Workspace của tin nhắn luôn được suy ra từ FK SocialAccount.workspaceId phía server,
 *     KHÔNG nhận từ input client (tuân theo hướng workspace-authorization).
 *
 * Dedupe key:
 *   InboxMessage không có cột external-id riêng, nên ta đặt chính khóa chính `id` =
 *   `"{socialAccountId}:{platform}:{externalId}"` (externalId = message id của FB / comment id
 *   của YouTube). upsert theo `where: { id }` đảm bảo idempotent: chạy lại không tạo bản ghi trùng
 *   và KHÔNG ghi đè cờ isRead (nhánh update không đụng tới isRead).
 */
@Injectable()
export class InboxIngestionService {
  private readonly logger = new Logger(InboxIngestionService.name);
  private readonly fbBaseUrl = 'https://graph.facebook.com/v22.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Poll định kỳ (3 phút) toàn bộ account active của hệ thống — chạy phía server, không phụ thuộc
   * input client. Workspace suy ra từ FK của từng account.
   */
  @Interval(3 * 60 * 1000)
  async pollAllAccounts() {
    const accounts = await this.prisma.socialAccount.findMany({ where: { status: 'active' } });
    if (accounts.length === 0) return;

    this.logger.log(`📥 [Inbox Ingestion] Bắt đầu poll ${accounts.length} tài khoản active...`);
    const summary = await this.syncAccounts(accounts);
    this.logger.log(
      `✔ [Inbox Ingestion] Hoàn tất. Upsert ${summary.upserted} tin, bỏ qua ${summary.skippedMock} mock, lỗi ${summary.errored}, gated ${summary.gated}.`,
    );
  }

  /**
   * Trigger on-demand cho 1 workspace (dùng cho POST /inbox/sync).
   * workspaceId được lọc account giống hệt cách các endpoint inbox hiện có dùng (cùng mức tin cậy);
   * mọi thông tin còn lại (token, platformAccountId, workspace) đều resolve từ FK server-side.
   */
  async syncWorkspace(workspaceId: string) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { workspaceId, status: 'active' },
    });

    const summary = await this.syncAccounts(accounts);
    return {
      accounts: accounts.length,
      ...summary,
    };
  }

  /**
   * Lặp qua danh sách account, giải mã token, định tuyến theo platform. Mỗi account bọc try/catch
   * riêng để một account lỗi không làm hỏng cả mẻ.
   */
  private async syncAccounts(accounts: SocialAccount[]) {
    let upserted = 0;
    let skippedMock = 0;
    let errored = 0;
    let gated = 0;

    for (const account of accounts) {
      let accessToken: string;
      try {
        accessToken = this.crypto.decrypt(account.accessToken);
      } catch (e: any) {
        errored++;
        this.logger.warn(`⚠️ [Inbox Ingestion] Không giải mã được token của ${account.displayName}: ${e.message}. Bỏ qua.`);
        continue;
      }

      // MOCK: không bịa dữ liệu — bỏ qua để inbox rỗng trung thực.
      if (accessToken.startsWith('mock_')) {
        skippedMock++;
        continue;
      }

      try {
        if (account.platform === 'facebook') {
          upserted += await this.syncFacebook(account, accessToken);
        } else if (account.platform === 'youtube') {
          upserted += await this.syncYouTube(account, accessToken);
        } else if (account.platform === 'tiktok') {
          gated += this.syncTikTok(account);
        }
      } catch (err: any) {
        errored++;
        const apiErr = err.response?.data?.error;
        const detail = apiErr ? `${apiErr.code ?? ''} ${apiErr.message ?? ''}`.trim() : err.message;
        this.logger.warn(
          `⚠️ [Inbox Ingestion] Lỗi đồng bộ ${account.platform} "${account.displayName}": ${detail}. Giữ nguyên dữ liệu cũ, bỏ qua.`,
        );
      }
    }

    return { upserted, skippedMock, errored, gated };
  }

  /**
   * Facebook Messenger: lấy các cuộc hội thoại gần đây của Page + tin nhắn trong mỗi hội thoại.
   * Yêu cầu Page Access Token với quyền pages_messaging + pages_read_engagement.
   * Chỉ lưu tin nhắn ĐẾN (sender khác chính Page) để inbox phản ánh tương tác của khách hàng.
   */
  private async syncFacebook(account: SocialAccount, accessToken: string): Promise<number> {
    const pageId = account.platformAccountId;
    const res = await axios.get(`${this.fbBaseUrl}/${pageId}/conversations`, {
      params: {
        platform: 'messenger',
        fields: 'id,updated_time,messages.limit(10){id,message,from,created_time}',
        limit: 15,
        access_token: accessToken,
      },
    });

    const conversations: any[] = res.data?.data || [];
    let count = 0;

    for (const conv of conversations) {
      const messages: any[] = conv.messages?.data || [];
      for (const msg of messages) {
        const from = msg.from || {};
        // Bỏ qua tin do chính Page gửi đi (chỉ giữ tin của khách).
        if (!from.id || from.id === pageId) continue;

        const text = this.sanitizeText(msg.message);
        if (!text) continue; // Tin chỉ có attachment, không có text → bỏ qua.

        await this.upsertMessage({
          externalId: msg.id,
          account,
          platform: 'facebook',
          conversationId: conv.id,
          senderId: from.id,
          senderName: from.name || 'Người dùng Facebook',
          senderAvatar: null, // Graph không trả avatar PSID ở đây; FE tự fallback theo tên.
          messageText: text,
          createdAt: msg.created_time ? new Date(msg.created_time) : new Date(),
        });
        count++;
      }
    }

    return count;
  }

  /**
   * YouTube: lấy comment threads gần đây liên quan tới kênh qua Data API v3.
   * commentThreads.list?allThreadsRelatedToChannelId=&part=snippet (chi phí ~1 đơn vị quota/lần).
   * Yêu cầu scope youtube.force-ssl. Chỉ lưu comment của người khác (không phải chính chủ kênh).
   */
  private async syncYouTube(account: SocialAccount, accessToken: string): Promise<number> {
    const channelId = account.platformAccountId;
    const res = await axios.get('https://www.googleapis.com/youtube/v3/commentThreads', {
      params: {
        part: 'snippet',
        allThreadsRelatedToChannelId: channelId,
        maxResults: 30,
        order: 'time',
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items: any[] = res.data?.items || [];
    let count = 0;

    for (const item of items) {
      const top = item.snippet?.topLevelComment;
      const sn = top?.snippet;
      if (!top?.id || !sn) continue;

      const authorChannelId = sn.authorChannelId?.value || '';
      // Bỏ qua comment do chính chủ kênh viết — inbox chỉ hiển thị tương tác của người xem.
      if (authorChannelId && authorChannelId === channelId) continue;

      const text = this.sanitizeText(sn.textOriginal || sn.textDisplay);
      if (!text) continue;

      await this.upsertMessage({
        externalId: top.id,
        account,
        platform: 'youtube',
        conversationId: item.snippet?.videoId || item.id,
        senderId: authorChannelId || top.id,
        senderName: sn.authorDisplayName || 'Người xem YouTube',
        senderAvatar: sn.authorProfileImageUrl || null,
        messageText: text,
        createdAt: sn.publishedAt ? new Date(sn.publishedAt) : new Date(),
      });
      count++;
    }

    return count;
  }

  /**
   * TikTok: GATED. API công khai của TikTok hiện KHÔNG cấp quyền đọc bình luận/DM video cho ứng dụng
   * bên thứ ba nếu chưa qua App Audit chuyên biệt (và phần lớn không khả dụng). Ta KHÔNG bịa dữ liệu:
   * chỉ log một lần và bỏ qua. Trả về 0 (không upsert gì).
   */
  private syncTikTok(account: SocialAccount): number {
    this.logger.warn(
      `ℹ️ [Inbox Ingestion] TikTok "${account.displayName}": đọc bình luận chưa khả dụng (cần App Audit/scope chuyên biệt của TikTok). Bỏ qua, không tạo dữ liệu giả.`,
    );
    return 0;
  }

  /**
   * Upsert idempotent theo khóa chính tổng hợp. Nhánh update CHỦ Ý không đụng tới isRead để giữ
   * trạng thái đã đọc của người dùng qua các lần re-sync.
   */
  private async upsertMessage(input: {
    externalId: string;
    account: SocialAccount;
    platform: Platform;
    conversationId: string;
    senderId: string;
    senderName: string;
    senderAvatar: string | null;
    messageText: string;
    createdAt: Date;
  }) {
    const id = `${input.account.id}:${input.platform}:${input.externalId}`;

    await this.prisma.inboxMessage.upsert({
      where: { id },
      create: {
        id,
        socialAccountId: input.account.id,
        platform: input.platform,
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderName: input.senderName,
        senderAvatar: input.senderAvatar,
        messageText: input.messageText,
        createdAt: input.createdAt,
      },
      update: {
        // Chỉ cập nhật nội dung (phòng trường hợp comment được sửa); KHÔNG đổi isRead.
        senderName: input.senderName,
        senderAvatar: input.senderAvatar,
        messageText: input.messageText,
      },
    });
  }

  /**
   * Làm sạch text từ nguồn ngoài (KHÔNG tin cậy): loại bỏ thẻ HTML để chống stored markup/script
   * injection, cắt độ dài tối đa. React đã escape khi render, đây là lớp phòng thủ bổ sung.
   */
  private sanitizeText(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/<[^>]*>/g, '').trim().slice(0, 5000);
  }
}
