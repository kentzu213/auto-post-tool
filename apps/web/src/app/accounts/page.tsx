'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

// ============================================================
// Types
// ============================================================
interface AccountData {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  status: string;
  createdAt?: string;
}

// ============================================================
// Platform Configuration — Postiz-style
// ============================================================
const PLATFORMS = [
  {
    key: 'facebook',
    name: 'Facebook',
    subtitle: 'Pages & Reels',
    description: 'Kết nối Facebook Pages để đăng bài, Reels, Story và quản lý bình luận trực tiếp.',
    color: '#1877F2',
    gradient: 'linear-gradient(135deg, #1877F2, #42A5F5)',
    bgGlow: 'rgba(24, 119, 242, 0.12)',
    permissions: [
      'pages_show_list — Xem danh sách Pages',
      'pages_manage_posts — Đăng bài trên Page',
      'pages_read_engagement — Đọc tương tác',
      'public_profile — Thông tin cơ bản',
    ],
    apiVersion: 'Graph API v22.0',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
  {
    key: 'youtube',
    name: 'YouTube',
    subtitle: 'Channel & Shorts',
    description: 'Liên kết YouTube Channel để upload video, Shorts với hỗ trợ Resumable Upload và thumbnail.',
    color: '#FF0000',
    gradient: 'linear-gradient(135deg, #FF0000, #FF4444)',
    bgGlow: 'rgba(255, 0, 0, 0.10)',
    permissions: [
      'youtube.upload — Upload video lên channel',
      'youtube.readonly — Đọc thông tin kênh',
      'youtube.force-ssl — Kết nối an toàn SSL',
    ],
    apiVersion: 'YouTube Data API v3',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    key: 'tiktok',
    name: 'TikTok',
    subtitle: 'Video & Draft',
    description: 'Kết nối TikTok để đăng video trực tiếp hoặc chế độ Inbox Draft cho nội dung chờ duyệt.',
    color: '#00F2EA',
    gradient: 'linear-gradient(135deg, #00F2EA, #FF0050)',
    bgGlow: 'rgba(0, 242, 234, 0.10)',
    permissions: [
      'user.info.basic — Đọc profile cơ bản',
      'video.upload — Upload video lên TikTok',
      'video.publish — Đăng video công khai',
    ],
    apiVersion: 'Content Posting API v2',
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
  },
];

// ============================================================
// Main Component
// ============================================================
export default function AccountsPage() {
  const { workspaceId, showNotification } = useAppStore();
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();

    // Handle OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_success') === 'true') {
      const p = params.get('platform') || '';
      showNotification('success', `🎉 Liên kết ${p.toUpperCase()} thành công! Tài khoản đã sẵn sàng.`);
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchAccounts();
    } else if (params.get('auth_error') === 'true') {
      showNotification('error', `Liên kết thất bại: ${params.get('message') || 'Lỗi không xác định'}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const data = await api.get<AccountData[]>('/social-auth/accounts', { workspaceId });
      setAccounts(data || []);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const connectAccount = useCallback(async (platform: string) => {
    setConnectingPlatform(platform);
    try {
      const data = await api.get<{ redirectUrl: string }>(`/social-auth/connect/${platform}`, { workspaceId });
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        showNotification('error', 'Không nhận được URL OAuth. Kiểm tra cấu hình API keys.');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi kết nối máy chủ.');
    } finally {
      setConnectingPlatform(null);
    }
  }, [workspaceId]);

  const getAccountForPlatform = (platform: string) => {
    return accounts.find((a) => a.platform === platform && a.status === 'active');
  };

  return (
    <>
      {/* Page header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>
            <span style={styles.titleIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            Kết Nối Tài Khoản Mạng Xã Hội
          </h1>
          <p style={styles.subtitle}>
            Liên kết an toàn qua OAuth 2.0 — Token được mã hóa AES-256-GCM
          </p>
        </div>
        <div style={styles.headerBadge}>
          <span style={styles.connectedCount}>
            {accounts.filter(a => a.status === 'active').length}
          </span>
          <span style={styles.connectedLabel}>Đã kết nối</span>
        </div>
      </div>

      {/* Platform Cards */}
      <div style={styles.grid}>
        {PLATFORMS.map((platform) => {
          const connected = getAccountForPlatform(platform.key);
          const isExpanded = expandedPlatform === platform.key;
          const isConnecting = connectingPlatform === platform.key;

          return (
            <div
              key={platform.key}
              style={{
                ...styles.card,
                borderColor: connected ? `${platform.color}30` : 'rgba(71, 85, 105, 0.2)',
              }}
            >
              {/* Card Header */}
              <div style={styles.cardHeader}>
                <div style={{
                  ...styles.iconWrap,
                  background: platform.bgGlow,
                  color: platform.color,
                  boxShadow: `0 8px 32px ${platform.bgGlow}`,
                }}>
                  {platform.icon}
                </div>

                <div style={styles.cardInfo}>
                  <div style={styles.cardNameRow}>
                    <h3 style={styles.cardName}>{platform.name}</h3>
                    <span style={{
                      ...styles.cardSubtitle,
                      color: platform.color,
                      background: `${platform.color}12`,
                    }}>
                      {platform.subtitle}
                    </span>
                  </div>
                  <p style={styles.cardDesc}>{platform.description}</p>
                </div>

                {/* Status badge */}
                {connected && (
                  <div style={styles.statusBadge}>
                    <div style={styles.statusDot} />
                    Hoạt động
                  </div>
                )}
              </div>

              {/* Connected Account Info */}
              {connected && (
                <div style={styles.connectedInfo}>
                  <img
                    src={connected.avatarUrl || ''}
                    alt={connected.displayName}
                    style={styles.avatar}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(connected.displayName)}&background=${platform.color.replace('#', '')}&color=fff&size=80`;
                    }}
                  />
                  <div style={styles.connectedMeta}>
                    <div style={styles.connectedName}>{connected.displayName}</div>
                    <div style={styles.connectedUsername}>{connected.username}</div>
                  </div>
                  <button
                    onClick={() => connectAccount(platform.key)}
                    disabled={isConnecting}
                    style={styles.reconnectBtn}
                  >
                    {isConnecting ? (
                      <span style={styles.miniSpinner} />
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        Kết nối lại
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Expandable Permissions Panel */}
              <button
                onClick={() => setExpandedPlatform(isExpanded ? null : platform.key)}
                style={styles.detailsToggle}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Quyền truy cập & API ({platform.apiVersion})
              </button>

              {isExpanded && (
                <div style={styles.permissionPanel}>
                  <div style={styles.permissionTitle}>Quyền OAuth yêu cầu:</div>
                  {platform.permissions.map((perm, i) => (
                    <div key={i} style={styles.permissionItem}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={platform.color} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span style={styles.permissionCode}>{perm.split(' — ')[0]}</span>
                      <span style={styles.permissionDesc}> — {perm.split(' — ')[1]}</span>
                    </div>
                  ))}
                  <div style={styles.permissionNote}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 0 0 1.75-2.96l-6.95-12.08a2 2 0 0 0-3.5 0L3.32 16.04A2 2 0 0 0 5.07 19z"/></svg>
                    Token được mã hóa bằng AES-256-GCM trước khi lưu vào database.
                  </div>
                </div>
              )}

              {/* Connect Button */}
              {!connected && (
                <button
                  onClick={() => connectAccount(platform.key)}
                  disabled={isConnecting}
                  style={{
                    ...styles.connectBtn,
                    background: isConnecting ? 'rgba(100,100,100,0.3)' : platform.gradient,
                    boxShadow: isConnecting ? 'none' : `0 8px 24px ${platform.bgGlow}`,
                  }}
                >
                  {isConnecting ? (
                    <>
                      <span style={styles.spinner} />
                      Đang chuyển hướng...
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      Kết nối {platform.name}
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* All Connected Accounts Table */}
      {accounts.length > 0 && (
        <div style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <h3 style={styles.tableTitle}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Tất Cả Tài Khoản ({accounts.length})
            </h3>
          </div>
          <div style={styles.tableBody}>
            {accounts.map((acc) => {
              const platformConfig = PLATFORMS.find(p => p.key === acc.platform);
              return (
                <div key={acc.id} style={styles.tableRow}>
                  <div style={styles.tableRowLeft}>
                    <div style={{
                      ...styles.tableIcon,
                      color: platformConfig?.color || '#6366f1',
                      background: `${platformConfig?.color || '#6366f1'}12`,
                    }}>
                      {platformConfig?.icon || <span>?</span>}
                    </div>
                    <div>
                      <div style={styles.tableRowName}>{acc.displayName}</div>
                      <div style={styles.tableRowUsername}>{acc.username}</div>
                    </div>
                  </div>
                  <div style={styles.tableRowRight}>
                    <span style={{
                      ...styles.statusPill,
                      background: acc.status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      color: acc.status === 'active' ? '#22c55e' : '#ef4444',
                      borderColor: acc.status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: acc.status === 'active' ? '#22c55e' : '#ef4444',
                        display: 'inline-block',
                      }} />
                      {acc.status === 'active' ? 'Hoạt động' : 'Hết hạn'}
                    </span>
                    <span style={styles.tablePlatformName}>
                      {platformConfig?.name || acc.platform}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && accounts.length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(100,116,139,0.4)" strokeWidth="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <h3 style={styles.emptyTitle}>Chưa có tài khoản nào được kết nối</h3>
          <p style={styles.emptyDesc}>
            Bấm "Kết nối" ở một trong các nền tảng phía trên để bắt đầu đăng bài tự động.
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </>
  );
}

// ============================================================
// Styles
// ============================================================
const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    gap: '16px',
    flexWrap: 'wrap',
  },
  headerLeft: {},
  title: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#f1f5f9',
    margin: '0 0 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    letterSpacing: '-0.3px',
  },
  titleIcon: {
    display: 'flex',
    color: '#818cf8',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(148, 163, 184, 0.7)',
    margin: 0,
  },
  headerBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(99, 102, 241, 0.08)',
    border: '1px solid rgba(99, 102, 241, 0.15)',
    borderRadius: '14px',
    padding: '10px 20px',
  },
  connectedCount: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#818cf8',
  },
  connectedLabel: {
    fontSize: '13px',
    color: 'rgba(148, 163, 184, 0.8)',
    fontWeight: 500,
  },
  grid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
    marginBottom: '32px',
  },
  card: {
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(71, 85, 105, 0.2)',
    borderRadius: '20px',
    padding: '28px',
    transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '20px',
    marginBottom: '4px',
  },
  iconWrap: {
    width: '56px',
    height: '56px',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '4px',
  },
  cardName: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#f1f5f9',
    margin: 0,
  },
  cardSubtitle: {
    fontSize: '11px',
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: '6px',
    letterSpacing: '0.5px',
    textTransform: 'uppercase' as const,
  },
  cardDesc: {
    fontSize: '13px',
    color: 'rgba(148, 163, 184, 0.7)',
    margin: 0,
    lineHeight: 1.5,
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#22c55e',
    background: 'rgba(34, 197, 94, 0.08)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '8px',
    padding: '6px 12px',
    whiteSpace: 'nowrap' as const,
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#22c55e',
    animation: 'pulse 2s infinite',
  },
  connectedInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    margin: '16px 0 4px',
    padding: '14px 18px',
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '14px',
    border: '1px solid rgba(71, 85, 105, 0.15)',
  },
  avatar: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    objectFit: 'cover' as const,
    border: '2px solid rgba(255,255,255,0.1)',
  },
  connectedMeta: {
    flex: 1,
  },
  connectedName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  connectedUsername: {
    fontSize: '12px',
    color: 'rgba(148, 163, 184, 0.6)',
  },
  reconnectBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(71, 85, 105, 0.3)',
    borderRadius: '10px',
    color: 'rgba(203, 213, 225, 0.8)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: "'Inter', sans-serif",
  },
  detailsToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 0',
    background: 'none',
    border: 'none',
    color: 'rgba(148, 163, 184, 0.6)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    transition: 'color 0.2s',
    marginTop: '8px',
  },
  permissionPanel: {
    padding: '16px 18px',
    background: 'rgba(30, 41, 59, 0.4)',
    borderRadius: '14px',
    border: '1px solid rgba(71, 85, 105, 0.12)',
    marginBottom: '8px',
  },
  permissionTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(148, 163, 184, 0.5)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    marginBottom: '10px',
  },
  permissionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
    fontSize: '12px',
    color: 'rgba(203, 213, 225, 0.8)',
  },
  permissionCode: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontWeight: 600,
    color: '#e2e8f0',
  },
  permissionDesc: {
    color: 'rgba(148, 163, 184, 0.5)',
  },
  permissionNote: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    padding: '10px 14px',
    background: 'rgba(245, 158, 11, 0.05)',
    border: '1px solid rgba(245, 158, 11, 0.1)',
    borderRadius: '10px',
    fontSize: '11px',
    color: '#fbbf24',
  },
  connectBtn: {
    width: '100%',
    padding: '14px',
    border: 'none',
    borderRadius: '14px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '16px',
    letterSpacing: '0.3px',
  },
  spinner: {
    width: '18px',
    height: '18px',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTop: '2px solid #fff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.6s linear infinite',
  },
  miniSpinner: {
    width: '14px',
    height: '14px',
    border: '2px solid rgba(255,255,255,0.2)',
    borderTop: '2px solid rgba(255,255,255,0.7)',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.6s linear infinite',
  },
  tableCard: {
    background: 'rgba(15, 23, 42, 0.5)',
    border: '1px solid rgba(71, 85, 105, 0.15)',
    borderRadius: '20px',
    overflow: 'hidden',
    marginBottom: '32px',
  },
  tableHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid rgba(71, 85, 105, 0.12)',
  },
  tableTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  tableBody: {
    padding: '8px',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderRadius: '12px',
    transition: 'background 0.2s',
  },
  tableRowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  tableIcon: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableRowName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  tableRowUsername: {
    fontSize: '11px',
    color: 'rgba(148, 163, 184, 0.5)',
  },
  tableRowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    padding: '4px 12px',
    borderRadius: '8px',
    border: '1px solid',
  },
  tablePlatformName: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(148, 163, 184, 0.4)',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    minWidth: '70px',
    textAlign: 'right' as const,
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '48px 24px',
  },
  emptyIcon: {
    marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'rgba(148, 163, 184, 0.6)',
    margin: '0 0 8px',
  },
  emptyDesc: {
    fontSize: '13px',
    color: 'rgba(100, 116, 139, 0.5)',
    margin: 0,
  },
};
