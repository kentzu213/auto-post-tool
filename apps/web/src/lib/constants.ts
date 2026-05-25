/**
 * Platform-specific constants and configuration
 */

export const CHAR_LIMITS: Record<string, number> = {
  facebook: 63206,
  youtube: 5000,
  tiktok: 2200,
};

export const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

export const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2',
  youtube: '#FF0000',
  tiktok: '#25F4EE',
};

export const CONTENT_TYPES = [
  { value: 'feed', label: 'Feed Post' },
  { value: 'reels', label: 'Reels / Shorts' },
  { value: 'story', label: 'Story' },
  { value: 'shorts', label: 'YT Shorts' },
] as const;

export const POST_STATUSES: Record<string, { label: string; badgeClass: string }> = {
  draft: { label: 'Nháp', badgeClass: 'badge-info' },
  pending_approval: { label: 'Chờ duyệt', badgeClass: 'badge-warning' },
  scheduled: { label: 'Đã lên lịch', badgeClass: 'badge-info' },
  publishing: { label: 'Đang đăng', badgeClass: 'badge-warning' },
  published: { label: 'Đã đăng', badgeClass: 'badge-success' },
  failed: { label: 'Thất bại', badgeClass: 'badge-error' },
};
