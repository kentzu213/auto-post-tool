import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Platform } from '@prisma/client';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy tổng quan analytics cho workspace dashboard
   */
  async getDashboardSummary(workspaceId: string) {
    this.logger.log(`📊 Lấy dashboard summary cho workspace ${workspaceId}...`);

    // 1. Lấy tất cả analytics qua schedules → posts → workspace
    const analytics = await this.prisma.analytics.findMany({
      where: {
        schedule: {
          post: { workspaceId },
        },
      },
    });

    // 2. Tổng hợp metrics
    const totals = analytics.reduce(
      (acc, a) => ({
        totalReach: acc.totalReach + a.reach,
        totalImpressions: acc.totalImpressions + a.impressions,
        totalEngagement: acc.totalEngagement + a.engagement,
        totalViews: acc.totalViews + a.views,
        totalWatchTime: acc.totalWatchTime + a.watchTime,
        totalClicks: acc.totalClicks + a.clicks,
      }),
      {
        totalReach: 0,
        totalImpressions: 0,
        totalEngagement: 0,
        totalViews: 0,
        totalWatchTime: 0,
        totalClicks: 0,
      },
    );

    // 3. Tổng số post theo trạng thái
    const postStats = await this.prisma.post.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { id: true },
    });

    // 4. Số post theo nền tảng
    const platformStats = await this.prisma.schedule.groupBy({
      by: ['platform'],
      where: {
        post: { workspaceId },
        status: 'published',
      },
      _count: { id: true },
    });

    return {
      overview: totals,
      postsByStatus: postStats.map(s => ({ status: s.status, count: s._count.id })),
      postsByPlatform: platformStats.map(s => ({ platform: s.platform, count: s._count.id })),
      analyticsCount: analytics.length,
    };
  }

  /**
   * Lấy analytics chi tiết cho 1 schedule/bài đăng cụ thể
   */
  async getPostAnalytics(scheduleId: string) {
    const analytics = await this.prisma.analytics.findUnique({
      where: { scheduleId },
      include: {
        schedule: {
          include: {
            post: { select: { id: true, title: true, content: true } },
            socialAccount: { select: { displayName: true, platform: true } },
          },
        },
      },
    });

    if (!analytics) {
      return {
        message: 'Chưa có dữ liệu analytics cho schedule này. Hệ thống đang thu thập...',
        scheduleId,
      };
    }

    return analytics;
  }

  /**
   * Heatmap Best Time to Post — Phân tích giờ đăng bài hiệu quả nhất
   * Tính dựa trên engagement trung bình theo giờ trong ngày
   */
  async getBestTimeHeatmap(workspaceId: string) {
    this.logger.log(`🗓️ Tính toán Best Time to Post heatmap cho workspace ${workspaceId}...`);

    // Lấy tất cả published schedules có analytics
    const publishedSchedules = await this.prisma.schedule.findMany({
      where: {
        post: { workspaceId },
        status: 'published',
        analytics: { isNot: null },
      },
      include: {
        analytics: true,
      },
    });

    // Tạo ma trận 7 ngày × 24 giờ
    // dayOfWeek: 0=CN, 1=T2, ..., 6=T7
    const heatmap: Array<{ day: number; hour: number; avgEngagement: number; count: number }> = [];

    const buckets: Record<string, { total: number; count: number }> = {};

    for (const schedule of publishedSchedules) {
      if (!schedule.analytics) continue;
      const date = new Date(schedule.scheduledAt);
      const day = date.getDay();
      const hour = date.getHours();
      const key = `${day}:${hour}`;

      if (!buckets[key]) {
        buckets[key] = { total: 0, count: 0 };
      }
      buckets[key].total += schedule.analytics.engagement;
      buckets[key].count += 1;
    }

    for (const [key, value] of Object.entries(buckets)) {
      const [day, hour] = key.split(':').map(Number);
      heatmap.push({
        day,
        hour,
        avgEngagement: Math.round(value.total / value.count),
        count: value.count,
      });
    }

    // Sắp xếp top slots
    const topSlots = heatmap
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 5);

    return {
      heatmap,
      topSlots,
      totalDataPoints: publishedSchedules.length,
    };
  }

  /**
   * Lấy analytics theo nền tảng
   */
  async getAnalyticsByPlatform(workspaceId: string, platform: Platform) {
    const analytics = await this.prisma.analytics.findMany({
      where: {
        schedule: {
          platform,
          post: { workspaceId },
          status: 'published',
        },
      },
      include: {
        schedule: {
          include: {
            post: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: {
        schedule: { scheduledAt: 'desc' },
      },
      take: 50,
    });

    const totals = analytics.reduce(
      (acc, a) => ({
        reach: acc.reach + a.reach,
        impressions: acc.impressions + a.impressions,
        engagement: acc.engagement + a.engagement,
        views: acc.views + a.views,
        clicks: acc.clicks + a.clicks,
      }),
      { reach: 0, impressions: 0, engagement: 0, views: 0, clicks: 0 },
    );

    return {
      platform,
      totals,
      posts: analytics,
      count: analytics.length,
    };
  }
}
