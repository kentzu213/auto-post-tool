import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantScopeService } from '../auth/authorization/tenant-scope.service';
import { CreateTemplateDto } from './dto/create-template.dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  async create(workspaceId: string, dto: CreateTemplateDto) {
    this.logger.log(`📋 Tạo template mới: ${dto.name}`);
    return this.prisma.template.create({
      data: {
        workspaceId,
        name: dto.name,
        content: dto.content,
        platforms: dto.platforms || [],
        contentType: dto.contentType || 'feed',
      },
    });
  }

  async findAll(workspaceId: string) {
    return this.prisma.template.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(workspaceId: string, id: string) {
    return this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.template.findFirst({ where: { id, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.template.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Template',
      resourceId: id,
    });
  }

  async update(workspaceId: string, id: string, data: Partial<CreateTemplateDto>) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.template.findFirst({ where: { id, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.template.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Template',
      resourceId: id,
    });

    return this.prisma.template.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.platforms && { platforms: data.platforms }),
        ...(data.contentType && { contentType: data.contentType }),
      },
    });
  }

  async delete(workspaceId: string, id: string) {
    await this.tenantScope.requireOwned({
      findScoped: () =>
        this.prisma.template.findFirst({ where: { id, workspaceId } }),
      findUnscopedExists: () =>
        this.prisma.template.findUnique({ where: { id } }).then(Boolean),
      workspaceId,
      resourceType: 'Template',
      resourceId: id,
    });

    await this.prisma.template.delete({ where: { id } });
    return { deleted: true, id };
  }
}
