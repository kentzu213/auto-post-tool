import { Controller, Post, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsNumber, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================================
// DTOs
// ============================================================

class TranscodeDto {
  @ApiProperty({ example: '/path/to/input.mp4', description: 'Đường dẫn file video đầu vào' })
  @IsString()
  @IsNotEmpty()
  inputFilePath: string;

  @ApiProperty({ example: 'output_video.mp4', description: 'Tên file đầu ra' })
  @IsString()
  @IsNotEmpty()
  outputFileName: string;

  @ApiProperty({ example: 'facebook', enum: ['facebook', 'youtube', 'tiktok'], description: 'Platform đích' })
  @IsString()
  @IsIn(['facebook', 'youtube', 'tiktok'])
  platform: string;

  @ApiPropertyOptional({ example: '/path/to/logo.png', description: 'Đường dẫn watermark' })
  @IsString()
  @IsOptional()
  watermarkPath?: string;

  @ApiPropertyOptional({ example: 'bottom-right', enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] })
  @IsString()
  @IsOptional()
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

class SubtitleDto {
  @ApiProperty({ example: '/path/to/video.mp4', description: 'Đường dẫn file video' })
  @IsString()
  @IsNotEmpty()
  videoFilePath: string;

  @ApiPropertyOptional({ example: 'vi', description: 'Ngôn ngữ phụ đề' })
  @IsString()
  @IsOptional()
  lang?: string;
}

class ReframeDto {
  @ApiProperty({ example: '/path/to/video.mp4', description: 'Đường dẫn video 16:9 cần crop' })
  @IsString()
  @IsNotEmpty()
  videoFilePath: string;
}

class LongToShortDto {
  @ApiProperty({ example: '/path/to/long_video.mp4', description: 'Đường dẫn video dài' })
  @IsString()
  @IsNotEmpty()
  videoFilePath: string;

  @ApiPropertyOptional({ example: 60, description: 'Thời lượng tối đa mỗi clip (giây)' })
  @IsNumber()
  @IsOptional()
  maxDuration?: number;

  @ApiPropertyOptional({ example: 3, description: 'Số lượng clip muốn tạo' })
  @IsNumber()
  @IsOptional()
  clipCount?: number;
}

// ============================================================
// CONTROLLER
// ============================================================

@ApiTags('Media Pipeline')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('transcode')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Transcode video theo preset nền tảng (Facebook/YouTube/TikTok)' })
  @ApiResponse({ status: 200, description: 'Transcode thành công' })
  async transcode(@Body() dto: TranscodeDto) {
    return this.mediaService.transcodeForPlatform(
      dto.inputFilePath,
      dto.outputFileName,
      dto.platform,
      {
        watermarkPath: dto.watermarkPath,
        watermarkPosition: dto.watermarkPosition,
      },
    );
  }

  @Post('subtitles')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Tạo phụ đề tự động bằng Whisper API' })
  @ApiResponse({ status: 200, description: 'Tạo phụ đề thành công' })
  async generateSubtitles(@Body() dto: SubtitleDto) {
    return this.mediaService.generateSubtitles(dto.videoFilePath, dto.lang);
  }

  @Post('reframe')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Auto-reframe video 16:9 → 9:16 cho Reels/Shorts/TikTok' })
  @ApiResponse({ status: 200, description: 'Reframe thành công' })
  async autoReframe(@Body() dto: ReframeDto) {
    return this.mediaService.autoReframe916(dto.videoFilePath);
  }

  @Post('long-to-short')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cắt video dài thành nhiều clip ngắn cho Shorts/Reels/TikTok' })
  @ApiResponse({ status: 200, description: 'Tạo clips thành công' })
  async longToShort(@Body() dto: LongToShortDto) {
    return this.mediaService.longToShort(dto.videoFilePath, {
      maxDuration: dto.maxDuration,
      clipCount: dto.clipCount,
    });
  }

  @Post('enqueue')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Đẩy tác vụ xử lý video vào hàng đợi background' })
  @ApiResponse({ status: 200, description: 'Đã thêm vào hàng đợi' })
  async enqueue(@Body() dto: TranscodeDto) {
    await this.mediaService.enqueueVideoJob({
      inputFilePath: dto.inputFilePath,
      outputFileName: dto.outputFileName,
      platform: dto.platform,
    });
    return { queued: true, message: `Video job queued for ${dto.platform}` };
  }

  @Post('upload')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = path.join(process.cwd(), 'uploads');
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `media-${uniqueSuffix}${path.extname(file.originalname)}`);
        },
      }),
      limits: {
        fileSize: 100 * 1024 * 1024, // Giới hạn tối đa 100MB cho video lớn
      },
      fileFilter: (req, file, cb) => {
        if (
          !file.mimetype.match(/\/(jpg|jpeg|png|gif|mp4|mov|avi|webm|quicktime)$/i) &&
          !file.originalname.match(/\.(jpg|jpeg|png|gif|mp4|mov|avi|webm)$/i)
        ) {
          return cb(
            new BadRequestException('Chỉ cho phép tải lên hình ảnh (PNG, JPG, GIF) hoặc video (MP4, MOV, AVI)!'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  @ApiOperation({ summary: 'Tải lên hình ảnh/video từ máy tính của bạn' })
  @ApiResponse({ status: 201, description: 'Tải lên thành công' })
  async uploadFile(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file cần tải lên!');
    }
    const port = process.env.PORT || 3001;
    const fileUrl = `http://localhost:${port}/uploads/${file.filename}`;
    return {
      url: fileUrl,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
    };
  }
}
