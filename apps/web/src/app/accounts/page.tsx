'use client';

import React, { useState, useEffect } from 'react';
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
}

// ============================================================
// Token Guide Data — Hướng dẫn lấy Token chi tiết
// ============================================================
const TOKEN_GUIDES = {
  facebook: {
    title: 'Facebook Page Access Token',
    color: '#1877F2',
    gradient: 'linear-gradient(135deg, #1877F2, #42A5F5)',
    bgGlow: 'rgba(24, 119, 242, 0.12)',
    fields: {
      appId: { label: 'ID Ứng Dụng (App ID)', placeholder: 'Ví dụ: 960313042869972' },
      token: { label: 'Page Access Token', placeholder: 'Dán token toàn quyền trang tại đây...' },
    },
    icon: (
      <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
    steps: [
      {
        step: 1,
        title: 'Tạo Facebook App',
        desc: 'Truy cập developers.facebook.com → "My Apps" → "Create App" → Chọn "Business" → Đặt tên app',
        link: 'https://developers.facebook.com/apps/create/',
      },
      {
        step: 2,
        title: 'Lấy App ID',
        desc: 'Sau khi tạo, vào Dashboard → Copy "App ID" (dãy số dài) ở góc trên',
        link: 'https://developers.facebook.com/apps/',
      },
      {
        step: 3,
        title: 'Mở Graph API Explorer',
        desc: 'Truy cập Graph API Explorer → Chọn App vừa tạo → Chọn "Get Page Access Token"',
        link: 'https://developers.facebook.com/tools/explorer/',
      },
      {
        step: 4,
        title: 'Cấp quyền cho Token',
        desc: 'Click "Add a Permission" → Chọn: pages_manage_posts, pages_read_engagement, pages_show_list → Click "Generate Access Token"',
        link: 'https://developers.facebook.com/tools/explorer/',
      },
      {
        step: 5,
        title: 'Chọn Page cần đăng bài',
        desc: 'Popup hiện ra → Đăng nhập Facebook → Chọn Page → "Đồng ý" cấp quyền → Copy token dài',
        link: null,
      },
      {
        step: 6,
        title: '⚡ Đổi thành Token vĩnh viễn (Khuyến nghị)',
        desc: 'Vào Access Token Debugger → Dán token → Click "Extend Access Token" → Copy token mới (60 ngày). Hoặc dùng Graph API: /oauth/access_token?grant_type=fb_exchange_token',
        link: 'https://developers.facebook.com/tools/debug/accesstoken/',
      },
    ],
  },
  youtube: {
    title: 'YouTube / Google API Token',
    color: '#FF0000',
    gradient: 'linear-gradient(135deg, #FF0000, #FF4444)',
    bgGlow: 'rgba(255, 0, 0, 0.10)',
    fields: {
      appId: { label: 'Google Client ID', placeholder: 'Ví dụ: 123456-xxx.apps.googleusercontent.com' },
      token: { label: 'OAuth Access Token', placeholder: 'Dán access token tại đây...' },
    },
    icon: (
      <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
    steps: [
      { step: 1, title: 'Tạo Google Cloud Project & Consent Screen', desc: 'Vào console.cloud.google.com → "New Project". Sau đó vào mục "OAuth Consent Screen" → Chọn User Type "External" → Khai báo thông tin App. Ở phần "Test Users" (Audience) → BẮT BUỘC bấm "Add Users" dán chính email Google của bạn vào (nếu không sẽ bị lỗi 403: access_denied).', link: 'https://console.cloud.google.com/apis/credentials/consent' },
      { step: 2, title: 'Kích hoạt YouTube Data API v3', desc: 'Vào "APIs & Services" → "Library" → Tìm kiếm từ khóa "YouTube Data API v3" → Click vào và bấm "Enable" để cho phép ứng dụng đọc/ghi dữ liệu kênh YouTube.', link: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
      { step: 3, title: 'Tạo Client ID & Đăng ký Redirect URI', desc: 'Vào Credentials → "Create Credentials" → "OAuth Client ID" → Chọn "Web application". Cuộn xuống mục "Authorized redirect URIs" → BẮT BUỘC bấm Add URI dán link: https://developers.google.com/oauthplayground → Bấm Save và sao chép Client ID + Client Secret.', link: 'https://console.cloud.google.com/apis/credentials' },
      { step: 4, title: 'Cấu hình Settings trên OAuth Playground', desc: 'Truy cập Google OAuth Playground → Nhấn biểu tượng Bánh Răng (Settings) ở góc trên bên phải → Tích chọn vào ô "Use your own OAuth credentials" → Dán Client ID và Client Secret vừa lấy ở Bước 3.', link: 'https://developers.google.com/oauthplayground/' },
      { step: 5, title: 'Chọn Scope & Cấp quyền (LƯU Ý QUAN TRỌNG)', desc: 'Ở cột bên trái Playground, cuộn xuống tìm "YouTube Data API v3" → Tích chọn các scopes: /auth/youtube.upload và /auth/youtube.readonly → Bấm "Authorize APIs". Trình duyệt sẽ chuyển hướng đăng nhập → ⚠️ BẮT BUỘC tích chọn các ô vuông cấp quyền quản lý/xem kênh YouTube trên màn hình chấp thuận trước khi bấm Tiếp tục!', link: 'https://developers.google.com/oauthplayground/' },
      { step: 6, title: 'Exchange Token và Copy Access Token', desc: 'Sau khi đồng ý, bạn được chuyển về Playground → Click nút màu xanh "Exchange authorization code for tokens" → Nhìn sang ô Access Token (dạng ya29.a0Ax...) → Copy chuỗi token đó dán vào ô nhập liệu OAuth Access Token ở phía trên.', link: null },
    ],
  },
  tiktok: {
    title: 'TikTok Developer Token',
    color: '#00F2EA',
    gradient: 'linear-gradient(135deg, #00F2EA, #FF0050)',
    bgGlow: 'rgba(0, 242, 234, 0.10)',
    fields: {
      appId: { label: 'TikTok Client Key', placeholder: 'Ví dụ: awXXXXXXXX' },
      token: { label: 'Access Token', placeholder: 'Dán access token tại đây...' },
    },
    icon: (
      <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
    steps: [
      { step: 1, title: 'Đăng ký TikTok Developer', desc: 'Vào developers.tiktok.com → Tạo tài khoản Developer', link: 'https://developers.tiktok.com/' },
      { step: 2, title: 'Tạo App', desc: 'My Apps → Create → Thêm Login Kit + Content Posting API', link: 'https://developers.tiktok.com/apps/' },
      { step: 3, title: 'Lấy Token', desc: 'Authorize → Copy Client Key và Access Token', link: null },
    ],
  },
};

type PlatformKey = keyof typeof TOKEN_GUIDES;

// ============================================================
// Main Component
// ============================================================
export default function AccountsPage() {
  const { workspaceId, showNotification } = useAppStore();
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformKey>('facebook');
  const [showGuide, setShowGuide] = useState(false);
  const [appId, setAppId] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetchAccounts();
    // Handle OAuth redirect params
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_success') === 'true') {
      showNotification('success', `🎉 Liên kết thành công!`);
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchAccounts();
    }
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const data = await api.get<AccountData[]>('/social-auth/accounts', { workspaceId });
      setAccounts(data || []);
    } catch { setAccounts([]); } finally { setLoading(false); }
  };

  const handleDirectConnect = async () => {
    if (!appId.trim()) { showNotification('error', 'Vui lòng nhập ID Ứng Dụng (App ID)'); return; }
    if (!token.trim()) { showNotification('error', 'Vui lòng nhập Access Token'); return; }

    setConnecting(true);
    try {
      const result = await api.post<{ success: boolean; message: string; accounts: any[] }>(
        '/social-auth/direct-connect',
        { platform: selectedPlatform, appId: appId.trim(), accessToken: token.trim() },
        { workspaceId },
      );

      if (result.success) {
        showNotification('success', `🎉 ${result.message}`);
        setAppId('');
        setToken('');
        fetchAccounts();
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi kết nối. Kiểm tra lại Token.');
    } finally {
      setConnecting(false);
    }
  };

  const handleOAuthConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.get<{ redirectUrl: string }>(
        `/social-auth/connect/${selectedPlatform}`,
        { workspaceId }
      );
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl;
      } else {
        showNotification('error', 'Không lấy được URL kết nối OAuth.');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi khi lấy URL đăng nhập OAuth.');
    } finally {
      setConnecting(false);
    }
  };

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  const toggleSelectAccount = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBulkDisconnect = async (idsToDelete?: string[]) => {
    const targets = idsToDelete || selectedIds;
    if (targets.length === 0) return;

    const confirmMsg = idsToDelete 
      ? `Bạn có chắc chắn muốn hủy kết nối tài khoản này?`
      : `Bạn có chắc chắn muốn hủy kết nối ${targets.length} tài khoản đã chọn?`;

    if (!window.confirm(confirmMsg)) return;

    setDisconnecting(true);
    try {
      const res = await api.post<{ success: boolean; count: number }>(
        '/social-auth/disconnect',
        { ids: targets },
      );
      if (res.success) {
        showNotification('success', `🔌 Đã hủy kết nối thành công ${res.count} tài khoản!`);
        setSelectedIds((prev) => prev.filter((id) => !targets.includes(id)));
        fetchAccounts();
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi khi hủy kết nối tài khoản!');
    } finally {
      setDisconnecting(false);
    }
  };

  const guide = TOKEN_GUIDES[selectedPlatform];
  const activeAccounts = accounts.filter(a => a.status === 'active');

  return (
    <>
      {/* ======== HEADER ======== */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Kết Nối Tài Khoản
          </h1>
          <p style={styles.subtitle}>
            Nhập App ID + Token → Hệ thống tự động thiết lập để đăng bài tự động
          </p>
        </div>
        <div style={styles.badge}>
          <span style={styles.badgeCount}>{activeAccounts.length}</span>
          <span style={styles.badgeLabel}>Đã kết nối</span>
        </div>
      </div>

      {/* ======== PLATFORM TABS ======== */}
      <div style={styles.tabs}>
        {(Object.keys(TOKEN_GUIDES) as PlatformKey[]).map((key) => {
          const g = TOKEN_GUIDES[key];
          const isActive = selectedPlatform === key;
          const hasAccount = accounts.some(a => a.platform === key && a.status === 'active');
          return (
            <button
              key={key}
              onClick={() => setSelectedPlatform(key)}
              style={{
                ...styles.tab,
                background: isActive ? `${g.color}18` : 'rgba(30, 41, 59, 0.4)',
                borderColor: isActive ? `${g.color}40` : 'rgba(71, 85, 105, 0.15)',
                color: isActive ? g.color : '#94a3b8',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {g.icon}
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </span>
              {hasAccount && <span style={{ ...styles.tabDot, background: '#22c55e' }} />}
            </button>
          );
        })}
      </div>

      {/* ======== CONNECTION FORM ======== */}
      <div style={{ ...styles.formCard, borderColor: `${guide.color}25` }}>
        <div style={styles.formHeader}>
          <div style={{ ...styles.formIcon, background: guide.bgGlow, color: guide.color }}>
            {guide.icon}
          </div>
          <div>
            <h2 style={styles.formTitle}>{guide.title}</h2>
            <p style={styles.formSubtitle}>Dán thông tin bên dưới → Click "Kết nối" → Xong!</p>
          </div>
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={guide.color} strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            {guide.fields.appId.label}
          </label>
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={guide.fields.appId.placeholder}
            style={styles.input}
          />
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={guide.color} strokeWidth="2"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>
            {guide.fields.token.label}
          </label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={guide.fields.token.placeholder}
            rows={3}
            style={{ ...styles.input, resize: 'vertical' as const, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '12px' }}
          />
        </div>

        <div style={styles.formActions}>
          <button onClick={() => setShowGuide(!showGuide)} style={styles.guideBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            {showGuide ? 'Ẩn hướng dẫn' : 'Hướng dẫn lấy Token'}
          </button>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleOAuthConnect}
              disabled={connecting}
              style={{
                ...styles.connectBtn,
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#a5b4fc',
              }}
            >
              {connecting ? (
                <><span style={styles.spinner} /> Đang kết nối...</>
              ) : (
                <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Đăng Nhập & Kết Nối Tự Động (OAuth)</>
              )}
            </button>

            <button
              onClick={handleDirectConnect}
              disabled={connecting || !appId.trim() || !token.trim()}
              style={{
                ...styles.connectBtn,
                background: connecting ? 'rgba(100,100,100,0.3)' : guide.gradient,
                opacity: (!appId.trim() || !token.trim()) ? 0.5 : 1,
              }}
            >
              {connecting ? (
                <><span style={styles.spinner} /> Đang xác minh...</>
              ) : (
                <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Dán Token & Kết Nối Thủ Công</>
              )}
            </button>
          </div>
        </div>

        {/* Security note */}
        <div style={styles.securityNote}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Token được mã hóa AES-256-GCM trước khi lưu. Không ai có thể đọc token gốc từ database.
        </div>
      </div>

      {/* ======== TOKEN GUIDE ======== */}
      {showGuide && (
        <div style={{ ...styles.guideCard, borderColor: `${guide.color}20` }}>
          <h3 style={styles.guideTitle}>
            📖 Hướng Dẫn Lấy {guide.title} — Từng Bước
          </h3>

          <div style={styles.stepsGrid}>
            {guide.steps.map((step) => (
              <div key={step.step} style={styles.stepCard}>
                <div style={{ ...styles.stepNum, background: `${guide.color}15`, color: guide.color }}>
                  {step.step}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={styles.stepTitle}>{step.title}</div>
                  <div style={styles.stepDesc}>{step.desc}</div>
                  {step.link && (
                    <a href={step.link} target="_blank" rel="noopener noreferrer" style={{ ...styles.stepLink, color: guide.color }}>
                      Mở link →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {selectedPlatform === 'facebook' && (
            <div style={styles.quickLinks}>
              <h4 style={styles.quickLinksTitle}>🔗 Link Nhanh</h4>
              <div style={styles.linksGrid}>
                {[
                  { label: 'Tạo Facebook App', url: 'https://developers.facebook.com/apps/create/' },
                  { label: 'Graph API Explorer (Lấy Token)', url: 'https://developers.facebook.com/tools/explorer/' },
                  { label: 'Access Token Debugger', url: 'https://developers.facebook.com/tools/debug/accesstoken/' },
                  { label: 'Tài liệu Graph API', url: 'https://developers.facebook.com/docs/graph-api/' },
                ].map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" style={styles.quickLink}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======== CONNECTED ACCOUNTS ======== */}
      {accounts.length > 0 && (
        <div style={styles.accountsCard}>
          {/* Header with bulk action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ ...styles.accountsTitle, margin: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Tài Khoản Đã Kết Nối ({activeAccounts.length})
            </h3>
            {selectedIds.length > 0 && (
              <button
                onClick={() => handleBulkDisconnect()}
                disabled={disconnecting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '10px',
                  color: '#f87171',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                Hủy kết nối đã chọn ({selectedIds.length})
              </button>
            )}
          </div>

          {accounts.map((acc) => {
            const g = TOKEN_GUIDES[acc.platform as PlatformKey];
            const isSelected = selectedIds.includes(acc.id);
            return (
              <div key={acc.id} style={{
                ...styles.accountRow,
                border: isSelected ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(71, 85, 105, 0.1)',
                background: isSelected ? 'rgba(239, 68, 68, 0.02)' : 'rgba(30, 41, 59, 0.3)',
                transition: 'all 0.2s',
              }}>
                {/* Checkbox */}
                <div 
                  onClick={() => toggleSelectAccount(acc.id)}
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '5px',
                    border: isSelected ? '2px solid #ef4444' : '2px solid rgba(148, 163, 184, 0.3)',
                    background: isSelected ? '#ef4444' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    marginRight: '6px',
                    flexShrink: 0,
                  }}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </div>

                <div style={{ position: 'relative', width: '42px', height: '42px', flexShrink: 0 }}>
                  {acc.avatarUrl ? (
                    <img
                      src={acc.avatarUrl}
                      alt={acc.displayName}
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        objectFit: 'cover',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    />
                  ) : (
                    <div style={{ ...styles.accountIcon, width: '100%', height: '100%', color: g?.color || '#6366f1', background: `${g?.color || '#6366f1'}12` }}>
                      {g?.icon || <span>?</span>}
                    </div>
                  )}
                  {acc.avatarUrl && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-2px',
                      right: '-2px',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      background: '#0f172a',
                      border: '1.5px solid #1e293b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: g?.color || '#6366f1',
                      padding: '2px',
                    }}>
                      {g?.icon}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={styles.accountName}>{acc.displayName}</div>
                  <div style={styles.accountUsername}>{acc.username}</div>
                </div>
                <span style={{
                  ...styles.statusPill,
                  background: acc.status === 'active' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                  color: acc.status === 'active' ? '#22c55e' : '#ef4444',
                  borderColor: acc.status === 'active' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: acc.status === 'active' ? '#22c55e' : '#ef4444' }} />
                  {acc.status === 'active' ? '✅ Sẵn sàng đăng bài' : 'Hết hạn'}
                </span>

                {/* Individual disconnect button */}
                <button
                  onClick={() => handleBulkDisconnect([acc.id])}
                  disabled={disconnecting}
                  title="Hủy kết nối tài khoản này"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(148, 163, 184, 0.4)',
                    cursor: 'pointer',
                    padding: '8px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                    marginLeft: '8px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef4444';
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(148, 163, 184, 0.4)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && accounts.length === 0 && (
        <div style={styles.empty}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <h3 style={styles.emptyTitle}>Chưa có tài khoản nào</h3>
          <p style={styles.emptyDesc}>
            Nhập App ID + Token ở form phía trên để bắt đầu đăng bài tự động.<br/>
            Bấm "Hướng dẫn lấy Token" nếu chưa biết cách.
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  );
}

// ============================================================
// Styles
// ============================================================
const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' as const },
  title: { fontSize: '24px', fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.3px' },
  subtitle: { fontSize: '14px', color: 'rgba(148, 163, 184, 0.6)', margin: 0 },
  badge: { display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', borderRadius: '12px', padding: '10px 18px' },
  badgeCount: { fontSize: '24px', fontWeight: 800, color: '#818cf8' },
  badgeLabel: { fontSize: '12px', color: 'rgba(148, 163, 184, 0.5)', fontWeight: 500 },

  tabs: { display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  tab: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', borderRadius: '14px', border: '1px solid', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.2s', position: 'relative' as const },
  tabDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },

  formCard: { background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(12px)', border: '1px solid', borderRadius: '20px', padding: '28px', marginBottom: '24px', animation: 'fadeIn 0.3s ease' },
  formHeader: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' },
  formIcon: { width: '56px', height: '56px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  formTitle: { fontSize: '18px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' },
  formSubtitle: { fontSize: '13px', color: 'rgba(148, 163, 184, 0.5)', margin: 0 },

  inputGroup: { marginBottom: '16px' },
  label: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' },
  input: { width: '100%', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(71, 85, 105, 0.25)', borderRadius: '12px', padding: '12px 16px', color: '#f1f5f9', fontSize: '14px', outline: 'none', fontFamily: "'Inter', sans-serif", transition: 'border-color 0.2s', boxSizing: 'border-box' as const },

  formActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '20px', flexWrap: 'wrap' as const },
  guideBtn: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', borderRadius: '10px', color: '#818cf8', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif" },
  connectBtn: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 24px', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif", transition: 'all 0.2s' },
  spinner: { width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' },

  securityNote: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', padding: '10px 14px', background: 'rgba(34, 197, 94, 0.04)', border: '1px solid rgba(34, 197, 94, 0.1)', borderRadius: '10px', fontSize: '12px', color: 'rgba(34, 197, 94, 0.7)' },

  guideCard: { background: 'rgba(15, 23, 42, 0.5)', border: '1px solid', borderRadius: '20px', padding: '28px', marginBottom: '24px', animation: 'fadeIn 0.3s ease' },
  guideTitle: { fontSize: '16px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 20px' },
  stepsGrid: { display: 'flex', flexDirection: 'column' as const, gap: '14px' },
  stepCard: { display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '14px 16px', background: 'rgba(30, 41, 59, 0.3)', borderRadius: '14px', border: '1px solid rgba(71, 85, 105, 0.1)' },
  stepNum: { width: '32px', height: '32px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0 },
  stepTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' },
  stepDesc: { fontSize: '12px', color: 'rgba(148, 163, 184, 0.6)', lineHeight: 1.5 },
  stepLink: { fontSize: '12px', fontWeight: 600, textDecoration: 'none', marginTop: '4px', display: 'inline-block' },

  quickLinks: { marginTop: '20px', padding: '16px', background: 'rgba(30, 41, 59, 0.3)', borderRadius: '14px' },
  quickLinksTitle: { fontSize: '13px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 12px' },
  linksGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  quickLink: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(24, 119, 242, 0.04)', border: '1px solid rgba(24, 119, 242, 0.1)', borderRadius: '8px', color: '#60a5fa', fontSize: '12px', fontWeight: 500, textDecoration: 'none', transition: 'background 0.2s' },

  accountsCard: { background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(71, 85, 105, 0.15)', borderRadius: '20px', padding: '24px', marginBottom: '24px' },
  accountsTitle: { fontSize: '15px', fontWeight: 700, color: '#f1f5f9', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '10px' },
  accountRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', background: 'rgba(30, 41, 59, 0.3)', borderRadius: '14px', marginBottom: '8px', border: '1px solid rgba(71, 85, 105, 0.1)' },
  accountIcon: { width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  accountName: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
  accountUsername: { fontSize: '12px', color: 'rgba(148, 163, 184, 0.5)' },
  statusPill: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '8px', border: '1px solid', fontSize: '12px', fontWeight: 600, flexShrink: 0 },

  empty: { textAlign: 'center' as const, padding: '48px 24px' },
  emptyTitle: { fontSize: '18px', fontWeight: 700, color: 'rgba(148, 163, 184, 0.6)', margin: '16px 0 8px' },
  emptyDesc: { fontSize: '13px', color: 'rgba(100, 116, 139, 0.5)', lineHeight: 1.6 },
};
