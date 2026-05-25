import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApprovalDto, ReviewApprovalDto } from './dto/approval.dto';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gửi yêu cầu duyệt bài — cập nhật Post status → pending_approval
   */
  async createRequest(dto: CreateApprovalDto) {
    // Kiểm tra Post tồn tại
    const post = await this.prisma.post.findUnique({ where: { id: dto.postId } });
    if (!post) {
      throw new NotFoundException(`Không tìm thấy post với ID: ${dto.postId}`);
    }

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
          requestedBy: dto.requestedBy,
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
   */
  async review(approvalId: string, dto: ReviewApprovalDto) {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { id: approvalId },
      include: { post: true },
    });

    if (!approval) {
      throw new NotFoundException(`Không tìm thấy yêu cầu duyệt: ${approvalId}`);
    }

    if (approval.status !== 'pending') {
      throw new BadRequestException('Yêu cầu duyệt này đã được xử lý.');
    }

    const newPostStatus = dto.decision === 'approved' ? 'draft' : 'draft'; // approved → draft (sẵn sàng schedule), rejected → draft (cần sửa)

    const [updatedApproval] = await this.prisma.$transaction([
      this.prisma.approvalRequest.update({
        where: { id: approvalId },
        data: {
          status: dto.decision,
          approvedBy: dto.approvedBy,
          comment: dto.comment,
        },
      }),
      this.prisma.post.update({
        where: { id: approval.postId },
        data: { status: newPostStatus },
      }),
    ]);

    this.logger.log(`✅ Bài ${approval.postId} đã được ${dto.decision} bởi ${dto.approvedBy}`);
    return updatedApproval;
  }

  /**
   * Lấy danh sách pending approvals (cho Approver dashboard)
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
   * Lấy lịch sử approval của 1 Post
   */
  async findByPost(postId: string) {
    return this.prisma.approvalRequest.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
