'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Facebook, Youtube, Video, Clock, GripVertical, Plus } from 'lucide-react';
import { POST_STATUSES, PLATFORM_LABELS, PLATFORM_COLORS } from '../../lib/constants';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

// ============================================================
// Types
// ============================================================
interface PostSchedule {
  socialAccount: {
    id: string;
    platform: string;
    displayName: string;
    avatarUrl: string;
  };
  status: string;
  scheduledAt: string;
}

interface PostData {
  id: string;
  title: string | null;
  content: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  schedules: PostSchedule[];
}

const PLATFORM_ICON: Record<string, React.ElementType> = {
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Video,
};

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// ============================================================
// Time Slots for quick scheduling
// ============================================================
const TIME_SLOTS = [
  { label: '06:00', hour: 6, emoji: '🌅' },
  { label: '08:00', hour: 8, emoji: '☀️' },
  { label: '10:00', hour: 10, emoji: '📱' },
  { label: '12:00', hour: 12, emoji: '🍜' },
  { label: '14:00', hour: 14, emoji: '💼' },
  { label: '17:00', hour: 17, emoji: '🏠' },
  { label: '19:00', hour: 19, emoji: '📺' },
  { label: '20:30', hour: 20, minute: 30, emoji: '🔥' },
  { label: '22:00', hour: 22, emoji: '🌙' },
];

