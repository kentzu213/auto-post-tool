'use client';

import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, 
  Users, 
  Eye, 
  MousePointerClick, 
  ArrowUpRight, 
  ArrowDownRight, 
  RefreshCw, 
  AlertCircle,
  Clock,
  Sparkles,
  Link
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import api from '../../lib/api';

interface DashboardData {
  overview: {
    totalReach: number;
    totalImpressions: number;
    totalEngagement: number;
    totalViews: number;
    totalWatchTime: number;
    totalClicks: number;
  };
  postsByStatus: Array<{ status: string; count: number }>;
  postsByPlatform: Array<{ platform: string; count: number }>;
  analyticsCount: number;
  lastSyncedAt?: string | null;
  dataSource?: 'live' | 'demo' | 'pending';
}

interface HeatmapData {
  heatmap: Array<{ day: number; hour: number; avgEngagement: number; count: number }>;
  topSlots: any[];
}

interface RecentPostItem {
  id: string;
  title: string;
  platform: string;
  status: string;
  reach: string;
  engagement: string;
}

interface PlatformBreakdownItem {
  name: string;
  color: string;
  percent: number;
  posts: number;
  reach: string;
}

function formatNumber(num: number): string {
  if (num === undefined || num === null) return '0';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toLocaleString();
}

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
      title={`Engagement trung bình: ${value}`}
    >
      {value > 0 ? value : ''}
    </div>
  );
}

