import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { CreateApprovalDto, ReviewApprovalDto } from './dto/approval.dto';

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi yêu cầu duyệt bài viết' })
  @ApiResponse({ status: 201, description: 'Yêu cầu duyệt đã tạo.' })
  @ApiResponse({ status: 400, description: 'Đã có yêu cầu duyệt đang chờ.' })
  async createRequest(@Body() dto: CreateApprovalDto) {
    return this.approvalsService.createRequest(dto);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Duyệt hoặc từ chối bài viết' })
  @ApiParam({ name: 'id', description: 'Approval Request ID' })
  @ApiResponse({ status: 200, description: 'Đã xử lý duyệt.' })
  @ApiResponse({ status: 400, description: 'Yêu cầu đã được xử lý trước đó.' })
  async review(@Param('id') id: string, @Body() dto: ReviewApprovalDto) {
    return this.approvalsService.review(id, dto);
  }

  @Get('pending')
  @ApiOperation({ summary: 'Danh sách bài chờ duyệt' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Danh sách pending approvals.' })
  async findPending(@Query('workspaceId') workspaceId: string) {
    return this.approvalsService.findPending(workspaceId);
  }

  @Get('post/:postId')
  @ApiOperation({ summary: 'Lịch sử duyệt của 1 bài viết' })
  @ApiParam({ name: 'postId', description: 'Post ID' })
  @ApiResponse({ status: 200, description: 'Lịch sử approval.' })
  async findByPost(@Param('postId') postId: string) {
    return this.approvalsService.findByPost(postId);
  }
}
