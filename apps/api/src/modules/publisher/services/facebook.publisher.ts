import { Injectable } from '@nestjs/common';
import { SocialAbstract } from './social.abstract';
import { PublishResult } from '../interfaces/publisher.interface';
import axios from 'axios';

@Injectable()
export class FacebookPublisher extends SocialAbstract {
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';

  constructor() {
    super(FacebookPublisher.name);
  }

  /**
   * Xác thực token Facebook Page
   */
  async validate(accessToken: string): Promise<boolean> {
    if (accessToken.startsWith('mock_')) {
      return true; // Mock mode
    }

    try {
      return await this.executeResiliently('facebook', async () => {
        const response = await axios.get(`${this.baseUrl}/me`, {
          params: { access_token: accessToken },
        });
        return !!response.data.id;
      });
    } catch (error: any) {
      this.abstractLogger.error(`Xác thực token Facebook thất bại: ${error.message}`);
      return false;
    }
  }

  /**
   * Đăng bài lên Facebook Page
   */
  async publish(
    content: string,
    mediaUrls: string[],
    options?: Record<string, any>
  ): Promise<PublishResult> {
    const accessToken = options?.accessToken;
    const pageId = options?.pageId || 'me';
    // Xác định loại nội dung: 'feed' (mặc định), 'reels', 'story'
    const contentType = options?.contentType || 'feed';

    if (!accessToken) {
      return { success: false, error: 'Thiếu Facebook Page Access Token' };
    }

    // Mock Mode
    if (accessToken.startsWith('mock_') || process.env.NODE_ENV === 'test') {
      this.abstractLogger.log(`[MOCK] Đăng bài ${contentType} lên Facebook Page ID ${pageId}`);
      return {
        success: true,
        publishedPostId: `fb_post_${Math.random().toString(36).substring(7)}`,
        url: `https://facebook.com/${pageId}/posts/mock_id`,
      };
    }

    try {
      // Phân luồng theo loại nội dung
      if (contentType === 'reels') {
        return await this.publishReels(content, mediaUrls[0], accessToken, pageId);
      }
      if (contentType === 'story') {
        return await this.publishStory(mediaUrls[0], accessToken, pageId);
      }

      return await this.executeResiliently('facebook', async () => {
        // 1. Trường hợp đăng Video thường (Feed Video)
        const isVideo = mediaUrls.length > 0 && mediaUrls[0].match(/\.(mp4|mov|avi)$/i);
        if (isVideo) {
          this.abstractLogger.log(`Đăng Video lên Facebook Page ${pageId}...`);
          const response = await axios.post(`${this.baseUrl}/${pageId}/videos`, {
            description: content,
            file_url: mediaUrls[0],
            access_token: accessToken,
          });

          this.checkBUCRateLimit(response.headers);

          return {
            success: true,
            publishedPostId: response.data.id,
            url: `https://facebook.com/${response.data.id}`,
          };
        }

        // 2. Trường hợp đăng ảnh đơn (Single Photo)
        if (mediaUrls.length === 1) {
          this.abstractLogger.log(`Đăng ảnh đơn lên Facebook Page ${pageId}...`);
          const response = await axios.post(`${this.baseUrl}/${pageId}/photos`, {
            caption: content,
            url: mediaUrls[0],
            access_token: accessToken,
          });

          this.checkBUCRateLimit(response.headers);

          return {
            success: true,
            publishedPostId: response.data.id,
            url: `https://facebook.com/${response.data.id}`,
          };
        }

        // 3. Trường hợp đăng nhiều ảnh (Carousel / Multi-photos, max 10 ảnh)
        if (mediaUrls.length > 1) {
          this.abstractLogger.log(`Đăng Carousel ${mediaUrls.length} ảnh lên Facebook Page ${pageId}...`);
          
          // Bước A: Upload từng ảnh ở dạng ẩn (published=false) để lấy attachment IDs
          const attachedMediaIds: string[] = [];
          for (const url of mediaUrls.slice(0, 10)) { // Giới hạn max 10 ảnh theo Graph API
            const uploadRes = await axios.post(`${this.baseUrl}/${pageId}/photos`, {
              url,
              published: false,
              access_token: accessToken,
            });
            attachedMediaIds.push(uploadRes.data.id);
          }

          // Bước B: Tạo bài post chính liên kết với các attachment IDs trên
          const attachedMediaPayload = attachedMediaIds.map((id) => ({
            media_fbid: id,
          }));

          const response = await axios.post(`${this.baseUrl}/${pageId}/feed`, {
            message: content,
            attached_media: attachedMediaPayload,
            access_token: accessToken,
          });

          this.checkBUCRateLimit(response.headers);

          return {
            success: true,
            publishedPostId: response.data.id,
            url: `https://facebook.com/${response.data.id}`,
          };
        }

        // 4. Trường hợp đăng Text thuần túy / Link preview
        this.abstractLogger.log(`Đăng bài viết text lên Facebook Page ${pageId}...`);
        const response = await axios.post(`${this.baseUrl}/${pageId}/feed`, {
          message: content,
          link: options?.link, // Tùy chọn chèn link preview
          access_token: accessToken,
        });

        this.checkBUCRateLimit(response.headers);

        return {
          success: true,
          publishedPostId: response.data.id,
          url: `https://facebook.com/${response.data.id}`,
        };
      });

    } catch (error: any) {
      return this.handleFacebookError(error);
    }
  }

