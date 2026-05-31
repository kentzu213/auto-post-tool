'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Facebook, Youtube, Video, Check, CheckCheck, MessageCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

const PLATFORM_ICON: Record<string, React.ElementType> = {
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Video,
};

interface InboxMessage {
  id: string;
  platform: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  messageText: string;
  isRead: boolean;
  createdAt: string;
}

interface MessagesResponse {
  data: InboxMessage[];
  meta: { total: number; unreadCount: number; page: number; limit: number; totalPages: number };
}

interface UnreadCounts {
  total: number;
  byPlatform: Array<{ platform: string; count: number }>;
}

// Hiển thị thời gian tương đối kiểu "x phút trước" (input là ISO string từ API).
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

// Fallback avatar theo tên người gửi khi nền tảng không trả ảnh (vd Facebook PSID).
function avatarFor(msg: InboxMessage): string {
  if (msg.senderAvatar) return msg.senderAvatar;
  const name = encodeURIComponent(msg.senderName || '?');
  return `https://ui-avatars.com/api/?name=${name}&background=6366f1&color=fff&size=80`;
}

export default function InboxPage() {
  const { workspaceId } = useAppStore();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [unread, setUnread] = useState<UnreadCounts>({ total: 0, byPlatform: [] });
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRealAccount, setHasRealAccount] = useState<boolean | null>(null);

  const fetchData = useCallback(
    async (isSilent = false) => {
      if (!workspaceId) return;
      try {
        if (!isSilent) setLoading(true);
        setError(null);

        const [messagesRes, unreadRes, accountsRes] = await Promise.all([
          api.get<MessagesResponse>('/inbox/messages', { workspaceId, limit: 50 }),
          api.get<UnreadCounts>('/inbox/unread-counts', { workspaceId }),
          api
            .get<Array<{ username: string }>>('/social-auth/accounts', { workspaceId })
            .catch(() => [] as Array<{ username: string }>),
        ]);

        setMessages(messagesRes.data);
        setUnread(unreadRes);
        // Tài khoản mock được tạo qua OAuth giả có username dạng "@autopost.*"/"@mock_*".
        // Nếu KHÔNG có account thật nào → hiển thị gợi ý trung thực.
        setHasRealAccount(
          accountsRes.some((a) => {
            const u = a.username || '';
            return !u.includes('autopost') && !u.startsWith('@mock_');
          }),
        );
      } catch (err: any) {
        setError(err.message || 'Lỗi kết nối tới server để tải hộp thư.');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!workspaceId) return;
    fetchData();
    // Auto-refresh ~30s, im lặng (không nháy toàn màn hình).
    const intervalId = setInterval(() => fetchData(true), 30000);
    return () => clearInterval(intervalId);
  }, [workspaceId, fetchData]);

  const filtered =
    filterPlatform === 'all' ? messages : messages.filter((m) => m.platform === filterPlatform);

  const markAsRead = async (id: string) => {
    const target = messages.find((m) => m.id === id);
    if (!target || target.isRead) return;
    // Optimistic update.
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isRead: true } : m)));
    setUnread((prev) => ({
      total: Math.max(0, prev.total - 1),
      byPlatform: prev.byPlatform.map((p) =>
        p.platform === target.platform ? { ...p, count: Math.max(0, p.count - 1) } : p,
      ),
    }));
    try {
      await api.patch(`/inbox/${id}/read`);
    } catch {
      fetchData(true); // Khôi phục trạng thái thật nếu lỗi.
    }
  };

  const markAllRead = async () => {
    setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
    setUnread({ total: 0, byPlatform: [] });
    try {
      await api.patch(`/inbox/mark-all-read?workspaceId=${encodeURIComponent(workspaceId)}`);
    } catch {
      fetchData(true);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      await api.post('/inbox/sync', undefined, { workspaceId });
      await fetchData(true);
    } catch (err: any) {
      setError(err.message || 'Đồng bộ thất bại.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Hộp Thư Đa Kênh (Unified Inbox)</h2>
          <p>Trả lời bình luận, tin nhắn từ Facebook, YouTube, TikTok tập trung.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleSync} disabled={syncing} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}
        </button>
      </div>

      {/* Honest hint khi chỉ có tài khoản mock/demo */}
      {hasRealAccount === false && (
        <div className="card" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', padding: 'var(--space-md) var(--space-lg)', marginBottom: 'var(--space-md)', borderLeft: '3px solid var(--color-warning, #f59e0b)' }}>
          <AlertCircle size={18} style={{ color: 'var(--color-warning, #f59e0b)', flexShrink: 0, marginTop: '2px' }} />
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Bạn đang dùng tài khoản demo/mock — hộp thư thật cần kết nối tài khoản MXH thật với đủ
            quyền (Facebook: <code>pages_messaging</code> + <code>pages_read_engagement</code>; YouTube:
            <code> youtube.force-ssl</code>). TikTok đọc bình luận hiện chưa khả dụng.
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-lg)',
        flexWrap: 'wrap',
        gap: 'var(--space-sm)',
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          {[
            { key: 'all', label: `Tất cả (${messages.length})` },
            { key: 'facebook', label: 'Facebook' },
            { key: 'youtube', label: 'YouTube' },
            { key: 'tiktok', label: 'TikTok' },
          ].map((f) => (
            <button
              key={f.key}
              className={`btn btn-sm ${filterPlatform === f.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilterPlatform(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
          {unread.total > 0 && (
            <span className="badge badge-warning">{unread.total} chưa đọc</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
            <CheckCheck size={16} />
            Đọc tất cả
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-lg)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
          <AlertCircle size={32} style={{ margin: '0 auto var(--space-sm)', color: 'var(--color-youtube)' }} />
          <p>{error}</p>
        </div>
      )}

      {/* Messages list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
            <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto var(--space-md)', opacity: 0.5 }} />
            <p>Đang tải hộp thư...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
            <MessageCircle size={48} style={{ margin: '0 auto var(--space-md)', opacity: 0.3 }} />
            <p>Chưa có tin nhắn nào — kết nối tài khoản hoặc chờ đồng bộ.</p>
          </div>
        ) : (
          filtered.map((msg) => {
            const Icon = PLATFORM_ICON[msg.platform] || MessageCircle;
            return (
              <div
                key={msg.id}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-md)',
                  padding: 'var(--space-md) var(--space-lg)',
                  cursor: 'pointer',
                  borderLeft: msg.isRead ? '3px solid transparent' : '3px solid var(--color-brand-primary)',
                  opacity: msg.isRead ? 0.7 : 1,
                }}
                onClick={() => markAsRead(msg.id)}
              >
                {/* Avatar */}
                <img src={avatarFor(msg)} alt={msg.senderName} className="avatar" />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{msg.senderName}</span>
                      <span className={`badge badge-${msg.platform}`} style={{ fontSize: '9px' }}>
                        <Icon size={10} />
                        {msg.platform}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                      flexShrink: 0,
                    }}>
                      {timeAgo(msg.createdAt)}
                    </span>
                  </div>
                  <p style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 'var(--font-size-md)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {msg.messageText}
                  </p>
                </div>

                {/* Read indicator */}
                {msg.isRead && (
                  <Check size={16} style={{ color: 'var(--color-success)', flexShrink: 0, marginTop: '4px' }} />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
