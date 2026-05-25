import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { CredentialsService, CredentialInput } from './credentials.service';
import { Platform } from '@prisma/client';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('Provider Credentials (API Keys)')
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy trạng thái credentials cho tất cả platforms' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Danh sách trạng thái credentials (masked)' })
  async listCredentials(@Query('workspaceId') workspaceId: string) {
    return this.credentialsService.listCredentials(workspaceId || 'default_workspace');
  }

  @Post()
  @ApiOperation({ summary: 'Lưu/cập nhật credentials cho platform' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 201, description: 'Credentials đã được lưu (encrypted)' })
  async saveCredentials(
    @Query('workspaceId') workspaceId: string,
    @Body() input: CredentialInput,
  ) {
    return this.credentialsService.saveCredentials(workspaceId || 'default_workspace', input);
  }

  @Delete(':platform')
  @ApiOperation({ summary: 'Xóa credentials cho platform' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 200, description: 'Đã xóa credentials' })
  async deleteCredentials(
    @Param('platform') platform: Platform,
    @Query('workspaceId') workspaceId: string,
  ) {
    await this.credentialsService.deleteCredentials(workspaceId || 'default_workspace', platform);
    return { message: `Đã xóa credentials cho ${platform}` };
  }
}
