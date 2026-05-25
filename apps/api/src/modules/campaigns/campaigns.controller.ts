import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo campaign mới' })
  @ApiResponse({ status: 201, description: 'Campaign đã tạo thành công.' })
  async create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách campaigns' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Danh sách campaigns.' })
  async findAll(@Query('workspaceId') workspaceId: string) {
    return this.campaignsService.findAll(workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết campaign + KPI thực tế' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Chi tiết campaign.' })
  async findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cập nhật campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Campaign đã cập nhật.' })
  async update(@Param('id') id: string, @Body() dto: Partial<CreateCampaignDto>) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Campaign đã xóa.' })
  async delete(@Param('id') id: string) {
    return this.campaignsService.delete(id);
  }
}
