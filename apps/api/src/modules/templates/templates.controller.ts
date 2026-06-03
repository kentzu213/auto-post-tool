import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ActiveWorkspace } from '../auth/decorators/auth-context.decorators';
import { RequireRole } from '../auth/decorators/require-role.decorator';

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @RequireRole('owner', 'editor')
  @ApiOperation({ summary: 'Tạo template bài đăng mới' })
  @ApiResponse({ status: 201, description: 'Template đã tạo.' })
  async create(@ActiveWorkspace() workspaceId: string, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(workspaceId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách templates' })
  @ApiResponse({ status: 200, description: 'Danh sách templates.' })
  async findAll(@ActiveWorkspace() workspaceId: string) {
    return this.templatesService.findAll(workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Chi tiết template.' })
  async findOne(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.templatesService.findOne(workspaceId, id);
  }

  @Patch(':id')
  @RequireRole('owner', 'editor')
  @ApiOperation({ summary: 'Cập nhật template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template đã cập nhật.' })
  async update(
    @ActiveWorkspace() workspaceId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTemplateDto>,
  ) {
    return this.templatesService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireRole('owner', 'editor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template đã xóa.' })
  async delete(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.templatesService.delete(workspaceId, id);
  }
}
