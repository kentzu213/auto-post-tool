import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostStatus } from '@prisma/client';
import { ActiveWorkspace } from '../auth/decorators/auth-context.decorators';
import { RequireRole } from '../auth/decorators/require-role.decorator';

@ApiTags('posts')
@ApiBearerAuth()
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  /**
   * Tạo bài viết mới + tự động lên lịch đăng
   */
  @Post()
  @RequireRole('owner', 'editor')
  @ApiOperation({
    summary: 'Tạo bài viết mới',
    description: 'Tạo bài viết mới kèm media, chọn tài khoản MXH, và lên lịch đăng. Để trống scheduledAt = đăng ngay.',
  })
  @ApiResponse({ status: 201, description: 'Bài viết đã được tạo thành công.' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ hoặc tài khoản MXH không tìm thấy.' })
  async create(@ActiveWorkspace() workspaceId: string, @Body() dto: CreatePostDto) {
    return this.postsService.create(workspaceId, dto);
  }

  /**
   * Lấy danh sách bài viết (phân trang + lọc)
   */
  @Get()
  @ApiOperation({
    summary: 'Lấy danh sách bài viết',
    description: 'Lấy danh sách bài viết theo workspace, có phân trang và lọc theo status/campaign.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Trang (mặc định: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Số bài/trang (mặc định: 20)' })
  @ApiQuery({ name: 'status', required: false, enum: PostStatus, description: 'Lọc theo trạng thái' })
  @ApiQuery({ name: 'campaignId', required: false, description: 'Lọc theo campaign' })
  @ApiResponse({ status: 200, description: 'Danh sách bài viết kèm phân trang.' })
  async findAll(
    @ActiveWorkspace() workspaceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: PostStatus,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.postsService.findAll({
      workspaceId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      campaignId,
    });
  }

  /**
   * Lấy thống kê tổng quan bài viết
   */
  @Get('stats')
  @ApiOperation({
    summary: 'Thống kê bài viết theo workspace',
    description: 'Trả về số lượng bài theo từng trạng thái: draft, scheduled, published, failed.',
  })
  @ApiResponse({ status: 200, description: 'Thống kê bài viết.' })
  async getStats(@ActiveWorkspace() workspaceId: string) {
    return this.postsService.getStats(workspaceId);
  }

  /**
   * Lấy chi tiết 1 bài viết
   */
  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết bài viết theo ID' })
  @ApiParam({ name: 'id', description: 'Post ID' })
  @ApiResponse({ status: 200, description: 'Chi tiết bài viết.' })
  @ApiResponse({ status: 404, description: 'Bài viết không tồn tại.' })
  async findOne(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.postsService.findOne(workspaceId, id);
  }

  /**
   * Cập nhật bài viết
   */
  @Patch(':id')
  @RequireRole('owner', 'editor')
  @ApiOperation({
    summary: 'Cập nhật bài viết',
    description: 'Chỉ cho phép cập nhật bài viết ở trạng thái draft hoặc scheduled.',
  })
  @ApiParam({ name: 'id', description: 'Post ID' })
  @ApiResponse({ status: 200, description: 'Bài viết đã cập nhật.' })
  @ApiResponse({ status: 400, description: 'Không thể chỉnh sửa bài đã published/publishing.' })
  @ApiResponse({ status: 404, description: 'Bài viết không tồn tại.' })
  async update(
    @ActiveWorkspace() workspaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postsService.update(workspaceId, id, dto);
  }

  /**
   * Xóa bài viết
   */
  @Delete(':id')
  @RequireRole('owner', 'editor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xóa bài viết',
    description: 'Cascade xóa schedules, media assets, analytics liên quan.',
  })
  @ApiParam({ name: 'id', description: 'Post ID' })
  @ApiResponse({ status: 200, description: 'Bài viết đã bị xóa.' })
  @ApiResponse({ status: 400, description: 'Không thể xóa bài đang publishing.' })
  @ApiResponse({ status: 404, description: 'Bài viết không tồn tại.' })
  async delete(@ActiveWorkspace() workspaceId: string, @Param('id') id: string) {
    return this.postsService.delete(workspaceId, id);
  }
}
