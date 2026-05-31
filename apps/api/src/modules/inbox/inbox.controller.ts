import { Controller, Get, Patch, Post, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { InboxService } from './inbox.service';
import { InboxIngestionService } from './inbox-ingestion.service';
import { Platform } from '@prisma/client';

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inboxService: InboxService,
    private readonly ingestionService: InboxIngestionService,
  ) {}

  @Get('messages')
  @ApiOperation({
    summary: 'Unified Inbox — Lấy tin nhắn từ tất cả MXH',
    description: 'Lấy danh sách tin nhắn/comment từ tất cả tài khoản Facebook, YouTube, TikTok.',
  })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'platform', required: false, enum: Platform })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Danh sách tin nhắn kèm phân trang.' })
  async getMessages(
    @Query('workspaceId') workspaceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: Platform,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.inboxService.getMessages({
      workspaceId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      platform,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-counts')
  @ApiOperation({
    summary: 'Số tin nhắn chưa đọc',
    description: 'Trả về tổng unread + breakdown theo platform.',
  })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Thống kê unread.' })
  async getUnreadCounts(@Query('workspaceId') workspaceId: string) {
    return this.inboxService.getUnreadCounts(workspaceId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu tin nhắn đã đọc' })
  @ApiParam({ name: 'id', description: 'Message ID' })
  @ApiResponse({ status: 200, description: 'Tin nhắn đã đánh dấu đọc.' })
  async markAsRead(@Param('id') id: string) {
    return this.inboxService.markAsRead(id);
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Đánh dấu tất cả tin nhắn đã đọc' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Tất cả đã đánh dấu đọc.' })
  async markAllAsRead(@Query('workspaceId') workspaceId: string) {
    return this.inboxService.markAllAsRead(workspaceId);
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Đồng bộ tin nhắn/bình luận THẬT từ MXH theo yêu cầu',
    description:
      'Poll Facebook Messenger + YouTube comment threads cho các tài khoản active của workspace và upsert vào inbox. ' +
      'Token mock bị bỏ qua (không tạo dữ liệu giả). TikTok đang gated do giới hạn API.',
  })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Tổng kết quá trình đồng bộ.' })
  async sync(@Query('workspaceId') workspaceId: string) {
    return this.ingestionService.syncWorkspace(workspaceId);
  }
}
