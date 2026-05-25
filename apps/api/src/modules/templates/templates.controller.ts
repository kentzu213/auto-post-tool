import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo template bài đăng mới' })
  @ApiResponse({ status: 201, description: 'Template đã tạo.' })
  async create(@Body() dto: CreateTemplateDto) {
    return this.templatesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách templates' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Danh sách templates.' })
  async findAll(@Query('workspaceId') workspaceId: string) {
    return this.templatesService.findAll(workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Chi tiết template.' })
  async findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template đã cập nhật.' })
  async update(@Param('id') id: string, @Body() dto: Partial<CreateTemplateDto>) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template đã xóa.' })
  async delete(@Param('id') id: string) {
    return this.templatesService.delete(id);
  }
}
