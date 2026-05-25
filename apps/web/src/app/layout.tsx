import React from 'react';
import type { Metadata } from 'next';
import '../styles/globals.css';
import Sidebar from '../components/layout/Sidebar';
import NotificationToast from '../components/layout/NotificationToast';

export const metadata: Metadata = {
  title: 'AutoPost — Quản lý & Đăng bài Tự động Đa Nền tảng',
  description: 'Tool premium quản lý và tự động đăng bài lên Facebook, YouTube, TikTok. Hẹn giờ, AI caption, analytics thời gian thực.',
  keywords: ['auto post', 'social media', 'facebook', 'youtube', 'tiktok', 'scheduling'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <div className="app-layout">
          {/* Glow ambient background */}
          <div className="glow-orb glow-orb-1" />
          <div className="glow-orb glow-orb-2" />

          {/* Electron frameless drag bar */}
          <div className="titlebar-drag" />

          {/* Sidebar navigation */}
          <Sidebar />

          {/* Main content area */}
          <main className="main-content">
            {children}
          </main>

          {/* Global notification toast */}
          <NotificationToast />
        </div>
      </body>
    </html>
  );
}
