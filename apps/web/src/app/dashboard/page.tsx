'use client';

import React from 'react';
import { TrendingUp, Users, Eye, MousePointerClick, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const STATS = [
  { label: 'TOTAL REACH', value: '128.4K', change: '+12.3%', positive: true, icon: Eye },
  { label: 'ENGAGEMENT', value: '9,847', change: '+8.7%', positive: true, icon: MousePointerClick },
  { label: 'FOLLOWERS', value: '24.1K', change: '+5.2%', positive: true, icon: Users },
  { label: 'POST SUCCESS RATE', value: '97.3%', change: '-0.5%', positive: false, icon: TrendingUp },
];

const RECENT_POSTS = [
  { id: '1', title: 'Đánh giá chi tiết iPhone 18 Pro Max', platform: 'facebook', status: 'published', reach: '12.3K', engagement: '847' },
  { id: '2', title: 'Top 5 công nghệ AI bùng nổ 2026', platform: 'youtube', status: 'published', reach: '45.6K', engagement: '2,341' },
  { id: '3', title: 'Một ngày làm lập trình viên AI', platform: 'tiktok', status: 'scheduled', reach: '—', engagement: '—' },
  { id: '4', title: 'Hướng dẫn setup workspace pro', platform: 'facebook', status: 'draft', reach: '—', engagement: '—' },
];

const BEST_TIMES = [
  { day: 'T2', hours: [0, 0, 0, 0, 0, 0, 1, 2, 4, 5, 3, 2, 3, 4, 3, 2, 2, 3, 5, 7, 8, 6, 3, 1] },
  { day: 'T3', hours: [0, 0, 0, 0, 0, 0, 1, 3, 4, 6, 4, 3, 2, 3, 4, 3, 2, 4, 6, 8, 9, 7, 4, 1] },
  { day: 'T4', hours: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 3, 2, 3, 4, 3, 2, 2, 3, 5, 7, 8, 6, 3, 1] },
  { day: 'T5', hours: [0, 0, 0, 0, 0, 0, 1, 2, 5, 6, 4, 3, 2, 4, 5, 3, 2, 4, 6, 9, 10, 7, 4, 2] },
  { day: 'T6', hours: [0, 0, 0, 0, 0, 0, 1, 3, 5, 7, 5, 3, 3, 4, 5, 4, 3, 5, 7, 8, 9, 7, 5, 2] },
  { day: 'T7', hours: [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 5, 6, 7, 8, 9, 8, 6, 4, 2] },
  { day: 'CN', hours: [0, 0, 0, 0, 0, 1, 2, 3, 4, 6, 7, 8, 7, 6, 5, 4, 5, 6, 7, 8, 7, 5, 3, 1] },
];

function HeatmapCell({ value }: { value: number }) {
  const opacity = Math.min(value / 10, 1);
  return (
    <div
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '4px',
        backgroundColor: `rgba(99, 102, 241, ${opacity * 0.8 + 0.05})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        color: opacity > 0.4 ? '#fff' : 'var(--color-text-muted)',
        transition: 'all 0.15s',
        cursor: 'default',
      }}
      title={`Engagement score: ${value}`}
    >
      {value > 0 ? value : ''}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <div className="page-header">
        <h2>Analytics & Báo Cáo</h2>
        <p>Theo dõi reach, impressions và clicks thời gian thực.</p>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="stat-card" key={stat.label}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <Icon size={20} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
              <div className={`stat-change ${stat.positive ? 'positive' : 'negative'}`}>
                {stat.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {stat.change} vs tháng trước
              </div>
            </div>
          );
        })}
      </div>

      {/* Two column layout */}
      <div className="grid-2" style={{ marginBottom: 'var(--space-xl)' }}>
        {/* Recent Posts */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Bài Viết Gần Đây</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {RECENT_POSTS.map((post) => (
              <div
                key={post.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', marginBottom: '4px' }}>
                    {post.title}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={`badge badge-${post.platform}`}>{post.platform}</span>
                    <span className={`badge ${post.status === 'published' ? 'badge-success' : post.status === 'scheduled' ? 'badge-info' : 'badge-warning'}`}>
                      {post.status}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  <div>Reach: {post.reach}</div>
                  <div>Eng: {post.engagement}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Platform Breakdown */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Hiệu Suất Theo Nền Tảng</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { name: 'Facebook', color: 'var(--color-facebook)', percent: 45, posts: 28, reach: '57.8K' },
              { name: 'YouTube', color: 'var(--color-youtube)', percent: 35, posts: 12, reach: '44.9K' },
              { name: 'TikTok', color: '#25F4EE', percent: 20, posts: 18, reach: '25.7K' },
            ].map((p) => (
              <div key={p.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{p.name}</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                    {p.posts} bài · {p.reach} reach
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    background: 'var(--color-surface-1)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${p.percent}%`,
                      height: '100%',
                      background: p.color,
                      borderRadius: 'var(--radius-full)',
                      transition: 'width 0.8s ease-out',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Best Time Heatmap */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">🔥 Best Time to Post — Heatmap</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '2px', marginBottom: '4px', paddingLeft: '32px' }}>
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} style={{ width: '28px', textAlign: 'center', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                {i}h
              </div>
            ))}
          </div>
          {BEST_TIMES.map((row) => (
            <div key={row.day} style={{ display: 'flex', gap: '2px', alignItems: 'center', marginBottom: '2px' }}>
              <div style={{ width: '28px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                {row.day}
              </div>
              {row.hours.map((value, i) => (
                <HeatmapCell key={i} value={value} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