export default function DashboardPage() {
  const { workspaceId } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [recentPosts, setRecentPosts] = useState<RecentPostItem[]>([]);
  const [platformBreakdown, setPlatformBreakdown] = useState<PlatformBreakdownItem[]>([]);
  const [heatmap, setHeatmap] = useState<Array<{ day: string; hours: number[] }>>([]);
  const [accountsCount, setAccountsCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDashboardData = async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);
      setError(null);

      // Fetch all required data in parallel
      const [summary, heatmapRes, postsRes, accountsRes, fbData, ytData, ttData] = await Promise.all([
        api.get<DashboardData>('/analytics/dashboard', { workspaceId }),
        api.get<HeatmapData>('/analytics/heatmap', { workspaceId }),
        api.get<{ data: any[] }>('/posts', { workspaceId, limit: 10 }),
        api.get<any[]>('/social-auth/accounts', { workspaceId }),
        api.get<any>('/analytics/platform', { workspaceId, platform: 'facebook' }).catch(() => ({ totals: { reach: 0 }, count: 0 })),
        api.get<any>('/analytics/platform', { workspaceId, platform: 'youtube' }).catch(() => ({ totals: { reach: 0 }, count: 0 })),
        api.get<any>('/analytics/platform', { workspaceId, platform: 'tiktok' }).catch(() => ({ totals: { reach: 0 }, count: 0 })),
      ]);

      setDashboardData(summary);
      setAccountsCount(accountsRes.length);

      // 1. Flatten post schedules to show actual social postings in "Bài Viết Gần Đây"
      const flattenedPosts: RecentPostItem[] = [];
      postsRes.data.forEach((post: any) => {
        if (post.schedules && post.schedules.length > 0) {
          post.schedules.forEach((schedule: any) => {
            flattenedPosts.push({
              id: schedule.id,
              title: post.title,
              platform: schedule.platform,
              status: schedule.status,
              reach: schedule.analytics ? formatNumber(schedule.analytics.reach) : '0',
              engagement: schedule.analytics ? formatNumber(schedule.analytics.engagement) : '0',
            });
          });
        } else {
          flattenedPosts.push({
            id: post.id,
            title: post.title,
            platform: '—',
            status: post.status,
            reach: '—',
            engagement: '—',
          });
        }
      });
      setRecentPosts(flattenedPosts.slice(0, 4));

      // 2. Map Platform Breakdown
      const totalReachAll = (fbData.totals?.reach || 0) + (ytData.totals?.reach || 0) + (ttData.totals?.reach || 0);
      setPlatformBreakdown([
        { 
          name: 'Facebook', 
          color: 'var(--color-facebook)', 
          percent: totalReachAll > 0 ? Math.round(((fbData.totals?.reach || 0) / totalReachAll) * 100) : 0, 
          posts: fbData.count || 0, 
          reach: formatNumber(fbData.totals?.reach || 0) 
        },
        { 
          name: 'YouTube', 
          color: 'var(--color-youtube)', 
          percent: totalReachAll > 0 ? Math.round(((ytData.totals?.reach || 0) / totalReachAll) * 100) : 0, 
          posts: ytData.count || 0, 
          reach: formatNumber(ytData.totals?.reach || 0) 
        },
        { 
          name: 'TikTok', 
          color: '#25F4EE', 
          percent: totalReachAll > 0 ? Math.round(((ttData.totals?.reach || 0) / totalReachAll) * 100) : 0, 
          posts: ttData.count || 0, 
          reach: formatNumber(ttData.totals?.reach || 0) 
        },
      ]);

      // 3. Map Heatmap best time to post
      const daysOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      const grid = daysOfWeek.map(day => ({
        day,
        hours: Array(24).fill(0),
      }));

      heatmapRes.heatmap?.forEach((item: any) => {
        const dayIndex = item.day;
        const hour = item.hour;
        if (dayIndex >= 0 && dayIndex < 7 && hour >= 0 && hour < 24) {
          grid[dayIndex].hours[hour] = item.avgEngagement;
        }
      });

      const orderedGrid = [
        grid[1], // T2
        grid[2], // T3
        grid[3], // T4
        grid[4], // T5
        grid[5], // T6
        grid[6], // T7
        grid[0], // CN
      ];
      setHeatmap(orderedGrid);

      // Đóng dấu thời điểm fetch thành công (dùng làm fallback nếu chưa có lastSyncedAt từ server).
      setLastUpdated(new Date());

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Lỗi kết nối đến server để tải dữ liệu thống kê.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!workspaceId) return;

    fetchDashboardData();

    // Auto-refresh ~30s: gọi silent refetch (giữ nguyên dữ liệu cũ, chỉ hiện indicator nhỏ),
    // tránh nháy toàn màn hình. Dọn dẹp interval khi unmount hoặc khi workspaceId đổi.
    const intervalId = setInterval(() => {
      fetchDashboardData(true);
    }, 30000);

    return () => clearInterval(intervalId);
  }, [workspaceId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
        <RefreshCw size={40} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-md)' }}>
          Đang tải dữ liệu báo cáo thời gian thực từ database...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ maxWidth: '600px', margin: '40px auto', textAlign: 'center', padding: '32px' }}>
        <AlertCircle size={48} style={{ color: 'var(--color-youtube)', marginBottom: '16px' }} />
        <h3 style={{ marginBottom: '12px' }}>Không Thể Tải Báo Cáo</h3>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => fetchDashboardData()}>
          Thử Lại
        </button>
      </div>
    );
  }

  // Calculate Success Rate from postsByStatus
  const publishedCount = dashboardData?.postsByStatus?.find(s => s.status === 'published')?.count || 0;
  const failedCount = dashboardData?.postsByStatus?.find(s => s.status === 'failed')?.count || 0;
  const totalCompleted = publishedCount + failedCount;
  const successRate = totalCompleted > 0 
    ? ((publishedCount / totalCompleted) * 100).toFixed(1) + '%' 
    : '100%';

  // Nhãn nguồn dữ liệu trung thực dựa trên dataSource từ API.
  const dataSource = dashboardData?.dataSource ?? 'pending';
  const dataSourceBadge =
    dataSource === 'live'
      ? { label: 'Dữ liệu live', className: 'badge-success' }
      : dataSource === 'demo'
        ? { label: 'Dữ liệu demo', className: 'badge-warning' }
        : { label: 'Chưa có số liệu', className: 'badge-info' };

  // Thời điểm cập nhật: ưu tiên lastSyncedAt (thời điểm đồng bộ số liệu thật gần nhất từ server),
  // fallback về thời điểm fetch cục bộ nếu server chưa có.
  const updatedAtDate = dashboardData?.lastSyncedAt
    ? new Date(dashboardData.lastSyncedAt)
    : lastUpdated;
  const updatedAtLabel = updatedAtDate
    ? updatedAtDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const STATS = [
    { 
      label: 'TOTAL REACH', 
      value: formatNumber(dashboardData?.overview.totalReach || 0), 
      desc: 'Lượt tiếp cận thực tế', 
      icon: Eye,
      color: 'var(--color-primary)'
    },
    { 
      label: 'ENGAGEMENT', 
      value: formatNumber(dashboardData?.overview.totalEngagement || 0), 
      desc: 'Lượt tương tác thực tế', 
      icon: MousePointerClick,
      color: '#10b981'
    },
    { 
      label: 'ACTIVE ACCOUNTS', 
      value: `${accountsCount} Kênh`, 
      desc: 'Tài khoản đang liên kết', 
      icon: Users,
      color: '#f59e0b'
    },
    { 
      label: 'SUCCESS RATE', 
      value: successRate, 
      desc: 'Tỉ lệ đăng bài thành công', 
      icon: TrendingUp,
      color: '#3b82f6'
    },
  ];

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Analytics &amp; Báo Cáo</h2>
          <p>Dữ liệu tổng hợp từ các bài đăng và kênh thực tế trong hệ thống của bạn.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            <span
              className={`badge ${dataSourceBadge.className}`}
              title={
                dataSource === 'live'
                  ? 'Số liệu thật đồng bộ từ API nền tảng.'
                  : dataSource === 'demo'
                    ? 'Chỉ có tài khoản mock/demo — số liệu không phản ánh nền tảng thật.'
                    : 'Đã đăng bài thật nhưng chưa đồng bộ được số liệu (hoặc chưa có bài đăng).'
              }
            >
              {dataSourceBadge.label}
            </span>
            {updatedAtLabel && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <Clock size={12} />
                Cập nhật lúc {updatedAtLabel}
              </span>
            )}
            {refreshing && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                <RefreshCw size={12} className="animate-spin" />
                Đang làm mới...
              </span>
            )}
          </div>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={() => fetchDashboardData(true)} 
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Đang cập nhật...' : 'Cập nhật số liệu'}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-lg)' }}>
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="stat-card" key={stat.label} style={{ position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <Icon size={24} style={{ color: stat.color }} />
              </div>
              <div className="stat-value" style={{ fontSize: '2rem', fontWeight: 800 }}>{stat.value}</div>
              <div className="stat-label" style={{ fontWeight: 600, letterSpacing: '0.05em' }}>{stat.label}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {stat.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Two column layout */}
      <div className="grid-2" style={{ marginBottom: 'var(--space-xl)' }}>
        
        {/* Recent Posts */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} style={{ color: 'var(--color-primary)' }} />
              Bài Viết Gần Đây
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentPosts.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Chưa có lịch sử đăng bài thực tế nào. Hãy bắt đầu soạn thảo và đăng bài viết đầu tiên của bạn!
              </div>
            ) : (
              recentPosts.map((post) => (
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
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                  className="post-row-hover"
                >
                  <div style={{ flex: 1, minWidth: 0, marginRight: '16px' }}>
                    <div 
                      style={{ 
                        fontWeight: 600, 
                        fontSize: 'var(--font-size-md)', 
                        marginBottom: '6px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {post.title}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {post.platform !== '—' && (
                        <span className={`badge badge-${post.platform}`}>{post.platform}</span>
                      )}
                      <span className={`badge ${
                        post.status === 'published' ? 'badge-success' : 
                        post.status === 'scheduled' ? 'badge-info' : 
                        post.status === 'failed' ? 'badge-danger' : 'badge-warning'
                      }`}>
                        {post.status}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                    <div>Reach: <strong style={{ color: 'var(--color-text-primary)' }}>{post.reach}</strong></div>
                    <div>Tương tác: <strong style={{ color: 'var(--color-text-primary)' }}>{post.engagement}</strong></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Platform Breakdown */}
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Link size={18} style={{ color: 'var(--color-primary)' }} />
              Hiệu Suất Theo Nền Tảng
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {platformBreakdown.every(p => p.posts === 0) ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                Chưa có dữ liệu hiệu suất của các bài viết thực tế trên mạng xã hội.
              </div>
            ) : (
              platformBreakdown.map((p) => (
                <div key={p.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{p.name}</span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                      {p.posts} bài · {p.reach} reach
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '10px',
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
              ))
            )}
          </div>
        </div>

      </div>

      {/* Best Time Heatmap */}
      <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="card-header">
          <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} style={{ color: 'var(--color-primary)' }} />
            Best Time to Post — Heatmap Tương Tác Thực
          </span>
        </div>
        
        {heatmap.length === 0 || heatmap.every(row => row.hours.every(v => v === 0)) ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Đang thu thập dữ liệu thời gian đăng bài hiệu quả... Bản đồ nhiệt sẽ hiển thị khi bạn có các bài đăng tương tác thực tế.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: '2px', marginBottom: '4px', paddingLeft: '32px' }}>
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} style={{ width: '28px', textAlign: 'center', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  {i}h
                </div>
              ))}
            </div>
            {heatmap.map((row) => (
              <div key={row.day} style={{ display: 'flex', gap: '2px', alignItems: 'center', marginBottom: '2px' }}>
                <div style={{ width: '32px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {row.day}
                </div>
                {row.hours.map((value, i) => (
                  <HeatmapCell key={i} value={value} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
