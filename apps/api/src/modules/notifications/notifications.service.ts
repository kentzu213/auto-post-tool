import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { TenantScopeService } from '../auth/authorization/tenant-scope.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /**
   * Tạo notification mới cho user
   */
  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    metadata?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        metadata: params.metadata,
      },
    });
  }

  /**
   * Lấy danh sách notifications của user (phân trang)
   */
  async findAll(params: {
    userId: string;
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  }) {
    const { userId, page = 1, limit = 20, unreadOnly } = params;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (unreadOnly) where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      data: notifications,
      meta: { total, unreadCount, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Đánh dấu đã đọc — chỉ trong phạm vi notification thuộc về principal user.
   * Sử dụng resolve-or-404 nên một id không tồn tại hoặc thuộc user khác đều
   * trả về 404 giống nhau (Req 4.4).
   */
  async markAsRead(userId: string, id: string) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.notification.findFirst({ where: { id, userId } }),
      findUnscopedExists: () =>
        this.prisma.notification.findUnique({ where: { id } }).then(Boolean),
      workspaceId: userId,
      resourceType: 'Notification',
      resourceId: id,
      userId,
    });
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  /**
   * Đánh dấu tất cả đã đọc
   */
  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updatedCount: result.count };
  }

  /**
   * Lấy số lượng unread
   */
  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount: count };
  }
}
