import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import * as crypto from 'crypto';
import axios from 'axios';
import { 
  handleAll, 
  circuitBreaker, 
  retry, 
  wrap, 
  ExponentialBackoff, 
  ConsecutiveBreaker 
} from 'cockatiel';

const prisma = new PrismaClient();
const logger = {
  log: (msg: string) => console.log(`[Worker] ${msg}`),
  warn: (msg: string) => console.warn(`[Worker WARNING] ${msg}`),
  error: (msg: string) => console.error(`[Worker ERROR] ${msg}`),
};

// Cấu hình giải mã AES-256-GCM
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const hexKey = process.env.ENCRYPTION_KEY;
if (!hexKey) {
  throw new Error('CRITICAL: ENCRYPTION_KEY environment variable is required. Cannot start worker without encryption key.');
}
const encryptionKey = Buffer.from(hexKey, 'hex');

// Singletons cho Circuit Breakers per-platform trong Worker
const platformBreakers: Record<string, any> = {};

function getCircuitBreaker(platform: string) {
  if (!platformBreakers[platform]) {
    logger.log(`🔌 Worker: Khởi tạo Circuit Breaker cho nền tảng: ${platform}`);
    
    const cb = circuitBreaker(handleAll, {
      halfOpenAfter: 30000,
      breaker: new ConsecutiveBreaker(5),
    });

    cb.onBreak(() => {
      logger.warn(`🚨 [CIRCUIT BREAKER] Worker: Mạch đã BỊ NGẮT cho ${platform}! Tạm dừng 30s.`);
    });

    platformBreakers[platform] = cb;
  }
  return platformBreakers[platform];
}

function getRetryPolicy() {
  return retry(handleAll, {
    maxAttempts: 3,
    backoff: new ExponentialBackoff({
      initialDelay: 2000,
      maxDelay: 10000,
    }),
  });
}

async function executeResiliently<T>(platform: string, operation: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === 'test') {
    return await operation(); // Bypass in tests
  }
  const breaker = getCircuitBreaker(platform);
  const retryPolicy = getRetryPolicy();
  const resilientPolicy = wrap(retryPolicy, breaker);
  return await resilientPolicy.execute(operation);
}

/**
 * Giải mã token AES-256-GCM
 */
function decryptToken(encryptedText: string): string {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const authTag = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Mã hóa token AES-256-GCM
 */
function encryptToken(text: string): string {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Tự động kiểm tra và refresh token trước khi job chạy nếu sắp hết hạn (< 5 phút)
 */
async function ensureToken(socialAccountId: string): Promise<string> {
  const acc = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId }
  });
  if (!acc) throw new Error(`Social account not found: ${socialAccountId}`);

  // Nếu không có hạn dùng hoặc thời gian sống còn > 5 phút thì decrypt và dùng trực tiếp
  const fiveMinutes = 5 * 60 * 1000;
  const isExpiring = acc.tokenExpiresAt && (acc.tokenExpiresAt.getTime() - Date.now() < fiveMinutes);

  if (!isExpiring || !acc.refreshToken) {
    return decryptToken(acc.accessToken);
  }

  logger.log(`⏳ [ensureToken] Token của tài khoản ${acc.displayName} (${acc.platform}) sắp hết hạn hoặc đã hết hạn. Đang thực hiện tự động refresh...`);
  const decryptedRefreshToken = decryptToken(acc.refreshToken);

  let newAccessToken = '';
  let newRefreshToken = acc.refreshToken;
  let expiresIn = 3600; // Mặc định 1 giờ

  try {
    if (acc.platform === 'youtube') {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID || 'mock_google_client_id',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || 'mock_google_client_secret',
        refresh_token: decryptedRefreshToken,
        grant_type: 'refresh_token'
      });
      
      newAccessToken = response.data.access_token;
      expiresIn = response.data.expires_in;
      if (response.data.refresh_token) {
        newRefreshToken = encryptToken(response.data.refresh_token);
      }
    } else if (acc.platform === 'tiktok') {
      const response = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY || 'mock_tiktok_client_key',
          client_secret: process.env.TIKTOK_CLIENT_SECRET || 'mock_tiktok_client_secret',
          grant_type: 'refresh_token',
          refresh_token: decryptedRefreshToken
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      );

      newAccessToken = response.data.access_token;
      expiresIn = response.data.expires_in;
      if (response.data.refresh_token) {
        newRefreshToken = encryptToken(response.data.refresh_token);
      }
    } else {
      // Facebook hoặc mock mode: trả về accessToken hiện tại
      return decryptToken(acc.accessToken);
    }

    if (newAccessToken) {
      const encryptedAccessToken = encryptToken(newAccessToken);
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

      await prisma.socialAccount.update({
        where: { id: socialAccountId },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: newRefreshToken,
          tokenExpiresAt,
          status: 'active'
        }
      });

      logger.log(`✅ [ensureToken] Làm mới token thành công cho tài khoản ${acc.displayName} (${acc.platform}).`);
      return newAccessToken;
    }
  } catch (err: any) {
    logger.error(`❌ [ensureToken] Làm mới token thất bại cho tài khoản ${acc.displayName} (${acc.platform}): ${err.message}`);
    // Fallback nếu refresh token là mock hoặc đang test
    if (decryptedRefreshToken.startsWith('mock_')) {
      logger.log(`⚠️ [ensureToken] Phát hiện mock refresh token, dùng luôn token cũ.`);
      return decryptToken(acc.accessToken);
    }
    throw err;
  }

  return decryptToken(acc.accessToken);
}

