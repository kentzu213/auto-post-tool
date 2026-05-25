'use client';

import React from 'react';
import { Settings, Bell, Shield, Palette, Globe } from 'lucide-react';

const SETTING_SECTIONS = [
  {
    icon: Bell,
    title: 'Thông Báo',
    description: 'Cài đặt email, push notification khi đăng bài thành công/thất bại.',
    status: 'coming-soon',
  },
  {
    icon: Shield,
    title: 'Bảo Mật',
    description: 'Xác thực 2 bước (2FA), quản lý phiên đăng nhập.',
    status: 'coming-soon',
  },
  {
    icon: Palette,
    title: 'Giao Diện',
    description: 'Tùy chỉnh theme, dark/light mode, ngôn ngữ.',
    status: 'coming-soon',
  },
  {
    icon: Globe,
    title: 'API & Webhooks',
    description: 'Quản lý API keys, webhook URLs cho tích hợp bên ngoài.',
    status: 'coming-soon',
  },
];

export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <h2>
          <Settings size={24} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Cài Đặt
        </h2>
        <p>Quản lý cấu hình workspace, bảo mật và tích hợp.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {SETTING_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <div className="card" key={section.title} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-xl)',
              padding: 'var(--space-xl)',
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-brand-glow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={22} style={{ color: 'var(--color-brand-primary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, marginBottom: '4px' }}>
                  {section.title}
                </h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                  {section.description}
                </p>
              </div>
              <span className="badge badge-info">Coming Soon</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
