import { IsString, IsOptional, IsArray, IsEnum, IsDateString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentType } from '@prisma/client';
export { ContentType };

export class CreatePostDto {
  @ApiProperty({ description: 'ID Workspace', example: 'workspace_abc123' })
  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @ApiPropertyOptional({ description: 'Tiêu đề bài viết (cho YouTube/TikTok)', example: 'Review iPhone 18 Pro Max' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiProperty({ description: 'Nội dung caption', example: '🔥 Siêu phẩm mới ra mắt! Đánh giá chi tiết...' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'ID Campaign liên kết', example: 'campaign_xyz' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({
    description: 'Danh sách URL media đính kèm (ảnh/video)',
    example: ['https://cdn.example.com/video.mp4'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @ApiPropertyOptional({
    description: 'Danh sách Social Account IDs muốn đăng bài',
    example: ['social_fb_01', 'social_yt_02'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  socialAccountIds?: string[];

  @ApiPropertyOptional({
    description: 'Thời gian hẹn giờ đăng bài (ISO 8601). Để trống = đăng ngay',
    example: '2026-06-01T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description: 'Loại nội dung: feed, reels, story, shorts',
    enum: ContentType,
    default: 'feed',
  })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;
}
