import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ActiveWorkspace } from '../auth/decorators/auth-context.decorators';
import { Platform } from '@prisma/client';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard analytics tổng quan',
    description: 'Trả về tổng reach, impressions, engagement, views, clicks + phân bổ theo status/platform.',
  })
  @ApiResponse({ status: 200, description: 'Dữ liệu dashboard analytics.' })
  async getDashboard(@ActiveWorkspace() workspaceId: string) {
    return this.analyticsService.getDashboardSummary(workspaceId);
  }

  @Get('post')
  @ApiOperation({
    summary: 'Analytics chi tiết cho 1 bài đăng',
    description: 'Trả về reach, engagement, views, clicks cho 1 schedule cụ thể.',
  })
  @ApiQuery({ name: 'scheduleId', required: true })
  @ApiResponse({ status: 200, description: 'Analytics chi tiết.' })
  async getPostAnalytics(
    @ActiveWorkspace() workspaceId: string,
    @Query('scheduleId') scheduleId: string,
  ) {
    return this.analyticsService.getPostAnalytics(workspaceId, scheduleId);
  }

  @Get('heatmap')
  @ApiOperation({
    summary: 'Best Time to Post — Heatmap',
    description: 'Phân tích engagement theo giờ/ngày để xác định thời điểm đăng bài hiệu quả nhất.',
  })
  @ApiResponse({ status: 200, description: 'Heatmap data + top 5 time slots.' })
  async getHeatmap(@ActiveWorkspace() workspaceId: string) {
    return this.analyticsService.getBestTimeHeatmap(workspaceId);
  }

  @Get('platform')
  @ApiOperation({
    summary: 'Analytics theo nền tảng',
    description: 'Lấy analytics tổng hợp cho 1 nền tảng cụ thể (facebook/youtube/tiktok).',
  })
  @ApiQuery({ name: 'platform', required: true, enum: Platform })
  @ApiResponse({ status: 200, description: 'Analytics theo platform.' })
  async getByPlatform(
    @ActiveWorkspace() workspaceId: string,
    @Query('platform') platform: Platform,
  ) {
    return this.analyticsService.getAnalyticsByPlatform(workspaceId, platform);
  }
}
