import { IsString, IsOptional, IsArray, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentType, Platform } from '@prisma/client';

export class CreateTemplateDto {
  @ApiProperty({ description: 'ID Workspace' })
  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({ description: 'Tên template', example: 'Review sản phẩm công nghệ' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Nội dung template (có thể chứa {{placeholder}})', example: '🔥 {{tên_sản_phẩm}} — Review chi tiết!' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    description: 'Platforms mục tiêu',
    enum: Platform,
    isArray: true,
    example: ['facebook', 'youtube'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Platform, { each: true })
  platforms?: Platform[];

  @ApiPropertyOptional({ description: 'Loại nội dung', enum: ContentType, default: ContentType.feed })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;
}
