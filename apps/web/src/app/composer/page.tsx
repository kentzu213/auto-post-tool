'use client';

import React, { useState } from 'react';
import { Facebook, Youtube, Video, Image as ImageIcon, Send, Save, Sparkles, Eye } from 'lucide-react';
import { CHAR_LIMITS, PLATFORM_LABELS } from '../../lib/constants';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

type PreviewPlatform = 'facebook' | 'youtube' | 'tiktok';

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook', icon: Facebook, color: 'var(--color-facebook)' },
  { key: 'youtube', label: 'YouTube', icon: Youtube, color: 'var(--color-youtube)' },
  { key: 'tiktok', label: 'TikTok', icon: Video, color: '#25F4EE' },
];

export default function ComposerPage() {
  const { workspaceId, showNotification } = useAppStore();

  // Composer state
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [contentType, setContentType] = useState('feed');
  const [scheduledAt, setScheduledAt] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  // Platform selection
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({
    facebook: true,
    youtube: false,
    tiktok: false,
  });

  // Preview
  const [previewPlatform, setPreviewPlatform] = useState<PreviewPlatform>('facebook');

  const togglePlatform = (key: string) => {
    setSelectedPlatforms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (next[key]) setPreviewPlatform(key as PreviewPlatform);
      return next;
    });
  };

  const getActiveCharLimit = () => {
    const active = Object.keys(selectedPlatforms).filter((k) => selectedPlatforms[k]);
    if (active.length === 0) return 63206;
    return Math.min(...active.map((k) => CHAR_LIMITS[k] || 63206));
  };

  const handlePublish = async (isDraft = false) => {
    if (!postContent.trim()) {
      showNotification('error', 'Nội dung bài viết không được để trống!');
      return;
    }

    const platformsToPublish = Object.keys(selectedPlatforms).filter((k) => selectedPlatforms[k]);
    if (platformsToPublish.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một nền tảng!');
      return;
    }

    setIsPublishing(true);
    try {
      await api.post('/posts', {
        workspaceId,
        title: postTitle || undefined,
        content: postContent,
        contentType,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        scheduledAt: scheduledAt || undefined,
      });

      showNotification('success', isDraft ? 'Đã lưu bản nháp!' : 'Đã tạo bài viết thành công!');

      if (!isDraft) {
        setPostTitle('');
        setPostContent('');
        setMediaUrl('');
        setScheduledAt('');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Có lỗi xảy ra khi tạo bài viết.');
    } finally {
      setIsPublishing(false);
    }
  };

  const charLimit = getActiveCharLimit();
  const charCount = postContent.length;
  const charPercent = Math.min((charCount / charLimit) * 100, 100);

  return (
    <>
      <div className="page-header">
        <h2>Trình Biên Soạn Đa Kênh</h2>
        <p>Soạn thảo nội dung một lần, tự động căn chỉnh và live preview từng nền tảng.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--space-xl)' }}>
        {/* LEFT — Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {/* Platform Selector */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Chọn Nền Tảng</span>
            </div>
            <div className="platform-toggle">
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.key}
                    className={`platform-chip ${p.key} ${selectedPlatforms[p.key] ? 'selected' : ''}`}
                    onClick={() => togglePlatform(p.key)}
                  >
                    <Icon size={16} />
                    <span>{p.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Content Editor */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Nội Dung Bài Viết</span>
              <button className="btn btn-ghost btn-sm">
                <Sparkles size={16} />
                AI Gợi Ý
              </button>
            </div>

            {/* Title (optional for YT/TT) */}
            <div className="form-group">
              <label className="form-label">Tiêu đề (YouTube / TikTok)</label>
              <input
                className="input"
                placeholder="Nhập tiêu đề bài viết..."
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value)}
                maxLength={100}
              />
            </div>

            {/* Content */}
            <div className="form-group">
              <label className="form-label">Nội dung / Caption</label>
              <textarea
                className="textarea"
                placeholder="Viết nội dung bài đăng ở đây..."
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                style={{ minHeight: '180px' }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '8px',
              }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  Giới hạn thấp nhất: {charLimit.toLocaleString()} ký tự
                </div>
                <div style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  color: charPercent > 90 ? 'var(--color-error)' : charPercent > 70 ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                }}>
                  {charCount.toLocaleString()} / {charLimit.toLocaleString()}
                </div>
              </div>
              {/* Character progress bar */}
              <div style={{
                width: '100%',
                height: '3px',
                background: 'var(--color-surface-1)',
                borderRadius: 'var(--radius-full)',
                marginTop: '4px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${charPercent}%`,
                  height: '100%',
                  background: charPercent > 90 ? 'var(--color-error)' : charPercent > 70 ? 'var(--color-warning)' : 'var(--color-brand-primary)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 0.2s',
                }} />
              </div>
            </div>

            {/* Content Type */}
            <div className="form-group">
              <label className="form-label">Loại nội dung</label>
              <select className="select" value={contentType} onChange={(e) => setContentType(e.target.value)}>
                <option value="feed">📝 Feed Post</option>
                <option value="reels">🎬 Reels / Shorts</option>
                <option value="story">📸 Story</option>
              </select>
            </div>

            {/* Media URL */}
            <div className="form-group">
              <label className="form-label">Đính kèm Media (URL)</label>
              <input
                className="input"
                placeholder="https://cdn.example.com/video.mp4"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
              />
            </div>

            {/* Schedule */}
            <div className="form-group">
              <label className="form-label">Hẹn giờ đăng (để trống = đăng ngay)</label>
              <input
                className="input"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <button
              className="btn btn-primary btn-lg"
              disabled={isPublishing}
              onClick={() => handlePublish(false)}
              style={{ flex: 1 }}
            >
              {isPublishing ? <span className="spinner" /> : <Send size={18} />}
              {isPublishing ? 'Đang xử lý...' : scheduledAt ? 'Hẹn Giờ Đăng Bài' : 'Đăng Bài Ngay'}
            </button>
            <button
              className="btn btn-secondary"
              disabled={isPublishing}
              onClick={() => handlePublish(true)}
            >
              <Save size={18} />
              Lưu Nháp
            </button>
          </div>
        </div>

        {/* RIGHT — Live Preview */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
            <div className="card-header">
              <span className="card-title">
                <Eye size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Live Preview
              </span>
            </div>

            {/* Platform preview tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: 'var(--space-md)' }}>
              {PLATFORMS.filter((p) => selectedPlatforms[p.key]).map((p) => (
                <button
                  key={p.key}
                  className={`btn btn-sm ${previewPlatform === p.key ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPreviewPlatform(p.key as PreviewPlatform)}
                  style={{ fontSize: 'var(--font-size-xs)' }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Preview card */}
            <div style={{
              background: previewPlatform === 'facebook' ? '#242526' : previewPlatform === 'youtube' ? '#0f0f0f' : '#121212',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-md)',
              minHeight: '300px',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: 'var(--color-surface-3)',
                }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>Tên Page / Channel</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    {previewPlatform === 'facebook' ? 'Just now · 🌐' : previewPlatform === 'youtube' ? 'Published just now' : '@username'}
                  </div>
                </div>
              </div>

              {/* Content preview */}
              <div style={{
                color: '#e4e6eb',
                fontSize: '14px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                marginBottom: '12px',
                maxHeight: '200px',
                overflow: 'hidden',
              }}>
                {postContent || '(Nội dung bài viết sẽ hiển thị ở đây...)'}
              </div>

              {/* Media placeholder */}
              {mediaUrl && (
                <div style={{
                  background: 'var(--color-surface-1)',
                  borderRadius: 'var(--radius-sm)',
                  height: '180px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--font-size-sm)',
                }}>
                  <ImageIcon size={24} style={{ marginRight: '8px' }} />
                  Media Preview
                </div>
              )}

              {/* Engagement bar */}
              <div style={{
                display: 'flex',
                gap: '24px',
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                fontSize: '13px',
                color: '#999',
              }}>
                <span>👍 Like</span>
                <span>💬 Comment</span>
                <span>↗️ Share</span>
              </div>
            </div>

            {/* Character limit warnings */}
            <div style={{ marginTop: 'var(--space-md)' }}>
              {Object.entries(selectedPlatforms)
                .filter(([, v]) => v)
                .map(([key]) => {
                  const limit = CHAR_LIMITS[key];
                  const over = charCount > limit;
                  return (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 'var(--font-size-xs)',
                        marginBottom: '4px',
                        color: over ? 'var(--color-error)' : 'var(--color-text-muted)',
                      }}
                    >
                      <span>{PLATFORM_LABELS[key]}</span>
                      <span>{charCount}/{limit.toLocaleString()}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