  /**
   * Đăng Facebook Reels — Sử dụng 3-phase upload protocol (start / transfer / finish)
   * Yêu cầu: Video dọc 9:16, ≤90 giây, H.264 codec
   */
  private async publishReels(
    description: string,
    videoUrl: string,
    accessToken: string,
    pageId: string
  ): Promise<PublishResult> {
    return await this.executeResiliently('facebook', async () => {
      this.abstractLogger.log(`🎬 Đăng Reels lên Facebook Page ${pageId} (3-phase upload)...`);

      // PHASE 1: Khởi tạo upload session
      const startRes = await axios.post(
        `${this.baseUrl}/${pageId}/video_reels`,
        {
          upload_phase: 'start',
          access_token: accessToken,
        }
      );
      const { video_id } = startRes.data;
      this.checkBUCRateLimit(startRes.headers);

      // PHASE 2: Upload video binary — dùng graph-video endpoint
      const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
      const videoBuffer = Buffer.from(videoResponse.data);

      await axios.post(
        `https://rupload.facebook.com/video-upload/v22.0/${video_id}`,
        videoBuffer,
        {
          headers: {
            Authorization: `OAuth ${accessToken}`,
            'Content-Type': 'application/octet-stream',
            offset: '0',
            file_size: videoBuffer.byteLength.toString(),
          },
        }
      );

      // PHASE 3: Publish Reels với metadata
      const finishRes = await axios.post(
        `${this.baseUrl}/${pageId}/video_reels`,
        {
          upload_phase: 'finish',
          video_id,
          description,
          access_token: accessToken,
        }
      );

      this.abstractLogger.log(`✅ Reels đăng thành công! Video ID: ${video_id}`);

      return {
        success: true,
        publishedPostId: finishRes.data.id || video_id,
        url: `https://facebook.com/reel/${video_id}`,
      };
    });
  }

  /**
   * Đăng Facebook Story (ảnh hoặc video, hiển thị 24h)
   */
  private async publishStory(
    mediaUrl: string,
    accessToken: string,
    pageId: string
  ): Promise<PublishResult> {
    return await this.executeResiliently('facebook', async () => {
      const isVideo = mediaUrl.match(/\.(mp4|mov|avi)$/i);
      const endpoint = isVideo ? 'video_stories' : 'photo_stories';

      this.abstractLogger.log(`📸 Đăng Story (${isVideo ? 'video' : 'photo'}) lên Facebook Page ${pageId}...`);

      // Upload media ẩn trước
      let mediaId: string;
      if (isVideo) {
        const uploadRes = await axios.post(`${this.baseUrl}/${pageId}/videos`, {
          file_url: mediaUrl,
          published: false,
          access_token: accessToken,
        });
        mediaId = uploadRes.data.id;
      } else {
        const uploadRes = await axios.post(`${this.baseUrl}/${pageId}/photos`, {
          url: mediaUrl,
          published: false,
          access_token: accessToken,
        });
        mediaId = uploadRes.data.id;
      }

      // Publish story
      const response = await axios.post(`${this.baseUrl}/${pageId}/${endpoint}`, {
        [isVideo ? 'video_id' : 'photo_id']: mediaId,
        access_token: accessToken,
      });

      this.checkBUCRateLimit(response.headers);

      return {
        success: true,
        publishedPostId: response.data.id,
        url: `https://facebook.com/stories/${response.data.id}`,
      };
    });
  }

