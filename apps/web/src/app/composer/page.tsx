'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Facebook, Youtube, Video, Image as ImageIcon, Send, Save, Sparkles, Eye, Check, AlertCircle, X, ShieldCheck } from 'lucide-react';
import { CHAR_LIMITS, PLATFORM_LABELS, PLATFORM_COLORS } from '../../lib/constants';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

// ============================================================
// Types
// ============================================================
interface SocialAccount {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  status: string;
}

type PreviewPlatform = 'facebook' | 'youtube' | 'tiktok';

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Video,
};

// ============================================================
// Main Component Content
// ============================================================
function ComposerContent() {
  const { workspaceId, showNotification } = useAppStore();
  const searchParams = useSearchParams();
  const scheduleParam = searchParams.get('schedule');

  // Parse schedule param from calendar to auto-fill the schedule picker
  useEffect(() => {
    if (scheduleParam) {
      try {
        const decoded = decodeURIComponent(scheduleParam);
        // datetime-local input expects YYYY-MM-DDTHH:mm
        const formatted = decoded.substring(0, 16);
        setScheduledAt(formatted);
        showNotification('info', `📅 Đã tự động chọn lịch đăng: ${new Date(formatted).toLocaleString('vi-VN')}`);
      } catch (e) {
        console.error('Failed to parse schedule param:', e);
      }
    }
  }, [scheduleParam, showNotification]);

  // Account data from API
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Selected account IDs (the core fix!)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // Composer state
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [contentType, setContentType] = useState('feed');
  const [scheduledAt, setScheduledAt] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const [mediaSource, setMediaSource] = useState<'upload' | 'url'>('upload');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      showNotification('error', 'Dung lượng file vượt quá giới hạn 100MB!');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.upload<{ url: string; filename: string }>('/media/upload', formData);
      setMediaUrl(res.url);
      showNotification('success', `📁 Tải lên thành công: ${file.name}`);
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi khi tải lên file!');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlChange = (val: string) => {
    setMediaUrl(val);
    if (val && val.match(/\.(mp4|mov|avi|webm)$/i)) {
      showNotification('error', 'Đính kèm link chỉ hỗ trợ hình ảnh (PNG, JPG, GIF). Vui lòng dùng tab "Tải từ máy" để đăng Video!');
    }
  };

  // Preview
  const [previewPlatform, setPreviewPlatform] = useState<PreviewPlatform>('facebook');

  // ============================================================
  // Load REAL accounts from API
  // ============================================================
  useEffect(() => {
    loadAccounts();
  }, [workspaceId]);

  const loadAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const result = await api.get<SocialAccount[]>(
        '/social-auth/accounts',
        { workspaceId },
      );
      // API returns flat array — filter only active accounts
      const allAccounts = Array.isArray(result) ? result : [];
      const activeAccounts = allAccounts.filter(a => a.status === 'active');
      setAccounts(activeAccounts);
    } catch {
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // ============================================================
  // Derived data
  // ============================================================

  // Group accounts by platform
  const accountsByPlatform = useMemo(() => {
    const grouped: Record<string, SocialAccount[]> = {};
    for (const acc of accounts) {
      if (!grouped[acc.platform]) grouped[acc.platform] = [];
      grouped[acc.platform].push(acc);
    }
    return grouped;
  }, [accounts]);

  // Which platforms have selected accounts
  const selectedPlatforms = useMemo(() => {
    const platforms = new Set<string>();
    for (const id of selectedAccountIds) {
      const acc = accounts.find(a => a.id === id);
      if (acc) platforms.add(acc.platform);
    }
    return platforms;
  }, [selectedAccountIds, accounts]);

  // Selected accounts detail
  const selectedAccounts = useMemo(() => {
    return accounts.filter(a => selectedAccountIds.includes(a.id));
  }, [selectedAccountIds, accounts]);

  // First selected account for preview
  const previewAccount = useMemo(() => {
    const platformAccounts = selectedAccounts.filter(a => a.platform === previewPlatform);
    return platformAccounts[0] || selectedAccounts[0] || null;
  }, [selectedAccounts, previewPlatform]);

  // ============================================================
  // Handlers
  // ============================================================

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds(prev => {
      if (prev.includes(accountId)) {
        return prev.filter(id => id !== accountId);
      }
      return [...prev, accountId];
    });
  };

  const selectAllInPlatform = (platform: string) => {
    const platformAccIds = (accountsByPlatform[platform] || []).map(a => a.id);
    const allSelected = platformAccIds.every(id => selectedAccountIds.includes(id));

    if (allSelected) {
      // Deselect all in this platform
      setSelectedAccountIds(prev => prev.filter(id => !platformAccIds.includes(id)));
    } else {
      // Select all in this platform
      setSelectedAccountIds(prev => {
        const newIds = [...prev];
        for (const id of platformAccIds) {
          if (!newIds.includes(id)) newIds.push(id);
        }
        return newIds;
      });
    }
  };

  const getActiveCharLimit = () => {
    if (selectedPlatforms.size === 0) return 63206;
    return Math.min(...Array.from(selectedPlatforms).map(k => CHAR_LIMITS[k] || 63206));
  };

  // Pre-publish validation — opens confirm modal
  const requestPublish = () => {
    if (!postContent.trim()) {
      showNotification('error', 'Nội dung bài viết không được để trống!');
      return;
    }
    if (selectedAccountIds.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một Page/Kênh để đăng bài!');
      return;
    }
    if (mediaSource === 'url' && mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i)) {
      showNotification('error', 'Đính kèm link chỉ hỗ trợ hình ảnh. Vui lòng sử dụng tab "Tải từ máy" để đăng Video!');
      return;
    }
    setShowConfirmModal(true);
  };

  const handlePublish = async (isDraft = false) => {
    if (!postContent.trim()) {
      showNotification('error', 'Nội dung bài viết không được để trống!');
      return;
    }

    if (!isDraft && selectedAccountIds.length === 0) {
      showNotification('error', 'Vui lòng chọn ít nhất một Page/Kênh để đăng bài!');
      return;
    }

    setShowConfirmModal(false);

    setIsPublishing(true);
    try {
      const body: Record<string, any> = {
        workspaceId,
        title: postTitle || undefined,
        content: postContent,
        contentType,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
      };

      // THE KEY FIX: Send socialAccountIds!
      if (!isDraft && selectedAccountIds.length > 0) {
        body.socialAccountIds = selectedAccountIds;
      }

      // Send scheduledAt if set
      if (scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      await api.post('/posts', body);

      if (isDraft) {
        showNotification('success', '💾 Đã lưu bản nháp!');
      } else if (scheduledAt) {
        showNotification('success', `📅 Đã lên lịch đăng cho ${selectedAccountIds.length} tài khoản!`);
      } else {
        showNotification('success', `🚀 Đang đăng bài lên ${selectedAccountIds.length} tài khoản! Kiểm tra trạng thái ở Lịch Đăng Bài.`);
      }

      if (!isDraft) {
        setPostTitle('');
        setPostContent('');
        setMediaUrl('');
        setScheduledAt('');
        setSelectedAccountIds([]);
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

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      <div className="page-header">
        <h2>Trình Biên Soạn Đa Kênh</h2>
        <p>Chọn Page → Viết nội dung → Đăng bài thật lên Facebook, YouTube, TikTok.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--space-xl)' }}>
        {/* LEFT — Editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>

          {/* ====== ACCOUNT PICKER ====== */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                Chọn Page / Kênh Đăng Bài
                {selectedAccountIds.length > 0 && (
                  <span style={{
                    marginLeft: '8px',
                    padding: '2px 10px',
                    background: 'var(--color-brand-glow)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 700,
                    color: 'var(--color-brand-primary)',
                  }}>
                    {selectedAccountIds.length} đã chọn
                  </span>
                )}
              </span>
            </div>

            {loadingAccounts ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <span className="spinner" style={{ marginRight: '8px' }} />
                Đang tải danh sách tài khoản...
              </div>
            ) : accounts.length === 0 ? (
              <div style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                background: 'var(--color-surface-1)',
                borderRadius: 'var(--radius-md)',
              }}>
                <AlertCircle size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>Chưa kết nối tài khoản nào</div>
                <div style={{ fontSize: 'var(--font-size-xs)' }}>
                  Vào <a href="/accounts" style={{ color: 'var(--color-brand-primary)' }}>Tài Khoản MXH</a> để kết nối Facebook, YouTube, TikTok.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {Object.entries(accountsByPlatform).map(([platform, platformAccounts]) => {
                  const Icon = PLATFORM_ICONS[platform] || Video;
                  const color = PLATFORM_COLORS[platform] || '#6366f1';
                  const allSelected = platformAccounts.every(a => selectedAccountIds.includes(a.id));
                  const someSelected = platformAccounts.some(a => selectedAccountIds.includes(a.id));

                  return (
                    <div key={platform} style={{
                      background: 'var(--color-surface-1)',
                      borderRadius: 'var(--radius-md)',
                      border: someSelected ? `1px solid ${color}40` : '1px solid var(--color-border)',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s',
                    }}>
                      {/* Platform header — select all toggle */}
                      <div
                        onClick={() => selectAllInPlatform(platform)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 14px',
                          cursor: 'pointer',
                          background: someSelected ? `${color}08` : 'transparent',
                          borderBottom: '1px solid var(--color-border)',
                          transition: 'background 0.15s',
                        }}
                      >
                        <div style={{
                          width: '18px', height: '18px',
                          borderRadius: '4px',
                          border: allSelected ? `2px solid ${color}` : '2px solid var(--color-text-muted)',
                          background: allSelected ? color : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s',
                          flexShrink: 0,
                        }}>
                          {allSelected && <Check size={12} color="#fff" />}
                        </div>
                        <Icon size={16} style={{ color }} />
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', flex: 1 }}>
                          {PLATFORM_LABELS[platform] || platform}
                        </span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                          {platformAccounts.length} tài khoản
                        </span>
                      </div>

                      {/* Individual accounts */}
                      <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                        {platformAccounts.map(acc => {
                          const isSelected = selectedAccountIds.includes(acc.id);
                          return (
                            <div
                              key={acc.id}
                              onClick={() => toggleAccount(acc.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '8px 14px 8px 28px',
                                cursor: 'pointer',
                                background: isSelected ? `${color}06` : 'transparent',
                                transition: 'background 0.1s',
                                borderBottom: '1px solid rgba(255,255,255,0.03)',
                              }}
                            >
                              <div style={{
                                width: '16px', height: '16px',
                                borderRadius: '3px',
                                border: isSelected ? `2px solid ${color}` : '2px solid rgba(148,163,184,0.3)',
                                background: isSelected ? color : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                                flexShrink: 0,
                              }}>
                                {isSelected && <Check size={10} color="#fff" />}
                              </div>
                              <img
                                src={acc.avatarUrl}
                                alt=""
                                style={{
                                  width: '28px', height: '28px',
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  border: '2px solid var(--color-border)',
                                  flexShrink: 0,
                                }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.displayName)}&background=334155&color=e2e8f0&size=28`;
                                }}
                              />
                              <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{
                                  fontWeight: 600,
                                  fontSize: '13px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  color: isSelected ? '#f1f5f9' : 'var(--color-text-secondary)',
                                }}>
                                  {acc.displayName}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ====== CONTENT EDITOR ====== */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Nội Dung Bài Viết</span>
              <button className="btn btn-ghost btn-sm">
                <Sparkles size={16} />
                AI Gợi Ý
              </button>
            </div>

            {/* Title (optional for YT/TT) */}
            {(selectedPlatforms.has('youtube') || selectedPlatforms.has('tiktok')) && (
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
            )}

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

            {/* Media Upload & URL Selector */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Đính kèm hình ảnh / video</span>
                {mediaUrl && (
                  <button 
                    onClick={() => setMediaUrl('')}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--color-error)', fontSize: '11px', fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px'
                    }}
                  >
                    <X size={12} /> Gỡ bỏ file
                  </button>
                )}
              </label>

              {/* Source Tab Selector */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                <button
                  type="button"
                  onClick={() => { setMediaSource('upload'); setMediaUrl(''); }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '10px',
                    border: mediaSource === 'upload' ? '2px solid var(--color-brand-primary)' : '1px solid var(--color-border)',
                    background: mediaSource === 'upload' ? 'var(--color-brand-glow)' : 'var(--color-surface-1)',
                    color: mediaSource === 'upload' ? 'var(--color-brand-primary)' : 'var(--color-text-secondary)',
                    fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'all 0.15s'
                  }}
                >
                  📁 Tải lên từ máy
                </button>
                <button
                  type="button"
                  onClick={() => { setMediaSource('url'); setMediaUrl(''); }}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '10px',
                    border: mediaSource === 'url' ? '2px solid var(--color-brand-primary)' : '1px solid var(--color-border)',
                    background: mediaSource === 'url' ? 'var(--color-brand-glow)' : 'var(--color-surface-1)',
                    color: mediaSource === 'url' ? 'var(--color-brand-primary)' : 'var(--color-text-secondary)',
                    fontWeight: 600, fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'all 0.15s'
                  }}
                >
                  🔗 Đính kèm URL (chỉ ảnh)
                </button>
              </div>

              {/* Upload source zone */}
              {mediaSource === 'upload' ? (
                <div style={{
                  border: '2px dashed var(--color-border)',
                  borderRadius: '12px',
                  padding: '24px',
                  textAlign: 'center',
                  background: 'var(--color-surface-1)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '8px'
                }}
                  onClick={() => document.getElementById('media-file-input')?.click()}
                >
                  <input
                    id="media-file-input"
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  {isUploading ? (
                    <>
                      <span className="spinner" style={{ width: '28px', height: '28px' }} />
                      <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                        Đang tải file lên...
                      </div>
                    </>
                  ) : mediaUrl ? (
                    <>
                      {mediaUrl.match(/\.(mp4|mov|avi|webm)$/i) ? (
                        <video src={mediaUrl} style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '6px' }} controls onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <img src={mediaUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '6px', objectFit: 'contain' }} />
                      )}
                      <div style={{ fontSize: '12px', color: 'var(--color-success)', fontWeight: 600 }}>
                        ✓ Đã chọn file thành công! Click để chọn file khác
                      </div>
                    </>
                  ) : (
                    <>
                      <ImageIcon size={32} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                          Kéo thả hoặc click để chọn Ảnh / Video
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Hỗ trợ PNG, JPG, GIF, MP4, MOV tối đa 100MB
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    className="input"
                    placeholder="Nhập đường dẫn hình ảnh (https://...)"
                    value={mediaUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    style={{
                      border: mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i)
                        ? '1.5px solid var(--color-error)'
                        : '1px solid var(--color-border)'
                    }}
                  />
                  <div style={{
                    fontSize: '11px',
                    color: mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i) ? 'var(--color-error)' : 'var(--color-text-muted)',
                    marginTop: '6px',
                    fontWeight: 500
                  }}>
                    {mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i)
                      ? '⚠️ Đính kèm link không hỗ trợ video! Hãy chọn tab "Tải lên từ máy".'
                      : 'ℹ️ Chỉ đính kèm hình ảnh. Link video sẽ không được chấp nhận.'
                    }
                  </div>
                </div>
              )}
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

          {/* ====== ACTION BUTTONS ====== */}
          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <button
              className="btn btn-primary btn-lg"
              disabled={isPublishing || selectedAccountIds.length === 0}
              onClick={requestPublish}
              style={{ flex: 1, opacity: selectedAccountIds.length === 0 ? 0.5 : 1 }}
            >
              {isPublishing ? <span className="spinner" /> : <Send size={18} />}
              {isPublishing
                ? 'Đang xử lý...'
                : selectedAccountIds.length === 0
                  ? 'Chọn Page để đăng bài'
                  : scheduledAt
                    ? `📅 Hẹn Giờ Đăng (${selectedAccountIds.length} Page)`
                    : `🚀 Đăng Ngay (${selectedAccountIds.length} Page)`
              }
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

        {/* ====== RIGHT — LIVE PREVIEW ====== */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
            <div className="card-header">
              <span className="card-title">
                <Eye size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                Live Preview
              </span>
            </div>

            {/* Platform preview tabs — only show platforms with selected accounts */}
            {selectedPlatforms.size > 0 && (
              <div style={{ display: 'flex', gap: '4px', marginBottom: 'var(--space-md)' }}>
                {Array.from(selectedPlatforms).map(platform => (
                  <button
                    key={platform}
                    className={`btn btn-sm ${previewPlatform === platform ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPreviewPlatform(platform as PreviewPlatform)}
                    style={{ fontSize: 'var(--font-size-xs)' }}
                  >
                    {PLATFORM_LABELS[platform] || platform}
                  </button>
                ))}
              </div>
            )}

            {/* Preview card */}
            <div style={{
              background: previewPlatform === 'facebook' ? '#242526' : previewPlatform === 'youtube' ? '#0f0f0f' : '#121212',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-md)',
              minHeight: '300px',
            }}>
              {/* Header with REAL page info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                {previewAccount ? (
                  <>
                    <img
                      src={previewAccount.avatarUrl}
                      alt=""
                      style={{
                        width: '40px', height: '40px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid rgba(255,255,255,0.1)',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(previewAccount.displayName)}&background=334155&color=e2e8f0&size=40`;
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#e4e6eb' }}>
                        {previewAccount.displayName}
                      </div>
                      <div style={{ fontSize: '12px', color: '#999' }}>
                        {previewPlatform === 'facebook' ? 'Just now · 🌐' : previewPlatform === 'youtube' ? 'Published just now' : previewAccount.username}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: '40px', height: '40px',
                      borderRadius: '50%',
                      background: 'var(--color-surface-3)',
                    }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: '#666' }}>Chọn Page bên trái</div>
                      <div style={{ fontSize: '12px', color: '#555' }}>để xem preview</div>
                    </div>
                  </>
                )}
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

            {/* Selected accounts summary */}
            {selectedAccounts.length > 0 && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <div style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  Sẽ đăng lên {selectedAccounts.length} tài khoản:
                </div>
                {selectedAccounts.map(acc => {
                  const color = PLATFORM_COLORS[acc.platform] || '#6366f1';
                  return (
                    <div key={acc.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 0',
                      fontSize: 'var(--font-size-xs)',
                    }}>
                      <div style={{
                        width: '6px', height: '6px',
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }} />
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--color-text-secondary)',
                      }}>
                        {acc.displayName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Character limit warnings */}
            {selectedPlatforms.size > 0 && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                {Array.from(selectedPlatforms).map(key => {
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
            )}
          </div>
        </div>
      </div>

      {/* ====== CONFIRMATION MODAL ====== */}
      {showConfirmModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease',
        }}
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: '20px',
              padding: '28px',
              width: '480px',
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px', height: '40px',
                  borderRadius: '12px',
                  background: scheduledAt ? 'rgba(99, 102, 241, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {scheduledAt
                    ? <ShieldCheck size={20} style={{ color: '#818cf8' }} />
                    : <Send size={20} style={{ color: '#22c55e' }} />
                  }
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                    {scheduledAt ? 'Xác Nhận Hẹn Giờ' : 'Xác Nhận Đăng Bài'}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    Kiểm tra lại trước khi {scheduledAt ? 'lên lịch' : 'đăng'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Content preview */}
            <div style={{
              background: 'var(--color-surface-1)',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '16px',
              border: '1px solid var(--color-border)',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Nội dung
              </div>
              <div style={{
                fontSize: '13px',
                color: 'var(--color-text-primary)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                maxHeight: '80px',
                overflow: 'hidden',
              }}>
                {postContent.substring(0, 200)}{postContent.length > 200 ? '...' : ''}
              </div>
              {scheduledAt && (
                <div style={{
                  marginTop: '8px',
                  padding: '6px 10px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#818cf8',
                }}>
                  📅 Lên lịch: {new Date(scheduledAt).toLocaleString('vi-VN')}
                </div>
              )}
            </div>

            {/* Selected accounts */}
            <div style={{
              background: 'var(--color-surface-1)',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '20px',
              border: '1px solid var(--color-border)',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Đăng lên {selectedAccounts.length} tài khoản
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selectedAccounts.map(acc => {
                  const color = PLATFORM_COLORS[acc.platform] || '#6366f1';
                  return (
                    <div key={acc.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '6px 8px',
                      background: `${color}08`,
                      borderRadius: '8px',
                    }}>
                      <img
                        src={acc.avatarUrl} alt=""
                        style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.displayName)}&size=24`; }}
                      />
                      <span style={{ fontSize: '13px', fontWeight: 500, flex: 1 }}>{acc.displayName}</span>
                      <span style={{
                        fontSize: '10px', fontWeight: 700,
                        padding: '2px 6px', borderRadius: '4px',
                        background: `${color}15`, color,
                        textTransform: 'uppercase',
                      }}>
                        {acc.platform}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1, padding: '12px',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '12px',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px', fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Hủy
              </button>
              <button
                onClick={() => handlePublish(false)}
                disabled={isPublishing}
                style={{
                  flex: 2, padding: '12px',
                  background: scheduledAt
                    ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                    : 'linear-gradient(135deg, #22c55e, #4ade80)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                {isPublishing ? (
                  <><span className="spinner" /> Đang xử lý...</>
                ) : scheduledAt ? (
                  <>📅 Xác Nhận Hẹn Giờ</>
                ) : (
                  <>🚀 Xác Nhận Đăng Bài</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

export default function ComposerPage() {
  return (
    <Suspense fallback={
      <div style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px'
      }}>
        <span className="spinner" style={{ width: '32px', height: '32px' }} />
        <div style={{ fontSize: '14px', fontWeight: 600 }}>Đang tải trình biên soạn...</div>
      </div>
    }>
      <ComposerContent />
    </Suspense>
  );
}