// Danh sách các Project OAuth dự phòng cho YouTube Quota Rotation trong Worker
const googleProjects = [
  { projectId: 'project-primary', clientId: 'primary_client_id' },
  { projectId: 'project-backup-1', clientId: 'backup1_client_id' },
  { projectId: 'project-backup-2', clientId: 'backup2_client_id' }
];
let currentProjectIndex = 0;

// Khởi chạy BullMQ Worker
export function startPublishWorker() {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  const connection = new IORedis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
  });

  logger.log(`Worker connected to Redis at ${redisHost}:${redisPort}`);

  // Cấu hình concurrency riêng biệt per-worker và gán các queues tương ứng
  const worker = new Worker(
    'publishing-queue',
    async (job: Job) => {
      const { scheduleId } = job.data;
      logger.log(`📥 Đang xử lý Job ID ${job.id} cho Schedule ${scheduleId}...`);

      const schedule = await prisma.schedule.findUnique({
        where: { id: scheduleId },
        include: {
          post: {
            include: {
              mediaAssets: true,
            },
          },
          socialAccount: true,
        },
      });

      if (!schedule) {
        logger.error(`Không tìm thấy Schedule ID ${scheduleId}`);
        return;
      }

      const { post, socialAccount, platform } = schedule;

      // Cập nhật trạng thái sang 'publishing'
      await prisma.schedule.update({
        where: { id: scheduleId },
        data: { status: 'publishing' },
      });

      try {
        const accessToken = await ensureToken(socialAccount.id);
        const mediaUrls = post.mediaAssets.map((asset) => asset.url);

        logger.log(`Đang tiến hành đăng tải bài viết lên [${platform.toUpperCase()}] cho tài khoản ${socialAccount.displayName}...`);

        let publishResult: { success: boolean; publishedPostId?: string; error?: string } = { success: false };

        if (accessToken.startsWith('mock_') || process.env.NODE_ENV === 'test') {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          publishResult = {
            success: true,
            publishedPostId: `${platform}_post_mock_${Math.random().toString(36).substring(7)}`,
          };
        } else {
          // Thực thi an toàn qua Resilience wrapper
          publishResult = await executeResiliently(platform, async () => {
            if (platform === 'facebook') {
              return await publishToFacebook(post.content, mediaUrls, accessToken, socialAccount.platformAccountId);
            } else if (platform === 'youtube') {
              return await publishToYouTube(post.title || '', post.content, mediaUrls, accessToken);
            } else if (platform === 'tiktok') {
              return await publishToTikTok(post.content, mediaUrls, accessToken);
            }
            throw new Error(`Nền tảng ${platform} không được hỗ trợ`);
          });
        }

        if (publishResult.success) {
          await prisma.schedule.update({
            where: { id: scheduleId },
            data: {
              status: 'published',
              publishedPostId: publishResult.publishedPostId,
              errorLog: null,
            },
          });

          await checkAndUpdateOverallPostStatus(post.id);

          logger.log(`🎉 Đăng bài thành công lên [${platform.toUpperCase()}]! Post ID: ${publishResult.publishedPostId}`);

          await prisma.auditLog.create({
            data: {
              userId: socialAccount.workspaceId,
              action: 'publish_post_success',
              details: `Đăng bài viết lên ${platform.toUpperCase()} thành công. ID bài viết: ${publishResult.publishedPostId}`,
            },
          });
        } else {
          throw new Error(publishResult.error || 'Lỗi không xác định khi đăng bài');
        }
      } catch (error: any) {
        logger.error(`💥 Đăng bài lên [${platform.toUpperCase()}] thất bại: ${error.message}`);
        
        await prisma.schedule.update({
          where: { id: scheduleId },
          data: {
            status: 'failed',
            errorLog: error.message,
          },
        });

        await prisma.post.update({
          where: { id: post.id },
          data: { status: 'failed' },
        });

        throw error;
      }
    },
    {
      connection,
      concurrency: 5, // Worker đa luồng nạp 5 jobs đồng thời
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`❌ Job ${job?.id} thất bại hoàn toàn sau các lượt thử lại: ${err.message}`);
  });

  worker.on('completed', (job) => {
    logger.log(`✓ Job ${job.id} hoàn thành thành công.`);
  });
}

