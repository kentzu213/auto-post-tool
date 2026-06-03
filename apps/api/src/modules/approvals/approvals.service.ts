import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantScopeService } from '../auth/authorization/tenant-scope.service';
import { CreateApprovalDto, ReviewApprovalDto } from './dto/approval.dto';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  /**
   * Gửi yêu cầu duyệt bài — cập nhật Post status → pending_approval
   *
   * Resolve the target Post through the Active_Workspace BEFORE creating anything:
   * a cross-tenant (or absent) postId yields an indistinguishable 404 and NO
   * ApprovalRequest is created (Req 7.1, 7.2). The requester identity is the
   * server-derived userId, never the client-supplied dto.requestedBy (Req 2.4).
   */
  async createRequest(workspaceId: string, userId: string, dto: CreateApprovalDto) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.post.findFirst({ where: { id: dto.postId, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.post.findUnique({ where: { id: dto.postId } }).then(Boolean),
      workspaceId,
      resourceType: 'Post',
      resourceId: dto.postId,
      userId,
    });

    // Kiểm tra chưa có pending request
    const existingPending = await this.prisma.approvalRequest.findFirst({
      where: { postId: dto.postId, status: 'pending' },
    });
    if (existingPending) {
      throw new BadRequestException('Bài viết đã có yêu cầu duyệt đang chờ xử lý.');
    }

    // Tạo ApprovalRequest + cập nhật Post status
    const [approvalRequest] = await this.prisma.$transaction([
      this.prisma.approvalRequest.create({
        data: {
          postId: dto.postId,
          requestedBy: userId,
          comment: dto.comment,
        },
      }),
      this.prisma.post.update({
        where: { id: dto.postId },
        data: { status: 'pending_approval' },
      }),
    ]);

    this.logger.log(`📋 Yêu cầu duyệt bài ${dto.postId} đã được tạo.`);
    return approvalRequest;
  }

  /**
   * Duyệt hoặc từ chối bài viết
   *
   * Resolve the ApprovalRequest through its Post's Active_Workspace: a cross-tenant
   * (or absent) approvalId yields an indistinguishable 404 (Req 5.1, 5.2). The
   * reviewer identity is the server-derived userId, never dto.approvedBy (Req 2.4).
   */
  async review(workspaceId: string, userId: string, approvalId: string, dto: ReviewApprovalDto) {
    const approval = await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.approvalRequest.findFirst({
          where: { id: approvalId, post: { workspaceId } },
          include: { post: true },
        }),
      findUnscopedExists: () =>
        this.prisma.approvalRequest.findUnique({ where: { id: approvalId } }).then(Boolean),
      workspaceId,
      resourceType: 'ApprovalRequest',
      resourceId: approvalId,
      userId,
    });

    if (approval.status !== 'pending') {
      throw new BadRequestException('Yêu cầu duyệt này đã được xử lý.');
    }

    const newPostStatus = dto.decision === 'approved' ? 'draft' : 'draft'; // approved → draft (sẵn sàng schedule), rejected → draft (cần sửa)

    const [updatedApproval] = await this.prisma.$transaction([
      this.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: dto.decision,
          approvedBy: userId,
          comment: dto.comment,
        },
      }),
      this.prisma.post.update({
        where: { id: approval.postId },
        data: { status: newPostStatus },
      }),
    ]);

    this.logger.log(`✅ Bài ${approval.postId} đã được ${dto.decision} bởi ${userId}`);
    return updatedApproval;
  }

  /**
   * Lấy danh sách pending approvals (cho Approver dashboard)
   * Chỉ trả về approvals thuộc Active_Workspace (Req 7.5).
   */
  async findPending(workspaceId: string) {
    return this.prisma.approvalRequest.findMany({
      where: {
        status: 'pending',
        post: { workspaceId },
      },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            content: true,
            contentType: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Lấy lịch sử approval của 1 Post — scoped theo Active_Workspace.
   * Một postId thuộc tenant khác trả về 404 không phân biệt được với not-found.
   */
  async findByPost(workspaceId: string, postId: string) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.post.findFirst({ where: { id: postId, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.post.findUnique({ where: { id: postId } }).then(Boolean),
      workspaceId,
      resourceType: 'Post',
      resourceId: postId,
    });

    return this.prisma.approvalRequest.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
