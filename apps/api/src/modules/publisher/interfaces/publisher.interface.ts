import { Platform } from '@auto-post/shared-types';

export interface PublishResult {
  success: boolean;
  publishedPostId?: string;
  error?: string;
  url?: string; // URL trực tiếp của bài viết sau khi đăng thành công (nếu có)
}

export interface IPublisher {
  /**
   * Xác thực token liên kết tài khoản
   */
  validate(accessToken: string): Promise<boolean>;

  /**
   * Đăng bài viết lên mạng xã hội tương ứng
   * @param content Nội dung văn bản (caption/status)
   * @param mediaUrls Danh sách URL hình ảnh hoặc video đã được tải lên Cloud Storage tạm thời
   * @param options Các cấu hình bổ sung tùy chỉnh cho từng nền tảng (ví dụ: thumbnail, title, privacy, v.v.)
   */
  publish(
    content: string,
    mediaUrls: string[],
    options?: Record<string, any>
  ): Promise<PublishResult>;

  /**
   * Xóa bài viết đã đăng trên mạng xã hội
   */
  delete(publishedPostId: string): Promise<boolean>;

  /**
   * Lấy số liệu thống kê (insights/engagement) của bài viết đã đăng
   */
  getInsights(publishedPostId: string): Promise<Record<string, any>>;
}