/**
 * Facebook Graph API helper
 */
async function publishToFacebook(content: string, mediaUrls: string[], token: string, pageId: string) {
  const baseUrl = 'https://graph.facebook.com/v22.0';
  let response;

  if (mediaUrls.length > 0) {
    const isVideo = mediaUrls[0].match(/\.(mp4|mov|avi)$/i);
    if (isVideo) {
      response = await axios.post(`${baseUrl}/${pageId}/videos`, {
        description: content,
        file_url: mediaUrls[0],
        access_token: token,
      });
    } else {
      response = await axios.post(`${baseUrl}/${pageId}/photos`, {
        caption: content,
        url: mediaUrls[0],
        access_token: token,
      });
    }
  } else {
    response = await axios.post(`${baseUrl}/${pageId}/feed`, {
      message: content,
      access_token: token,
    });
  }

  // Phân tích BUC header cảnh báo rate-limiting
  const bucUsageHeader = response.headers?.['x-business-use-case-usage'];
  if (bucUsageHeader) {
    try {
      const usageData = JSON.parse(bucUsageHeader);
      for (const key of Object.keys(usageData)) {
        const stats = usageData[key]?.[0];
        if (stats) {
          const maxPercent = Math.max(stats.call_count || 0, stats.total_cputime || 0, stats.total_time || 0);
          if (maxPercent > 75) {
            logger.warn(`⚠️ [BUC LIMIT] Tài khoản FB ${key} tiệm cận giới hạn (${maxPercent}%).`);
          }
        }
      }
    } catch {}
  }

  return { success: true, publishedPostId: response.data.id };
}

/**
 * YouTube API helper (Tích hợp Quota project rotation)
 */