  /**
   * Xử lý lỗi Facebook API tập trung — phân loại mã lỗi cho BullMQ retry logic
   */
  private handleFacebookError(error: any): PublishResult {
    const fbError = error.response?.data?.error;
    const errorMsg = fbError
      ? `[FB API Error ${fbError.code}]: ${fbError.message}`
      : error.message;

    this.abstractLogger.error(`Đăng bài lên Facebook thất bại: ${errorMsg}`);
    
    // Phân loại mã lỗi cụ thể của Meta để worker BullMQ nhận biết
    const isTokenExpired = fbError?.code === 190;
    const isRateLimit = fbError?.code === 4 || fbError?.code === 17 || fbError?.code === 32;
    const isPermission = fbError?.code === 200 || fbError?.code === 10;

    return {
      success: false,
      error: isTokenExpired 
        ? 'TOKEN_EXPIRED: Facebook Access Token đã hết hạn hoặc bị thu hồi' 
        : isRateLimit 
          ? 'RATE_LIMIT: Đã vượt quá giới hạn API gọi tới Facebook'
          : isPermission
            ? 'PERMISSION_DENIED: Ứng dụng không có quyền thực hiện hành động này'
            : errorMsg,
    };
  }

  /**
   * Xóa bài viết
   */
  async delete(publishedPostId: string): Promise<boolean> {
    if (publishedPostId.startsWith('fb_post_mock_')) {
      return true;
    }

    try {
      return await this.executeResiliently('facebook', async () => {
        await axios.delete(`${this.baseUrl}/${publishedPostId}`);
        return true;
      });
    } catch (error: any) {
      this.abstractLogger.error(`Xóa bài viết Facebook ${publishedPostId} thất bại: ${error.message}`);
      return false;
    }
  }

  /**
   * Lấy số liệu thống kê bài đăng
   */
  async getInsights(publishedPostId: string): Promise<Record<string, any>> {
    if (publishedPostId.startsWith('fb_post_mock_')) {
      return {
        reach: Math.floor(Math.random() * 5000) + 100,
        impressions: Math.floor(Math.random() * 8000) + 150,
        engagement: Math.floor(Math.random() * 1000) + 20,
        clicks: Math.floor(Math.random() * 200) + 5,
      };
    }

    try {
      return await this.executeResiliently('facebook', async () => {
        const response = await axios.get(`${this.baseUrl}/${publishedPostId}/insights`, {
          params: {
            metric: 'post_impressions_unique,post_impressions,post_engaged_users,post_clicks',
          },
        });

        const metrics = response.data.data || [];
        const result: Record<string, any> = {};

        metrics.forEach((item: any) => {
          const value = item.values?.[0]?.value || 0;
          if (item.name === 'post_impressions_unique') result.reach = value;
          if (item.name === 'post_impressions') result.impressions = value;
          if (item.name === 'post_engaged_users') result.engagement = value;
          if (item.name === 'post_clicks') result.clicks = value;
        });

        return result;
      });
    } catch (error: any) {
      this.abstractLogger.error(`Lấy insights bài viết Facebook ${publishedPostId} thất bại: ${error.message}`);
      return {};
    }
  }

  /**
   * Phân tích Meta BUC (Business Use Case) Rate Limiting Header
   */
  private checkBUCRateLimit(headers: any) {
    const bucUsageHeader = headers?.['x-business-use-case-usage'];
    if (!bucUsageHeader) return;

    try {
      // Ví dụ BUC header format: {"1234567890":[{"type":"ads_management","call_count":15,"total_cputime":5,"total_time":10,"estimated_time_to_regain_access":0}]}
      const usageData = JSON.parse(bucUsageHeader);
      for (const key of Object.keys(usageData)) {
        const stats = usageData[key]?.[0];
        if (stats) {
          const maxPercent = Math.max(stats.call_count || 0, stats.total_cputime || 0, stats.total_time || 0);
          if (maxPercent > 75) {
            this.abstractLogger.warn(
              `⚠️ [BUC RATE LIMIT] Cảnh báo: Tài khoản Facebook ${key} đang tiệm cận giới hạn cuộc gọi (${maxPercent}%). Ưu tiên kéo giãn khoảng cách API.`
            );
          }
        }
      }
    } catch (e: any) {
      this.abstractLogger.error(`Lỗi phân tích BUC header: ${e.message}`);
    }
  }
}
