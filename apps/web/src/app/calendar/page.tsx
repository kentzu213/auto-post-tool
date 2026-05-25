'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Facebook, Youtube, Video } from 'lucide-react';
import { POST_STATUSES } from '../../lib/constants';

const MOCK_EVENTS = [
  { id: '1', title: 'Review iPhone 18', platform: 'facebook', date: '2026-05-26', time: '09:00', status: 'scheduled' },
  { id: '2', title: 'AI Tutorial 2026', platform: 'youtube', date: '2026-05-27', time: '19:30', status: 'scheduled' },
  { id: '3', title: 'Vlog cuối tuần', platform: 'tiktok', date: '2026-05-28', time: '20:00', status: 'draft' },
  { id: '4', title: 'Đánh giá MacBook M5', platform: 'facebook', date: '2026-05-30', time: '10:00', status: 'published' },
  { id: '5', title: 'Shorts: Tip coding', platform: 'youtube', date: '2026-05-26', time: '14:00', status: 'scheduled' },
];

const PLATFORM_ICON: Record<string, React.ElementType> = {
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Video,
};

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });

  const getEventsForDay = (day: number) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return MOCK_EVENTS.filter((e) => e.date === dateStr);
  };

  return (
    <>
      <div className="page-header">
        <h2>Lịch Đăng Bài Định Kỳ</h2>
        <p>Xem, quản lý và kéo thả sắp xếp lịch đăng bài theo tuần/tháng.</p>
      </div>

      <div className="card">
        {/* Calendar header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-lg)',
        }}>
          <button className="btn btn-ghost btn-sm" onClick={prevMonth}>
            <ChevronLeft size={20} />
          </button>
          <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, textTransform: 'capitalize' }}>
            {monthLabel}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={nextMonth}>
            <ChevronRight size={20} />
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
          {/* Empty cells before first day */}
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`empty-${i}`} style={{
              background: 'var(--color-bg-primary)',
              minHeight: '100px',
              padding: '8px',
            }} />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const events = getEventsForDay(day);
            const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();

            return (
              <div key={day} style={{
                background: 'var(--color-bg-primary)',
                minHeight: '100px',
                padding: '8px',
                position: 'relative',
              }}>
                <div style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? 'var(--color-brand-primary)' : 'var(--color-text-secondary)',
                  marginBottom: '4px',
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
                {events.map((event) => {
                  const Icon = PLATFORM_ICON[event.platform] || Video;
                  const statusInfo = POST_STATUSES[event.status];
                  return (
                    <div
                      key={event.id}
                      style={{
                        fontSize: '10px',
                        padding: '2px 4px',
                        borderRadius: '4px',
                        marginBottom: '2px',
                        background: 'var(--color-bg-glass)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                      }}
                      title={`${event.title} — ${event.time}`}
                    >
                      <Icon size={10} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.title}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming posts list */}
      <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
        <div className="card-header">
          <span className="card-title">📅 Bài Sắp Tới</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {MOCK_EVENTS.filter((e) => e.status === 'scheduled').map((event) => {
            const Icon = PLATFORM_ICON[event.platform] || Video;
            return (
              <div key={event.id} style={{
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
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{event.title}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      {event.date} lúc {event.time}
                    </div>
                  </div>
                </div>
                <span className={`badge badge-${event.platform}`}>{event.platform}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
