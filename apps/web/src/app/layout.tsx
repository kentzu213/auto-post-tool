import React from 'react';
import type { Metadata } from 'next';
import '../styles/globals.css';
import AppShell from '../components/layout/AppShell';

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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
