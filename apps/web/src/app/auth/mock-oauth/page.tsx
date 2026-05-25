'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Facebook, Youtube, Flame, Check, ShieldAlert, X } from 'lucide-react';
import { Button } from '@auto-post/ui';

function MockOAuthContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const platform = searchParams.get('platform') || 'facebook';
  const state = searchParams.get('state') || 'default_workspace';

  const [displayName, setDisplayName] = useState(
    platform === 'facebook' ? 'Thế Giới Tech Page' :
    platform === 'youtube' ? 'Nguyễn Văn A - Channel' :
    'A-Vlogs Official'
  );
  
  const [username, setUsername] = useState(
    platform === 'facebook' ? '@tgtech' :
    platform === 'youtube' ? '@anv_vlogs' :
    '@anv_tiktok'
  );

  const [avatarUrl, setAvatarUrl] = useState(
    platform === 'facebook' ? 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=60' :
    platform === 'youtube' ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=60' :
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=60'
  );

  const getPlatformColors = () => {
    switch (platform) {
      case 'facebook':
        return {
          primary: '#3b82f6',
          bg: 'rgba(59, 130, 246, 0.1)',
          border: 'rgba(59, 130, 246, 0.2)',
          icon: Facebook
        };
      case 'youtube':
        return {
          primary: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.1)',
          border: 'rgba(239, 68, 68, 0.2)',
          icon: Youtube
        };
      case 'tiktok':
      default:
        return {
          primary: '#a855f7',
          bg: 'rgba(168, 85, 247, 0.1)',
          border: 'rgba(168, 85, 247, 0.2)',
          icon: Flame
        };
    }
  };

  const colors = getPlatformColors();
  const PlatformIcon = colors.icon;

  const handleAuthorize = () => {
    // Redirect to NestJS API Callback URL with mock code
    const mockCode = `mock_code_${Math.random().toString(36).substring(7)}`;
    const callbackUrl = `http://localhost:3001/social-auth/callback/${platform}?code=${mockCode}&state=${state}`;
    window.location.href = callbackUrl;
  };

  const handleCancel = () => {
    // Go back to the Next.js app
    window.location.href = 'http://localhost:3005/?auth_cancelled=true';
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Glow backgrounds */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '-10%',
        width: '500px',
        height: '500px',
        backgroundColor: colors.primary,
        filter: 'blur(160px)',
        opacity: 0.15,
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <div style={{
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '32px',
        padding: '40px',
        width: '100%',
        maxWidth: '480px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
        zIndex: 1,
        position: 'relative'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            padding: '16px',
            borderRadius: '24px',
            color: colors.primary,
            marginBottom: '16px',
            boxShadow: `0 8px 30px ${colors.bg}`
          }}>
            <PlatformIcon size={40} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '800', margin: '0 0 8px 0', letterSpacing: '-0.025em' }}>
            Ủy Quyền Tài Khoản {platform.toUpperCase()}
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '500' }}>
            CỔNG MOCK OAUTH 2.0 (PHÁT TRIỂN & CHẠY THỬ)
          </span>
        </div>

        {/* Warning card */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px solid rgba(245, 158, 11, 0.15)',
          borderRadius: '16px',
          padding: '16px',
          display: 'flex',
          gap: '12px',
          marginBottom: '24px',
          alignItems: 'flex-start'
        }}>
          <ShieldAlert size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
          <span style={{ fontSize: '0.8rem', color: '#fbbf24', lineHeight: '1.4' }}>
            Hệ thống đang chạy ở chế độ **Mock Mode**. Bạn có thể tùy chỉnh thông tin tài khoản giả lập bên dưới trước khi cấp quyền liên kết.
          </span>
        </div>

        {/* Form fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#94a3b8', marginBottom: '8px' }}>
              Tên Hiển Thị Giả Lập
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '12px 16px',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'border 0.2s'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#94a3b8', marginBottom: '8px' }}>
              Username Giả Lập
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '12px 16px',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#94a3b8', marginBottom: '8px' }}>
              Avatar URL Giả Lập
            </label>
            <input
              type="text"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '12px 16px',
                color: '#fff',
                fontSize: '0.9rem',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '16px' }}>
          <Button
            onClick={handleCancel}
            variant="secondary"
            style={{
              flex: 1,
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '12px',
              borderRadius: '14px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <X size={16} /> Hủy Bỏ
          </Button>

          <Button
            onClick={handleAuthorize}
            variant="primary"
            style={{
              flex: 1,
              background: colors.primary,
              boxShadow: `0 4px 20px ${colors.bg}`,
              color: '#fff',
              padding: '12px',
              borderRadius: '14px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <Check size={16} /> Xác Nhận
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MockOAuthPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#090d16',
        color: '#f8fafc'
      }}>
        Đang tải...
      </div>
    }>
      <MockOAuthContent />
    </Suspense>
  );
}
