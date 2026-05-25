'use client';

import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../../stores/useAppStore';
import api from '../../../lib/api';

// ============================================================
// Platform Setup Config
// ============================================================
const PLATFORM_SETUP = [
  {
    key: 'facebook',
    name: 'Facebook',
    color: '#1877F2',
    gradient: 'linear-gradient(135deg, #1877F2, #42A5F5)',
    bgGlow: 'rgba(24, 119, 242, 0.12)',
    fields: {
      clientId: { label: 'Facebook App ID', placeholder: 'Ví dụ: 1234567890123456' },
      clientSecret: { label: 'Facebook App Secret', placeholder: 'Ví dụ: abc123def456...' },
      redirectUri: { label: 'Redirect URI (Tùy chọn)', placeholder: 'Mặc định: http://localhost:3001/social-auth/callback/facebook' },
    },
    setupGuide: [
      { step: 1, title: 'Tạo Facebook App', desc: 'Vào developers.facebook.com → My Apps → Create App → Business type' },
      { step: 2, title: 'Thêm Facebook Login', desc: 'Dashboard → Add Product → Facebook Login → Web' },
      { step: 3, title: 'Cấu hình OAuth', desc: 'Settings → Basic → Copy App ID & App Secret' },
      { step: 4, title: 'Thêm Redirect URI', desc: 'Facebook Login → Settings → Valid OAuth Redirect URIs → Thêm callback URL' },
      { step: 5, title: 'Yêu cầu quyền', desc: 'App Review → Request pages_manage_posts, pages_read_engagement' },
    ],
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
  {
    key: 'youtube',
    name: 'YouTube / Google',
    color: '#FF0000',
    gradient: 'linear-gradient(135deg, #FF0000, #FF4444)',
    bgGlow: 'rgba(255, 0, 0, 0.10)',
    fields: {
      clientId: { label: 'Google Client ID', placeholder: 'Ví dụ: 123456-abcdef.apps.googleusercontent.com' },
      clientSecret: { label: 'Google Client Secret', placeholder: 'Ví dụ: GOCSPX-...' },
      redirectUri: { label: 'Redirect URI (Tùy chọn)', placeholder: 'Mặc định: http://localhost:3001/social-auth/callback/youtube' },
    },
    setupGuide: [
      { step: 1, title: 'Tạo Google Cloud Project', desc: 'Vào console.cloud.google.com → New Project' },
      { step: 2, title: 'Bật YouTube Data API v3', desc: 'APIs & Services → Library → YouTube Data API v3 → Enable' },
      { step: 3, title: 'Tạo OAuth Client', desc: 'Credentials → Create Credentials → OAuth client ID → Web Application' },
      { step: 4, title: 'Cấu hình Redirect', desc: 'Authorized redirect URIs → Thêm callback URL' },
      { step: 5, title: 'Copy Credentials', desc: 'Copy Client ID và Client Secret' },
    ],
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    key: 'tiktok',
    name: 'TikTok',
    color: '#00F2EA',
    gradient: 'linear-gradient(135deg, #00F2EA, #FF0050)',
    bgGlow: 'rgba(0, 242, 234, 0.10)',
    fields: {
      clientId: { label: 'TikTok Client Key', placeholder: 'Ví dụ: awXXXXXXXXXXXX' },
      clientSecret: { label: 'TikTok Client Secret', placeholder: 'Ví dụ: XXXXXXXXXX...' },
      redirectUri: { label: 'Redirect URI (Tùy chọn)', placeholder: 'Ví dụ: https://izziapi.com/social-auth/callback/tiktok hoặc localtunnel URL' },
    },
    setupGuide: [
      { step: 1, title: 'Đăng ký TikTok Developer', desc: 'Vào developers.tiktok.com → Đăng ký tài khoản Developer' },
      { step: 2, title: 'Tạo App', desc: 'My Apps → Create → Điền thông tin App' },
      { step: 3, title: 'Thêm Login Kit', desc: 'Products → Add → Login Kit + Content Posting API' },
      { step: 4, title: 'Cấu hình Redirect', desc: 'Platform Settings → Web → Redirect URI → Thêm callback URL' },
      { step: 5, title: 'Copy Credentials', desc: 'Copy Client Key và Client Secret' },
    ],
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
  },
];

interface CredentialStatus {
  platform: string;
  clientId: string;
  clientSecretMask: string;
  redirectUri: string;
  isActive: boolean;
}

interface FormData {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export default function ProvidersSettingsPage() {
  const { workspaceId, showNotification } = useAppStore();
  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [savingPlatform, setSavingPlatform] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, FormData>>({});

  useEffect(() => { fetchCredentials(); }, []);

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const data = await api.get<CredentialStatus[]>('/credentials', { workspaceId });
      setCredentials(data || []);
    } catch {
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (platformKey: string) => {
    if (editingPlatform === platformKey) {
      setEditingPlatform(null);
    } else {
      setEditingPlatform(platformKey);
      const status = getCredentialStatus(platformKey);
      setFormData(prev => ({
        ...prev,
        [platformKey]: {
          clientId: '',
          clientSecret: '',
          redirectUri: status?.redirectUri || '',
        }
      }));
    }
  };

  const handleSave = async (platformKey: string) => {
    const data = formData[platformKey];
    if (!data?.clientId || !data?.clientSecret) {
      showNotification('error', 'Vui lòng nhập đầy đủ App ID/Client Key và Secret.');
      return;
    }

    setSavingPlatform(platformKey);
    try {
      await api.post('/credentials', {
        platform: platformKey,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        redirectUri: data.redirectUri || undefined,
      }, { workspaceId });

      showNotification('success', `✅ Đã lưu credentials cho ${platformKey.toUpperCase()}! Giờ có thể kết nối thật.`);
      setEditingPlatform(null);
      setFormData(prev => ({ ...prev, [platformKey]: { clientId: '', clientSecret: '', redirectUri: '' } }));
      fetchCredentials();
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi lưu credentials.');
    } finally {
      setSavingPlatform(null);
    }
  };

  const handleDelete = async (platformKey: string) => {
    try {
      await api.delete(`/credentials/${platformKey}`, { workspaceId });
      showNotification('success', `Đã xóa credentials cho ${platformKey.toUpperCase()}.`);
      fetchCredentials();
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi xóa credentials.');
    }
  };

  const getCredentialStatus = (platformKey: string) => {
    return credentials.find(c => c.platform === platformKey);
  };

  return (
    <>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Cấu Hình API Providers
          </h1>
          <p style={styles.subtitle}>
            Nhập API credentials thật từ Facebook, Google, TikTok Developer để kết nối OAuth thực sự
          </p>
        </div>
      </div>

      {/* Important notice */}
      <div style={styles.notice}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div>
          <strong>Quan trọng:</strong> Khi cấu hình credentials thật, nút "Kết nối" trong trang Tài Khoản sẽ redirect tới trang đăng nhập thật của Facebook/Google/TikTok thay vì trang Mock giả lập. Credentials được mã hóa AES-256-GCM trước khi lưu.
        </div>
      </div>

      {/* Platform Cards */}
      <div style={styles.grid}>
        {PLATFORM_SETUP.map((platform) => {
          const status = getCredentialStatus(platform.key);
          const isExpanded = expandedPlatform === platform.key;
          const isEditing = editingPlatform === platform.key;
          const isSaving = savingPlatform === platform.key;
          const form = formData[platform.key] || { clientId: '', clientSecret: '' };

          return (
            <div key={platform.key} style={{
              ...styles.card,
              borderColor: status?.isActive ? `${platform.color}30` : 'rgba(71, 85, 105, 0.15)',
            }}>
              {/* Card Header */}
              <div style={styles.cardHeader}>
                <div style={{
                  ...styles.iconWrap,
                  background: platform.bgGlow,
                  color: platform.color,
                }}>
                  {platform.icon}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={styles.cardNameRow}>
                    <h3 style={styles.cardName}>{platform.name}</h3>
                    {status?.isActive ? (
                      <span style={styles.activeBadge}>
                        <span style={styles.activeDot} /> Đã cấu hình
                      </span>
                    ) : (
                      <span style={styles.inactiveBadge}>
                        Chưa cấu hình
                      </span>
                    )}
                  </div>

                  {status?.isActive && (
                    <div style={styles.credInfo}>
                      <span style={styles.credLabel}>App ID:</span>
                      <code style={styles.credValue}>{status.clientId}</code>
                      <span style={styles.credLabel}>Secret:</span>
                      <code style={styles.credValue}>{status.clientSecretMask}</code>
                      {status.redirectUri && (
                        <>
                          <span style={styles.credLabel}>Redirect URI:</span>
                          <code style={styles.credValue}>{status.redirectUri}</code>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={styles.cardActions}>
                  {status?.isActive && (
                    <button onClick={() => handleDelete(platform.key)} style={styles.deleteBtn}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  )}
                  <button
                    onClick={() => handleStartEdit(platform.key)}
                    style={{
                      ...styles.editBtn,
                      background: isEditing ? 'rgba(239, 68, 68, 0.1)' : `${platform.color}15`,
                      color: isEditing ? '#ef4444' : platform.color,
                      borderColor: isEditing ? 'rgba(239, 68, 68, 0.2)' : `${platform.color}25`,
                    }}
                  >
                    {isEditing ? 'Đóng' : (status?.isActive ? 'Sửa' : 'Cấu hình')}
                  </button>
                </div>
              </div>

              {/* Edit Form */}
              {isEditing && (
                <div style={styles.formPanel}>
                  <div style={styles.formGrid}>
                    <div>
                      <label style={styles.formLabel}>{platform.fields.clientId.label}</label>
                      <input
                        type="text"
                        placeholder={platform.fields.clientId.placeholder}
                        value={form.clientId}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          [platform.key]: { ...form, clientId: e.target.value },
                        }))}
                        style={styles.formInput}
                      />
                    </div>
                    <div>
                      <label style={styles.formLabel}>{platform.fields.clientSecret.label}</label>
                      <input
                        type="password"
                        placeholder={platform.fields.clientSecret.placeholder}
                        value={form.clientSecret}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          [platform.key]: { ...form, clientSecret: e.target.value },
                        }))}
                        style={styles.formInput}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={styles.formLabel}>{platform.fields.redirectUri.label}</label>
                    <input
                      type="text"
                      placeholder={platform.fields.redirectUri.placeholder}
                      value={form.redirectUri || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        [platform.key]: { ...form, redirectUri: e.target.value },
                      }))}
                      style={styles.formInput}
                    />
                  </div>

                  <div style={styles.formFooter}>
                    <div style={styles.callbackInfo}>
                      <span style={styles.callbackLabel}>Callback URL:</span>
                      <code style={styles.callbackValue}>
                        {form.redirectUri || `http://localhost:3001/social-auth/callback/${platform.key}`}
                      </code>
                    </div>

                    <button
                      onClick={() => handleSave(platform.key)}
                      disabled={isSaving}
                      style={{
                        ...styles.saveBtn,
                        background: isSaving ? 'rgba(100,100,100,0.3)' : platform.gradient,
                      }}
                    >
                      {isSaving ? (
                        <><span style={styles.spinner} /> Đang lưu...</>
                      ) : (
                        <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Lưu & Mã hóa</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Setup Guide Toggle */}
              <button
                onClick={() => setExpandedPlatform(isExpanded ? null : platform.key)}
                style={styles.guideToggle}
              >
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Hướng dẫn tạo {platform.name} App (từng bước)
              </button>

              {isExpanded && (
                <div style={styles.guidePanel}>
                  {platform.setupGuide.map((step) => (
                    <div key={step.step} style={styles.guideStep}>
                      <div style={{
                        ...styles.stepNumber,
                        background: `${platform.color}15`,
                        color: platform.color,
                      }}>
                        {step.step}
                      </div>
                      <div>
                        <div style={styles.stepTitle}>{step.title}</div>
                        <div style={styles.stepDesc}>{step.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
  header: { marginBottom: '24px' },
  title: {
    fontSize: '22px', fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px',
    display: 'flex', alignItems: 'center', gap: '12px', letterSpacing: '-0.3px',
  },
  subtitle: { fontSize: '13px', color: 'rgba(148, 163, 184, 0.6)', margin: 0 },
  notice: {
    display: 'flex', gap: '14px', alignItems: 'flex-start',
    padding: '16px 20px', marginBottom: '24px',
    background: 'rgba(245, 158, 11, 0.05)',
    border: '1px solid rgba(245, 158, 11, 0.12)',
    borderRadius: '14px', fontSize: '13px', color: '#fbbf24', lineHeight: 1.5,
  },
  grid: { display: 'flex', flexDirection: 'column' as const, gap: '20px' },
  card: {
    background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(12px)',
    border: '1px solid rgba(71, 85, 105, 0.15)', borderRadius: '20px',
    padding: '24px', transition: 'border-color 0.3s',
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', gap: '16px' },
  iconWrap: {
    width: '48px', height: '48px', borderRadius: '14px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardNameRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
  cardName: { fontSize: '16px', fontWeight: 700, color: '#f1f5f9', margin: 0 },
  activeBadge: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '11px', fontWeight: 600, color: '#22c55e',
    background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '6px', padding: '3px 10px',
  },
  activeDot: {
    width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e',
    animation: 'pulse 2s infinite',
  },
  inactiveBadge: {
    fontSize: '11px', fontWeight: 600, color: '#94a3b8',
    background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.15)',
    borderRadius: '6px', padding: '3px 10px',
  },
  credInfo: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const,
    fontSize: '12px', marginTop: '4px',
  },
  credLabel: { color: 'rgba(148, 163, 184, 0.5)', fontWeight: 500 },
  credValue: {
    fontFamily: "'JetBrains Mono', monospace", color: '#e2e8f0',
    background: 'rgba(30, 41, 59, 0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
  },
  cardActions: { display: 'flex', gap: '8px', flexShrink: 0 },
  deleteBtn: {
    width: '36px', height: '36px', borderRadius: '10px',
    background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)',
    color: '#ef4444', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Inter', sans-serif",
  },
  editBtn: {
    padding: '8px 16px', borderRadius: '10px',
    border: '1px solid', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: "'Inter', sans-serif",
    transition: 'all 0.2s',
  },
  formPanel: {
    marginTop: '20px', padding: '20px',
    background: 'rgba(30, 41, 59, 0.4)', borderRadius: '16px',
    border: '1px solid rgba(71, 85, 105, 0.12)',
  },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' },
  formLabel: {
    display: 'block', fontSize: '12px', fontWeight: 600,
    color: 'rgba(148, 163, 184, 0.7)', marginBottom: '6px',
  },
  formInput: {
    width: '100%', background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid rgba(71, 85, 105, 0.2)', borderRadius: '10px',
    padding: '10px 14px', color: '#f1f5f9', fontSize: '13px',
    outline: 'none', fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.2s',
  },
  formFooter: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap' as const, gap: '12px',
  },
  callbackInfo: {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '11px', flexWrap: 'wrap' as const,
  },
  callbackLabel: { color: 'rgba(148, 163, 184, 0.5)', fontWeight: 500 },
  callbackValue: {
    fontFamily: "'JetBrains Mono', monospace", color: '#818cf8',
    background: 'rgba(99, 102, 241, 0.08)', padding: '4px 10px',
    borderRadius: '6px', fontSize: '11px',
  },
  saveBtn: {
    padding: '10px 20px', border: 'none', borderRadius: '10px',
    color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
    display: 'flex', alignItems: 'center', gap: '8px',
    transition: 'all 0.2s',
  },
  spinner: {
    width: '14px', height: '14px',
    border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff',
    borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite',
  },
  guideToggle: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 0', marginTop: '12px',
    background: 'none', border: 'none',
    color: 'rgba(148, 163, 184, 0.5)', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: "'Inter', sans-serif",
  },
  guidePanel: {
    padding: '16px', background: 'rgba(30, 41, 59, 0.3)',
    borderRadius: '14px', border: '1px solid rgba(71, 85, 105, 0.1)',
    display: 'flex', flexDirection: 'column' as const, gap: '12px',
    marginTop: '8px',
  },
  guideStep: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  stepNumber: {
    width: '28px', height: '28px', borderRadius: '8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: 700, flexShrink: 0,
  },
  stepTitle: { fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '2px' },
  stepDesc: { fontSize: '12px', color: 'rgba(148, 163, 184, 0.5)', lineHeight: 1.4 },
};
