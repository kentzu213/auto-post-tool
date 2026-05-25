'use client';

import React, { useState, useEffect } from 'react';
import { Facebook, Youtube, Video, Link2, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

const PLATFORM_CONFIG: Record<string, {
  icon: React.ElementType;
  label: string;
  color: string;
  description: string;
}> = {
  facebook: {
    icon: Facebook,
    label: 'Facebook Page',
    color: 'var(--color-facebook)',
    description: 'Kết nối Facebook Page để đăng bài, Reels, Story và quản lý bình luận.',
  },
  youtube: {
    icon: Youtube,
    label: 'YouTube Channel',
    color: 'var(--color-youtube)',
    description: 'Kết nối YouTube Channel để upload video, Shorts và quản lý comments.',
  },
  tiktok: {
    icon: Video,
    label: 'TikTok Account',
    color: '#25F4EE',
    description: 'Kết nối TikTok để đăng video trực tiếp hoặc qua chế độ Inbox Draft.',
  },
};

interface AccountData {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  status: string;
}

export default function AccountsPage() {
  const { workspaceId, showNotification } = useAppStore();
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAccounts();

    // Handle OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_success') === 'true') {
      const p = params.get('platform') || '';
      showNotification('success', `Liên kết ${p.toUpperCase()} thành công!`);
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
      // API not available — show empty state
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const connectAccount = async (platform: string) => {
    try {
      const data = await api.get<{ redirectUrl: string }>(`/social-auth/connect/${platform}`, { workspaceId });
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        showNotification('error', 'Không nhận được URL OAuth.');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi kết nối máy chủ.');
    }
  };

  const getAccountForPlatform = (platform: string) => {
    return accounts.find((a) => a.platform === platform && a.status === 'active');
  };

  return (
    <>
      <div className="page-header">
        <h2>Liên Kết Tài Khoản Mạng Xã Hội</h2>
        <p>Liên kết OAuth 2.0 an toàn thông qua Meta, Google, TikTok.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {Object.entries(PLATFORM_CONFIG).map(([platform, config]) => {
          const Icon = config.icon;
          const connected = getAccountForPlatform(platform);

          return (
            <div className="card" key={platform} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-xl)',
              padding: 'var(--space-xl)',
            }}>
              {/* Platform icon */}
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: 'var(--radius-lg)',
                background: `${config.color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={28} style={{ color: config.color }} />
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                  <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>{config.label}</h3>
                  {connected ? (
                    <span className="badge badge-success">
                      <CheckCircle size={12} />
                      Đã kết nối
                    </span>
                  ) : (
                    <span className="badge badge-warning">
                      <XCircle size={12} />
                      Chưa kết nối
                    </span>
                  )}
                </div>

                {connected ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                    <img
                      src={connected.avatarUrl || ''}
                      alt={connected.displayName}
                      className="avatar avatar-sm"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{connected.displayName}</div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>@{connected.username}</div>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                    {config.description}
                  </p>
                )}
              </div>

              {/* Action */}
              <button
                className={connected ? 'btn btn-secondary' : 'btn btn-primary'}
                onClick={() => connectAccount(platform)}
              >
                {connected ? (
                  <>
                    <ExternalLink size={16} />
                    Kết nối lại
                  </>
                ) : (
                  <>
                    <Link2 size={16} />
                    Kết nối
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Connected accounts list */}
      {accounts.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="card-header">
            <span className="card-title">Tài Khoản Đã Kết Nối ({accounts.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {accounts.map((acc) => {
              const Icon = PLATFORM_CONFIG[acc.platform]?.icon || Link2;
              return (
                <div key={acc.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  background: 'var(--color-surface-1)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Icon size={18} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{acc.displayName}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>@{acc.username}</div>
                    </div>
                  </div>
                  <span className={`badge ${acc.status === 'active' ? 'badge-success' : 'badge-error'}`}>
                    {acc.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