// ============================================================
// Helpers
// ============================================================
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ============================================================
// Main Component
// ============================================================
export default function CalendarPage() {
  const { workspaceId, showNotification } = useAppStore();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);

  // Drag state
  const [draggedPost, setDraggedPost] = useState<PostData | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Quick schedule modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleTime, setScheduleTime] = useState('20:30');

  // ============================================================
  // Load REAL posts from API
  // ============================================================
  useEffect(() => {
    loadPosts();
  }, [workspaceId, currentYear, currentMonth]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const result = await api.get<{ data: PostData[]; meta: any }>('/posts', {
        workspaceId,
        limit: 100,
      });
      setPosts(result.data || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // Helpers for calendar
  // ============================================================
  const getPostsForDay = useCallback((day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return posts.filter(post => {
      const postDate = post.scheduledAt
        ? new Date(post.scheduledAt)
        : new Date(post.createdAt);
      return getDateKey(postDate) === dateStr;
    });
  }, [posts, currentYear, currentMonth]);

  // ============================================================
  // Calendar navigation
  // ============================================================
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  const goToToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // ============================================================
  // Drag & Drop — Reschedule posts
  // ============================================================
  const handleDragStart = (post: PostData) => {
    if (post.status === 'published' || post.status === 'publishing') return;
    setDraggedPost(post);
  };

  const handleDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    setDragOverDate(dateStr);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = async (e: React.DragEvent, day: number) => {
    e.preventDefault();
    setDragOverDate(null);

    if (!draggedPost) return;
    if (draggedPost.status === 'published' || draggedPost.status === 'publishing') {
      showNotification('error', 'Không thể di chuyển bài đã đăng!');
      setDraggedPost(null);
      return;
    }

    // Get the original time or default to 20:30
    const origDate = draggedPost.scheduledAt
      ? new Date(draggedPost.scheduledAt)
      : new Date();
    const hours = draggedPost.scheduledAt ? origDate.getHours() : 20;
    const minutes = draggedPost.scheduledAt ? origDate.getMinutes() : 30;

    const newDate = new Date(currentYear, currentMonth, day, hours, minutes);

    // Prevent scheduling in the past
    if (newDate < new Date()) {
      showNotification('error', 'Không thể lên lịch cho thời gian đã qua!');
      setDraggedPost(null);
      return;
    }

    try {
      await api.patch(`/posts/${draggedPost.id}`, {
        scheduledAt: newDate.toISOString(),
      });
      showNotification('success', `📅 Đã chuyển "${draggedPost.title || 'Bài viết'}" sang ngày ${day}/${currentMonth + 1}`);
      loadPosts();
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi khi di chuyển bài viết');
    }

    setDraggedPost(null);
  };

  // ============================================================
  // Quick Schedule — Click ngày trống để tạo bài mới
  // ============================================================
  const handleDayClick = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const clickDate = new Date(currentYear, currentMonth, day);

    if (clickDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      return; // Past date
    }

    setScheduleDate(dateStr);
    setShowScheduleModal(true);
  };

  const handleQuickSchedule = () => {
    // Navigate to composer with pre-filled schedule date
    const dateTime = `${scheduleDate}T${scheduleTime}`;
    window.location.href = `/composer?schedule=${encodeURIComponent(dateTime)}`;
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  // Stats
  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  const publishedCount = posts.filter(p => p.status === 'published').length;
  const draftCount = posts.filter(p => p.status === 'draft').length;

  return (
    <>
      <div className="page-header">
        <h2>Lịch Đăng Bài</h2>
        <p>Kéo thả để đổi ngày đăng · Click ngày trống để lên lịch mới · Dữ liệu thật từ hệ thống</p>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: '16px', marginBottom: 'var(--space-lg)',
        flexWrap: 'wrap',
      }}>
        {[
          { label: 'Đã lên lịch', count: scheduledCount, color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
          { label: 'Đã đăng', count: publishedCount, color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
          { label: 'Bản nháp', count: draftCount, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
        ].map(stat => (
          <div key={stat.label} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 18px',
            background: stat.bg,
            border: `1px solid ${stat.color}20`,
            borderRadius: 'var(--radius-md)',
          }}>
            <span style={{ fontSize: '20px', fontWeight: 800, color: stat.color }}>{stat.count}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{stat.label}</span>
          </div>
        ))}
      </div>

      <div className="card">
        {/* Calendar header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-lg)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>
              <ChevronLeft size={20} />
            </button>
            <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, textTransform: 'capitalize', minWidth: '180px', textAlign: 'center' }}>
              {monthLabel}
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>
              <ChevronRight size={20} />
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={goToToday}>
            Hôm nay
          </button>
        </div>

        {/* Day headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '1px',
          marginBottom: '4px',
        }}>
          {DAYS.map((d) => (
            <div key={d} style={{
              textAlign: 'center',
              padding: '8px',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 700,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '1px',
          background: 'var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          {/* Empty cells */}
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`empty-${i}`} style={{
              background: 'var(--color-bg-primary)',
              minHeight: '110px',
              padding: '8px',
              opacity: 0.4,
            }} />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayPosts = getPostsForDay(day);
            const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPast = new Date(currentYear, currentMonth, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isDragOver = dragOverDate === dateStr;

            return (
              <div
                key={day}
                onDragOver={(e) => handleDragOver(e, dateStr)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, day)}
                onClick={() => dayPosts.length === 0 && handleDayClick(day)}
                style={{
                  background: isDragOver
                    ? 'rgba(99, 102, 241, 0.1)'
                    : isToday
                      ? 'rgba(99, 102, 241, 0.03)'
                      : 'var(--color-bg-primary)',
                  minHeight: '110px',
                  padding: '8px',
                  position: 'relative',
                  cursor: isPast ? 'default' : 'pointer',
                  opacity: isPast ? 0.5 : 1,
                  transition: 'background 0.15s',
                  borderLeft: isToday ? '3px solid var(--color-brand-primary)' : 'none',
                }}
              >
                {/* Day number */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '4px',
                }}>
                  <div style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: isToday ? 700 : 400,
                    color: isToday ? 'var(--color-brand-primary)' : 'var(--color-text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: isToday ? 'var(--color-brand-glow)' : 'transparent',
                  }}>
                    {day}
                  </div>
                  {/* Add button on hover */}
                  {!isPast && dayPosts.length === 0 && (
                    <Plus size={14} style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
                  )}
                </div>

                {/* Posts */}
                {dayPosts.map((post) => {
                  const primaryPlatform = post.schedules?.[0]?.socialAccount?.platform || 'facebook';
                  const Icon = PLATFORM_ICON[primaryPlatform] || Video;
                  const color = PLATFORM_COLORS[primaryPlatform] || '#6366f1';
                  const statusInfo = POST_STATUSES[post.status];
                  const canDrag = post.status !== 'published' && post.status !== 'publishing';
                  const time = post.scheduledAt
                    ? new Date(post.scheduledAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                    : null;

                  return (
                    <div
                      key={post.id}
                      draggable={canDrag}
                      onDragStart={() => handleDragStart(post)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '10px',
                        padding: '3px 5px',
                        borderRadius: '5px',
                        marginBottom: '2px',
                        background: `${color}10`,
                        border: `1px solid ${color}25`,
                        cursor: canDrag ? 'grab' : 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        transition: 'transform 0.1s',
                      }}
                      title={`${post.title || post.content.substring(0, 50)} — ${time || 'Nháp'}\n${post.schedules?.length || 0} tài khoản · ${statusInfo?.label || post.status}`}
                    >
                      {canDrag && <GripVertical size={8} style={{ opacity: 0.4, flexShrink: 0 }} />}
                      <Icon size={10} style={{ flexShrink: 0, color }} />
                      {time && (
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{time}</span>
                      )}
                      <span style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                      }}>
                        {post.title || post.content.substring(0, 30)}
                      </span>
                      {/* Status dot */}
                      <span style={{
                        width: '5px', height: '5px',
                        borderRadius: '50%',
                        background: post.status === 'published' ? '#22c55e'
                          : post.status === 'scheduled' ? '#6366f1'
                          : post.status === 'failed' ? '#ef4444'
                          : '#f59e0b',
                        flexShrink: 0,
                      }} />
                    </div>
                  );
                })}

                {/* Drag over indicator */}
                {isDragOver && (
                  <div style={{
                    position: 'absolute',
                    inset: '4px',
                    border: '2px dashed var(--color-brand-primary)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '10px',
                    color: 'var(--color-brand-primary)',
                    fontWeight: 600,
                    pointerEvents: 'none',
                  }}>
                    Thả vào đây
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: '16px', marginTop: 'var(--space-md)',
          fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)',
          flexWrap: 'wrap',
        }}>
          <span>💡 <strong>Kéo thả</strong> để đổi ngày</span>
          <span>➕ <strong>Click ngày trống</strong> để lên lịch mới</span>
          {[
            { color: '#6366f1', label: 'Đã lên lịch' },
            { color: '#22c55e', label: 'Đã đăng' },
            { color: '#f59e0b', label: 'Nháp' },
            { color: '#ef4444', label: 'Thất bại' },
          ].map(item => (
            <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* ====== UPCOMING POSTS — Real data ====== */}
      <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
        <div className="card-header">
          <span className="card-title">📅 Bài Sắp Đăng</span>
          {loading && <span className="spinner" style={{ width: '16px', height: '16px' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {posts.filter(p => p.status === 'scheduled' && p.scheduledAt).length === 0 && !loading && (
            <div style={{
              textAlign: 'center', padding: '24px',
              color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)',
            }}>
              Chưa có bài nào được lên lịch. Vào Composer để tạo bài mới!
            </div>
          )}
          {posts
            .filter(p => p.status === 'scheduled' && p.scheduledAt)
            .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
            .slice(0, 10)
            .map((post) => {
              const primaryPlatform = post.schedules?.[0]?.socialAccount?.platform || 'facebook';
              const Icon = PLATFORM_ICON[primaryPlatform] || Video;
              const color = PLATFORM_COLORS[primaryPlatform] || '#6366f1';
              const scheduleTime = post.scheduledAt
                ? new Date(post.scheduledAt).toLocaleString('vi-VN', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '';

              return (
                <div key={post.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  background: 'var(--color-surface-1)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${color}20`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Icon size={18} style={{ color }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
                        {post.title || post.content.substring(0, 50)}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={10} />
                        {scheduleTime}
                        {post.schedules && post.schedules.length > 0 && (
                          <span style={{ color }}>· {post.schedules.length} tài khoản</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    background: `${color}10`,
                    color,
                    textTransform: 'capitalize',
                  }}>
                    {PLATFORM_LABELS[primaryPlatform] || primaryPlatform}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* ====== QUICK SCHEDULE MODAL ====== */}
      {showScheduleModal && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}
          onClick={() => setShowScheduleModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: '20px',
              padding: '28px',
              width: '400px',
              maxWidth: '90vw',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700 }}>
              📅 Lên Lịch Nhanh — {scheduleDate}
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Chọn khung giờ → Chuyển sang Composer để viết nội dung
            </p>

            {/* Time slot grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              marginBottom: '20px',
            }}>
              {TIME_SLOTS.map(slot => (
                <button
                  key={slot.label}
                  onClick={() => setScheduleTime(slot.label)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '10px',
                    border: scheduleTime === slot.label
                      ? '2px solid var(--color-brand-primary)'
                      : '1px solid var(--color-border)',
                    background: scheduleTime === slot.label
                      ? 'var(--color-brand-glow)'
                      : 'var(--color-surface-1)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: scheduleTime === slot.label
                      ? 'var(--color-brand-primary)'
                      : 'var(--color-text-secondary)',
                    fontFamily: 'inherit',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>{slot.emoji}</span>
                  {slot.label}
                </button>
              ))}
            </div>

            {/* Custom time */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '6px', display: 'block' }}>
                Hoặc nhập giờ tùy chỉnh:
              </label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="input"
                style={{ fontSize: '14px' }}
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowScheduleModal(false)}
                style={{
                  flex: 1, padding: '12px',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '12px',
                  color: 'var(--color-text-secondary)',
                  fontSize: '14px', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Hủy
              </button>
              <button
                onClick={handleQuickSchedule}
                style={{
                  flex: 2, padding: '12px',
                  background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
                ✏️ Mở Composer tại {scheduleTime}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