async function publishToYouTube(title: string, description: string, mediaUrls: string[], token: string) {
  let attempts = 0;
  const maxProjectRetries = googleProjects.length;

  while (attempts < maxProjectRetries) {
    const activeProject = googleProjects[currentProjectIndex];
    logger.log(`[Worker YouTube] Dùng Project: ${activeProject.projectId}`);

    try {
      const metadata = {
        snippet: { title: title.substring(0, 100), description, categoryId: '22' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      };

      // BƯỚC 1: Download video binary từ URL (MinIO/S3/CDN)
      const videoResponse = await axios.get(mediaUrls[0], { responseType: 'arraybuffer' });
      const videoBuffer = Buffer.from(videoResponse.data);
      const videoSize = videoBuffer.byteLength;
      logger.log(`[Worker YouTube] Video size: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);

      // BƯỚC 2: Khởi tạo Resumable Upload Session
      const initResponse = await axios.post(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        metadata,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': videoSize.toString(),
          },
        }
      );

      const uploadUrl = initResponse.headers['location'];
      if (!uploadUrl) {
        throw new Error('Google không trả về upload URL cho Resumable Upload');
      }

      // BƯỚC 3: Upload video binary
      const uploadResponse = await axios.put(
        uploadUrl,
        videoBuffer,
        {
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': videoSize.toString(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      return { success: true, publishedPostId: uploadResponse.data.id };

    } catch (error: any) {
      const gError = error.response?.data?.error;
      const isQuotaExceeded = gError?.errors?.[0]?.reason === 'quotaExceeded';

      if (isQuotaExceeded) {
        logger.warn(`🚨 [Worker Quota Exceeded] Hết hạn ngạch project ${activeProject.projectId}. Đổi project...`);
        currentProjectIndex = (currentProjectIndex + 1) % googleProjects.length;
        attempts++;
      } else {
        throw error;
      }
    }
  }

  throw new Error('QUOTA_EXCEEDED_ALL: Hết hạn ngạch ở tất cả các dự án YouTube Data API');
}

/**
 * TikTok API helper (Tích hợp Draft/Inbox mode fallback)
 */
async function publishToTikTok(content: string, mediaUrls: string[], token: string) {
  const baseUrl = 'https://open.tiktokapis.com/v2';
  let resInit;

  try {
    // 1. Thử Direct Publish
    resInit = await axios.post(
      `${baseUrl}/post/publish/video/init/`,
      {
        post_info: { title: content.substring(0, 150), privacy_level: 'PUBLIC_TO_EVERYONE' },
        source_info: { source: 'FILE_UPLOAD', video_size: 1024 * 1024 * 10, chunk_size: 1024 * 1024 * 10, total_chunk_count: 1 },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (apiError: any) {
    const errCode = apiError.response?.data?.error?.code;
    // Lỗi scope hoặc chưa Audit -> Fallback sang Draft/Inbox mode
    if (errCode === 'scope_not_aligned' || apiError.response?.status === 403) {
      logger.warn(`⚠️ [Worker TikTok Fallback] Chuyển đổi sang đăng chế độ Nháp (Draft/Inbox mode)...`);
      
      resInit = await axios.post(
        `${baseUrl}/post/publish/inbox/video/init/`,
        {
          source_info: { source: 'FILE_UPLOAD', video_size: 1024 * 1024 * 10, chunk_size: 1024 * 1024 * 10, total_chunk_count: 1 },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } else {
      throw apiError;
    }
  }

  const uploadUrl = resInit.data.data?.upload_url;
  const publishId = resInit.data.data?.publish_id;

  const videoResponse = await axios.get(mediaUrls[0], { responseType: 'arraybuffer' });
  await axios.put(uploadUrl, videoResponse.data, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${videoResponse.data.byteLength - 1}/${videoResponse.data.byteLength}`,
    },
  });

  return { success: true, publishedPostId: publishId };
}

/**
 * Cập nhật status của Post chính
 */
async function checkAndUpdateOverallPostStatus(postId: string) {
  const postSchedules = await prisma.schedule.findMany({
    where: { postId },
  });

  const allPublished = postSchedules.every((s) => s.status === 'published');
  if (allPublished) {
    await prisma.post.update({
      where: { id: postId },
      data: { status: 'published' },
    });
  }
}
