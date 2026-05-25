import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateAiDto {
  @ApiProperty({ example: 'iPhone 18 Pro Max mới ra mắt', description: 'Chủ đề hoặc từ khóa bài viết' })
  @IsString()
  @IsNotEmpty({ message: 'Chủ đề không được để trống' })
  prompt: string;

  @ApiPropertyOptional({ example: 'gemini', enum: ['gemini', 'openai', 'claude'], description: 'AI Engine muốn sử dụng' })
  @IsString()
  @IsOptional()
  @IsIn(['gemini', 'openai', 'claude'])
  provider?: 'gemini' | 'openai' | 'claude';

  @ApiPropertyOptional({ example: 'vi', description: 'Ngôn ngữ đầu ra (vi, en, th, id...)' })
  @IsString()
  @IsOptional()
  lang?: string;

  @ApiPropertyOptional({ example: 'facebook', enum: ['facebook', 'youtube', 'tiktok'], description: 'Nền tảng mục tiêu để tối ưu nội dung' })
  @IsString()
  @IsOptional()
  @IsIn(['facebook', 'youtube', 'tiktok'])
  targetPlatform?: 'facebook' | 'youtube' | 'tiktok';
}

export class TranslateDto {
  @ApiProperty({ example: 'Xin chào, đây là bài viết mới nhất!', description: 'Nội dung cần dịch' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ example: 'en', description: 'Ngôn ngữ đích (en, vi, th, ja, ko, id, zh)' })
  @IsString()
  @IsNotEmpty()
  targetLang: string;

  @ApiPropertyOptional({ example: 'vi', description: 'Ngôn ngữ nguồn (tự detect nếu để trống)' })
  @IsString()
  @IsOptional()
  sourceLang?: string;

  @ApiPropertyOptional({ example: 'gemini', enum: ['gemini', 'openai', 'claude'], description: 'AI provider' })
  @IsString()
  @IsOptional()
  @IsIn(['gemini', 'openai', 'claude'])
  provider?: 'gemini' | 'openai' | 'claude';
}

export class SentimentDto {
  @ApiProperty({ example: 'Sản phẩm tuyệt vời, tôi rất hài lòng!', description: 'Nội dung cần phân tích cảm xúc' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({ example: 'gemini', enum: ['gemini', 'openai', 'claude'] })
  @IsString()
  @IsOptional()
  @IsIn(['gemini', 'openai', 'claude'])
  provider?: 'gemini' | 'openai' | 'claude';
}
