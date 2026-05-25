import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTemplateDto) {
    this.logger.log(`📋 Tạo template mới: ${dto.name}`);
    return this.prisma.template.create({
      data: {
        workspaceId: dto.workspaceId,
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

  async findOne(id: string) {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Không tìm thấy template với ID: ${id}`);
    }
    return template;
  }

  async update(id: string, data: Partial<CreateTemplateDto>) {
    const exists = await this.prisma.template.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Không tìm thấy template với ID: ${id}`);
    }

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

  async delete(id: string) {
    const exists = await this.prisma.template.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Không tìm thấy template với ID: ${id}`);
    }

    await this.prisma.template.delete({ where: { id } });
    return { deleted: true, id };
  }
}
