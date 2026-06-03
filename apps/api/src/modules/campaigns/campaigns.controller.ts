import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ActiveWorkspace } from '../auth/decorators/auth-context.decorators';
import { RequireRole } from '../auth/decorators/require-role.decorator';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @RequireRole('owner', 'editor')
  @ApiOperation({ summary: 'Tạo campaign mới' })
  @ApiResponse({ status: 201, description: 'Campaign đã tạo thành công.' })
  async create(@ActiveWorkspace() workspaceId: string, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(workspaceId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách campaigns' })
  @ApiResponse({ status: 200, description: 'Danh sách campaigns.' })
  async findAll(@ActiveWorkspace() workspaceId: string) {
    return this.campaignsService.findAll(workspaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết campaign + KPI thực tế' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Chi tiết campaign.' })
  async findOne(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.campaignsService.findOne(workspaceId, id);
  }

  @Patch(':id')
  @RequireRole('owner', 'editor')
  @ApiOperation({ summary: 'Cập nhật campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Campaign đã cập nhật.' })
  async update(
    @ActiveWorkspace() workspaceId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCampaignDto>,
  ) {
    return this.campaignsService.update(workspaceId, id, dto);
  }

  @Delete(':id')
  @RequireRole('owner', 'editor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa campaign' })
  @ApiParam({ name: 'id', description: 'Campaign ID' })
  @ApiResponse({ status: 200, description: 'Campaign đã xóa.' })
  async delete(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.campaignsService.delete(workspaceId, id);
  }
}
