import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantScopeService } from '../auth/authorization/tenant-scope.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  async create(workspaceId: string, dto: CreateCampaignDto) {
    this.logger.log(`📋 Tạo campaign mới: ${dto.name}`);
    return this.prisma.campaign.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description,
        kpiTarget: dto.kpiTarget,
      },
    });
  }

  async findAll(workspaceId: string) {
    return this.prisma.campaign.findMany({
      where: { workspaceId },
      include: {
        posts: {
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(workspaceId: string, id: string) {
    const campaign = await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.campaign.findFirst({
          where: { id, workspaceId },
          include: {
            posts: {
              include: {
                mediaAssets: true,
                schedules: {
                  include: {
                    socialAccount: {
                      select: { id: true, platform: true, displayName: true },
                    },
                    analytics: true,
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
            _count: { select: { posts: true } },
          },
        }),
      findUnscopedExists: () =>
        this.prisma.campaign.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Campaign',
      resourceId: id,
    });

    // Tính tổng KPI thực tế từ analytics
    let totalReach = 0, totalEngagement = 0, totalViews = 0;
    for (const post of campaign.posts) {
      for (const schedule of post.schedules) {
        if (schedule.analytics) {
          totalReach += schedule.analytics.reach;
          totalEngagement += schedule.analytics.engagement;
          totalViews += schedule.analytics.views;
        }
      }
    }

    return {
      ...campaign,
      kpiActual: { reach: totalReach, engagement: totalEngagement, views: totalViews },
    };
  }

  async update(workspaceId: string, id: string, data: Partial<CreateCampaignDto>) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.campaign.findFirst({ where: { id, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.campaign.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Campaign',
      resourceId: id,
    });

    return this.prisma.campaign.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.kpiTarget !== undefined && { kpiTarget: data.kpiTarget }),
      },
    });
  }

  async delete(workspaceId: string, id: string) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.campaign.findFirst({ where: { id, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.campaign.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Campaign',
      resourceId: id,
    });

    await this.prisma.campaign.delete({ where: { id } });
    return { deleted: true, id };
  }
}
