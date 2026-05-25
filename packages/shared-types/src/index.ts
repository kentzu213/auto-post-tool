export type Platform = 'facebook' | 'youtube' | 'tiktok';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export type SocialAccountStatus = 'active' | 'expired' | 'disconnected';

export interface SocialAccount {
  id: string;
  platform: Platform;
  displayName: string;
  username: string;
  avatarUrl?: string;
  status: SocialAccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Post {
  id: string;
  workspaceId: string;
  title?: string;
  content: string;
  mediaUrls: string[];
  platforms: Platform[];
  scheduledAt?: Date;
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'approver' | 'viewer';
}
