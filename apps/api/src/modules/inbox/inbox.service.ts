import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Platform } from '@prisma/client';

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy tất cả tin nhắn đến từ tất cả tài khoản MXH (Unified Inbox)
   * Hỗ trợ phân trang và lọc theo platform/read status
   */
  async getMessages(params: {
    workspaceId: string;
    page?: number;
    limit?: number;
    platform?: Platform;
    unreadOnly?: boolean;
  }) {
    const { workspaceId, page = 1, limit = 30, platform, unreadOnly } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      socialAccount: { workspaceId },
    };
    if (platform) where.platform = platform;
    if (unreadOnly) where.isRead = false;

    const [messages, total, unreadCount] = await Promise.all([
      this.prisma.inboxMessage.findMany({
        where,
        include: {
          socialAccount: {
            select: { id: true, platform: true, displayName: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inboxMessage.count({ where }),
      this.prisma.inboxMessage.count({
        where: { socialAccount: { workspaceId }, isRead: false },
      }),
    ]);

    return {
      data: messages,
      meta: {
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Đánh dấu tin nhắn đã đọc
   */
  async markAsRead(messageId: string) {
    return this.prisma.inboxMessage.update({
      where: { id: messageId },
      data: { isRead: true },
    });
  }

  /**
   * Đánh dấu tất cả tin nhắn đã đọc cho workspace
   */
  async markAllAsRead(workspaceId: string) {
    const result = await this.prisma.inboxMessage.updateMany({
      where: {
        socialAccount: { workspaceId },
        isRead: false,
      },
      data: { isRead: true },
    });

    this.logger.log(`✅ Đã đánh dấu ${result.count} tin nhắn là đã đọc.`);
    return { updatedCount: result.count };
  }

  /**
   * Lấy số lượng tin nhắn chưa đọc theo platform
   */
  async getUnreadCounts(workspaceId: string) {
    const counts = await this.prisma.inboxMessage.groupBy({
      by: ['platform'],
      where: {
        socialAccount: { workspaceId },
        isRead: false,
      },
      _count: { id: true },
    });

    const totalUnread = counts.reduce((sum, c) => sum + c._count.id, 0);

    return {
      total: totalUnread,
      byPlatform: counts.map(c => ({ platform: c.platform, count: c._count.id })),
    };
  }
}
