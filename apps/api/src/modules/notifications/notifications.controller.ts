import { Controller, Get, Patch, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/auth-context.decorators';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách notifications' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Danh sách notifications.' })
  async findAll(
    @CurrentUser() userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.findAll({
      userId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Số notification chưa đọc' })
  @ApiResponse({ status: 200, description: 'Số unread.' })
  async getUnreadCount(@CurrentUser() userId: string) {
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu notification đã đọc' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiResponse({ status: 200, description: 'Đã đánh dấu đọc.' })
  async markAsRead(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.notificationsService.markAsRead(userId, id);
  }

  @Patch('mark-all-read')
  @ApiOperation({ summary: 'Đánh dấu tất cả đã đọc' })
  @ApiResponse({ status: 200, description: 'Tất cả đã đọc.' })
  async markAllAsRead(@CurrentUser() userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
