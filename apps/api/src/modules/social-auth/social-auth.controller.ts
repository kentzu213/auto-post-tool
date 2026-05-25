import { Controller, Get, Post, Param, Query, Body, Res } from '@nestjs/common';
import { SocialAuthService } from './social-auth.service';
import { Platform } from '@prisma/client';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';

@ApiTags('Social Auth (OAuth 2.0)')
@Controller('social-auth')
export class SocialAuthController {
  constructor(private readonly socialAuthService: SocialAuthService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Lấy danh sách các tài khoản MXH đã liên kết' })
  @ApiQuery({ name: 'workspaceId', required: true, description: 'ID của Workspace' })
  @ApiResponse({ status: 200, description: 'Trả về danh sách tài khoản liên kết' })
  async getAccounts(@Query('workspaceId') workspaceId: string) {
    return this.socialAuthService.getAccounts(workspaceId);
  }

  @Get('connect/:platform')
  @ApiOperation({ summary: 'Lấy URL đăng nhập OAuth 2.0 để liên kết tài khoản' })
  @ApiQuery({ name: 'workspaceId', required: true, description: 'ID của Workspace cần liên kết' })
  @ApiResponse({ status: 200, description: 'Trả về URL chuyển hướng OAuth' })
  async getConnectUrl(
    @Param('platform') platform: Platform,
    @Query('workspaceId') workspaceId: string,
  ) {
    const redirectUrl = await this.socialAuthService.getAuthRedirectUrl(platform, workspaceId);
    return { redirectUrl };
  }

  /**
   * DIRECT CONNECT — Kết nối bằng Token trực tiếp (không cần OAuth redirect)
   * User nhập App ID + Page Access Token → hệ thống validate → lưu → sẵn sàng đăng bài
   */
  @Post('direct-connect')
  @ApiOperation({ summary: 'Kết nối trực tiếp bằng App ID + Page Access Token' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({ status: 201, description: 'Tài khoản đã được liên kết thành công' })
  async directConnect(
    @Query('workspaceId') workspaceId: string,
    @Body() body: {
      platform: Platform;
      appId: string;
      accessToken: string;
    },
  ) {
    return this.socialAuthService.directConnect(
      body.platform,
      body.appId,
      body.accessToken,
      workspaceId,
    );
  }

  @Post('disconnect')
  @ApiOperation({ summary: 'Hủy kết nối một hoặc nhiều tài khoản MXH' })
  @ApiResponse({ status: 200, description: 'Hủy kết nối thành công' })
  async disconnectAccounts(@Body() body: { ids: string[] }) {
    return this.socialAuthService.disconnectAccounts(body.ids);
  }

  @Get('callback/:platform')
  @ApiOperation({ summary: 'Callback xử lý trao đổi token OAuth 2.0' })
  @ApiQuery({ name: 'code', required: true, description: 'Authorization Code từ MXH' })
  @ApiQuery({ name: 'state', required: true, description: 'Workspace ID được truyền qua state' })
  @ApiResponse({ status: 302, description: 'Redirect người dùng về Web/Desktop Client với trạng thái' })
  async handleCallback(
    @Param('platform') platform: Platform,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      // state chính là workspaceId đã gán lúc sinh url
      const workspaceId = state || 'default_workspace_id';
      await this.socialAuthService.handleOAuthCallback(platform, code, workspaceId);
      
      // Chuyển hướng người dùng về trang giao diện với cờ success=true
      const clientRedirectUrl = `http://localhost:3005/accounts?auth_success=true&platform=${platform}`;
      return res.redirect(clientRedirectUrl);
    } catch (error: any) {
      // Chuyển hướng người dùng về trang giao diện kèm cờ báo lỗi
      const clientRedirectUrl = `http://localhost:3005/accounts?auth_error=true&message=${encodeURIComponent(error.message)}`;
      return res.redirect(clientRedirectUrl);
    }
  }
}

