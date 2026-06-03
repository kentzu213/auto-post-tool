import { Controller, Post, Get, Body, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException, NotFoundException, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActiveWorkspace } from '../auth/decorators/auth-context.decorators';
import { RequireRole } from '../auth/decorators/require-role.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsNumber, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * TTL for the presigned GET URL returned by the upload endpoint.
 *
 * LIMITATION (honest note): presigned URLs EXPIRE. A comfortably long TTL keeps
 * the immediate compose/preview + publish-now flow working, but a post
 * scheduled far in the future could have its stored URL expire before the
 * worker publishes. The proper fix is to reference media by its durable KEY and
 * mint a FRESH presigned URL (or stream) on demand at read time — that is the
 * media-serve route below (`GET /media/file`). 7 days is the maximum AWS SigV4
 * allows.
 */
const UPLOAD_PRESIGN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * TTL (seconds) for presigned URLs minted by the on-demand media-serve route.
 *
 * Config-driven via MEDIA_SIGNED_URL_TTL_SECONDS so operators can tune how long
 * a served Signed_URL stays valid (Req 11.4 — read access expires after a
 * configured duration). Defaults to 1 hour; falls back to the default for an
 * unset/invalid value. Because a fresh URL is minted on every request, a short
 * TTL is safe and the stale-URL gap never appears.
 */
function resolveSignedUrlTtlSeconds(): number {
  const raw = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3600;
}

/** Upper bound for an accepted object key — defends against absurd inputs. */
const MAX_KEY_LENGTH = 1024;

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
  constructor(
    private readonly mediaService: MediaService,
    private readonly storageService: StorageService,
  ) {}

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
  @RequireRole('owner', 'editor')
  @UseInterceptors(
    FileInterceptor('file', {
      // In-memory storage so the handler receives the file buffer and can push
      // it straight to object storage — nothing is written to local disk.
      storage: memoryStorage(),
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
  async uploadFile(@UploadedFile() file: any, @ActiveWorkspace() workspaceId: string) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file cần tải lên!');
    }

    // Tenant-scoped key prevents cross-workspace key collisions and enforces the
    // workspace-authorization model: the active workspace is the membership-
    // verified `@ActiveWorkspace()` from `req.authContext`, never client input.
    const key = `${workspaceId}/${randomUUID()}-${safeName(file.originalname)}`;

    // Persist the object to durable storage (never to local disk). ensureBucket
    // runs lazily inside putObject so a fresh MinIO works out of the box.
    await this.storageService.putObject(key, file.buffer, file.mimetype);

    // Return BOTH the durable key and a presigned GET URL. The key is the
    // canonical reference to persist; the URL keeps the existing compose/preview
    // and immediate-publish flow working (the web composer reads `url`, and the
    // publish worker fetches media by URL via axios.get).
    const url = await this.storageService.presignGet(key, UPLOAD_PRESIGN_TTL_SECONDS);

    return {
      key,
      url,
      filename: safeName(file.originalname),
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  @Get('file')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy media đã lưu theo object KEY (mặc định redirect tới Signed_URL mới)',
  })
  @ApiQuery({ name: 'key', required: true, description: 'Object key đã lưu trong storage' })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: ['redirect', 'stream'],
    description: 'redirect (mặc định) → 302 tới Signed_URL; stream → trả bytes qua API',
  })
  @ApiResponse({ status: 302, description: 'Redirect tới Signed_URL mới được ký' })
  @ApiResponse({ status: 200, description: 'Stream nội dung media qua API' })
  async serveMedia(
    @Query('key') key: string,
    @Query('mode') mode: string | undefined,
    @ActiveWorkspace() workspaceId: string,
    @Res() res: Response,
  ) {
    // Validate the key param: non-empty, reasonable length, no path traversal.
    if (typeof key !== 'string' || key.trim() === '') {
      throw new BadRequestException('Thiếu tham số "key".');
    }
    if (key.length > MAX_KEY_LENGTH || key.includes('..')) {
      throw new BadRequestException('Object key không hợp lệ.');
    }

    // AUTHORIZATION (Req 11.3/11.4 + workspace-authorization): this route stays a
    // READ (no @RequireRole), but the requester MUST be authorized against the
    // active workspace before any Signed_URL is minted or bytes are streamed.
    // Media objects are tenant-scoped under a `${workspaceId}/...` key prefix
    // (see uploadFile). We enforce that the requested key belongs to the
    // membership-verified `@ActiveWorkspace()`; a key owned by another workspace
    // is indistinguishable from a missing object (404), never revealing it
    // exists or serving a cross-tenant Signed_URL.
    if (!key.startsWith(`${workspaceId}/`)) {
      throw new NotFoundException('Không tìm thấy media.');
    }

    // STREAM fallback: proxy the bytes through API_Service for stricter control.
    if (mode === 'stream') {
      const stream = await this.storageService.getObjectStream(key);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(404).json({ message: 'Không tìm thấy media.' });
        } else {
          res.destroy();
        }
      });
      stream.pipe(res);
      return;
    }

    // DEFAULT: mint a FRESH presigned GET URL on demand and 302-redirect to it.
    // Minting per request is the proper fix for the stale-URL gap: the served
    // reference is always a current Signed_URL into Object_Storage, never a
    // local-disk/localhost path (Req 11.3), and it expires after the configured
    // TTL (Req 11.4).
    const url = await this.storageService.presignGet(key, resolveSignedUrlTtlSeconds());
    res.redirect(302, url);
  }
}

/**
 * Sanitize an uploaded filename: strip any path separators (defeats path
 * traversal in the object key) while keeping a readable name + extension.
 */
function safeName(originalname: string): string {
  const base = (originalname || 'file').split(/[\\/]/).pop() || 'file';
  // Keep alphanumerics, dot, dash and underscore; collapse everything else.
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'file';
}
