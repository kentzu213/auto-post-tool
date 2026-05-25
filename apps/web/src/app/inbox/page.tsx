'use client';

import React, { useState } from 'react';
import { Facebook, Youtube, Video, Check, CheckCheck, MessageCircle } from 'lucide-react';

const PLATFORM_ICON: Record<string, React.ElementType> = {
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Video,
};

const MOCK_MESSAGES = [
  {
    id: '1', platform: 'facebook',
    sender: 'Hoàng Long',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&auto=format&fit=crop&q=60',
    text: 'Sản phẩm này có giá bao nhiêu vậy shop?',
    time: '2 phút trước',
    isRead: false,
  },
  {
    id: '2', platform: 'tiktok',
    sender: 'Linh Chi',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&auto=format&fit=crop&q=60',
    text: 'Video của anh cuốn quá, làm thêm phần 2 đi ạ!',
    time: '10 phút trước',
    isRead: false,
  },
  {
    id: '3', platform: 'youtube',
    sender: 'Minh Quân',
    avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=80&auto=format&fit=crop&q=60',
    text: 'Cho em xin link github của tool này nha anh.',
    time: '1 giờ trước',
    isRead: true,
  },
  {
    id: '4', platform: 'facebook',
    sender: 'Thu Hà',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&auto=format&fit=crop&q=60',
    text: 'Ship về Hà Nội có nhanh không ạ?',
    time: '2 giờ trước',
    isRead: true,
  },
];

export default function InboxPage() {
  const [messages, setMessages] = useState(MOCK_MESSAGES);
  const [filterPlatform, setFilterPlatform] = useState<string>('all');

  const filtered = filterPlatform === 'all'
    ? messages
    : messages.filter((m) => m.platform === filterPlatform);

  const unreadCount = messages.filter((m) => !m.isRead).length;

  const markAsRead = (id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, isRead: true } : m));
  };

  const markAllRead = () => {
    setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
  };

  return (
    <>
      <div className="page-header">
        <h2>Hộp Thư Đa Kênh (Unified Inbox)</h2>
        <p>Trả lời bình luận, tin nhắn từ Facebook, YouTube, TikTok tập trung.</p>
      </div>

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
          {unreadCount > 0 && (
            <span className="badge badge-warning">{unreadCount} chưa đọc</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
            <CheckCheck size={16} />
            Đọc tất cả
          </button>
        </div>
      </div>

      {/* Messages list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-muted)' }}>
            <MessageCircle size={48} style={{ margin: '0 auto var(--space-md)', opacity: 0.3 }} />
            <p>Không có tin nhắn nào.</p>
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
                <img src={msg.avatar} alt={msg.sender} className="avatar" />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{msg.sender}</span>
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
                      {msg.time}
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
                    {msg.text}
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
