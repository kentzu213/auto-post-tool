import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CreatePostDto, ContentType } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostStatus, Platform } from '@prisma/client';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerService: SchedulerService,
  ) {}

  /**
   * Tạo bài viết mới + tự động tạo Schedule records + enqueue BullMQ jobs
   * 
   * Flow: CreatePost → MediaAssets → Schedule(per account) → BullMQ delayed jobs
   */
  async create(dto: CreatePostDto) {
    this.logger.log(`📝 Tạo bài viết mới cho workspace ${dto.workspaceId}...`);

    // 1. Validate social accounts nếu có
    if (dto.socialAccountIds && dto.socialAccountIds.length > 0) {
      const accounts = await this.prisma.socialAccount.findMany({
        where: {
          id: { in: dto.socialAccountIds },
          workspaceId: dto.workspaceId,
          status: 'active',
        },
      });

      if (accounts.length !== dto.socialAccountIds.length) {
        const foundIds = accounts.map(a => a.id);
        const missingIds = dto.socialAccountIds.filter(id => !foundIds.includes(id));
        throw new BadRequestException(
          `Không tìm thấy hoặc tài khoản không active: ${missingIds.join(', ')}`
        );
      }
    }

    // 2. Xác định trạng thái ban đầu của bài viết
    const initialStatus: PostStatus = dto.scheduledAt
      ? PostStatus.scheduled
      : dto.socialAccountIds && dto.socialAccountIds.length > 0
        ? PostStatus.publishing
        : PostStatus.draft;

    // 3. Tạo Post + MediaAssets + Schedules trong 1 transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Tạo Post
      const post = await tx.post.create({
        data: {
          workspaceId: dto.workspaceId,
          title: dto.title,
          content: dto.content,
          campaignId: dto.campaignId,
          status: initialStatus,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        },
      });

      // Tạo MediaAssets nếu có
      if (dto.mediaUrls && dto.mediaUrls.length > 0) {
        await tx.mediaAsset.createMany({
          data: dto.mediaUrls.map((url, index) => ({
            postId: post.id,
            url,
            type: url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image',
            key: `uploads/${dto.workspaceId}/${post.id}/media_${index}`,
          })),
        });
      }

      // Tạo Schedule records (1 per social account)
      const schedules: Array<{ id: string; platform: Platform; scheduledAt: Date }> = [];

      if (dto.socialAccountIds && dto.socialAccountIds.length > 0) {
        const accounts = await tx.socialAccount.findMany({
          where: { id: { in: dto.socialAccountIds } },
          select: { id: true, platform: true },
        });

        const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();

        for (const account of accounts) {
          const schedule = await tx.schedule.create({
            data: {
              postId: post.id,
              socialAccountId: account.id,
              platform: account.platform,
              scheduledAt,
              status: dto.scheduledAt ? PostStatus.scheduled : PostStatus.scheduled,
            },
          });
          schedules.push({
            id: schedule.id,
            platform: account.platform,
            scheduledAt,
          });
        }
      }

      return { post, schedules };
    });

    // 4. Enqueue BullMQ delayed jobs (ngoài transaction để không block DB)
    for (const schedule of result.schedules) {
      await this.schedulerService.addDelayedPublishJob(
        schedule.id,
        schedule.scheduledAt,
      );
    }

    this.logger.log(
      `✅ Bài viết ${result.post.id} đã tạo thành công. ` +
      `${result.schedules.length} schedules đã được enqueue.`
    );

    // 5. Trả về post đầy đủ với relations
    return this.findOne(result.post.id);
  }

  /**
   * Lấy danh sách bài viết theo workspace (phân trang + lọc trạng thái)
   */
  async findAll(params: {
    workspaceId: string;
    page?: number;
    limit?: number;
    status?: PostStatus;
    campaignId?: string;
  }) {
    const { workspaceId, page = 1, limit = 20, status, campaignId } = params;
    const skip = (page - 1) * limit;

    const where: any = { workspaceId };
    if (status) where.status = status;
    if (campaignId) where.campaignId = campaignId;

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: {
          mediaAssets: true,
          schedules: {
            include: {
              socialAccount: {
                select: { id: true, platform: true, displayName: true, avatarUrl: true },
              },
              analytics: true,
            },
          },
          campaign: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      data: posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Lấy chi tiết 1 bài viết
   */
  async findOne(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        mediaAssets: true,
        schedules: {
          include: {
            socialAccount: {
              select: { id: true, platform: true, displayName: true, avatarUrl: true },
            },
            analytics: true,
          },
        },
        campaign: { select: { id: true, name: true } },
      },
    });

    if (!post) {
      throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`);
    }

    return post;
  }

  /**
   * Cập nhật bài viết (chỉ cho phép khi status = draft hoặc scheduled)
   */
  async update(id: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`);
    }

    if (post.status === PostStatus.published || post.status === PostStatus.publishing) {
      throw new BadRequestException(
        `Không thể chỉnh sửa bài viết đang ở trạng thái "${post.status}". ` +
        `Chỉ cho phép chỉnh sửa bài viết ở trạng thái "draft" hoặc "scheduled".`
      );
    }

    // Cập nhật bài viết
    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.campaignId !== undefined && { campaignId: dto.campaignId }),
        ...(dto.scheduledAt !== undefined && { scheduledAt: new Date(dto.scheduledAt) }),
      },
    });

    // Cập nhật mediaAssets nếu có thay đổi
    if (dto.mediaUrls !== undefined) {
      // Xóa media cũ và tạo mới
      await this.prisma.mediaAsset.deleteMany({ where: { postId: id } });
      if (dto.mediaUrls.length > 0) {
        await this.prisma.mediaAsset.createMany({
          data: dto.mediaUrls.map((url, index) => ({
            postId: id,
            url,
            type: url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image',
            key: `uploads/${post.workspaceId}/${id}/media_${index}`,
          })),
        });
      }
    }

    this.logger.log(`✅ Bài viết ${id} đã cập nhật thành công.`);
    return this.findOne(id);
  }

  /**
   * Xóa bài viết (cascade xóa schedules, mediaAssets, analytics)
   */
  async delete(id: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`);
    }

    // Chỉ cho phép xóa draft hoặc failed
    if (post.status === PostStatus.publishing) {
      throw new BadRequestException(
        'Không thể xóa bài viết đang trong quá trình đăng tải.'
      );
    }

    await this.prisma.post.delete({ where: { id } });
    this.logger.log(`🗑️ Bài viết ${id} đã được xóa.`);

    return { deleted: true, id };
  }

  /**
   * Lấy thống kê tổng quan bài viết của workspace
   */
  async getStats(workspaceId: string) {
    const [total, draft, scheduled, published, failed] = await Promise.all([
      this.prisma.post.count({ where: { workspaceId } }),
      this.prisma.post.count({ where: { workspaceId, status: PostStatus.draft } }),
      this.prisma.post.count({ where: { workspaceId, status: PostStatus.scheduled } }),
      this.prisma.post.count({ where: { workspaceId, status: PostStatus.published } }),
      this.prisma.post.count({ where: { workspaceId, status: PostStatus.failed } }),
    ]);

    return { total, draft, scheduled, published, failed };
  }
}
