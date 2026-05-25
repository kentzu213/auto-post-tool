import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Đăng nhập — AutoPost',
  description: 'Đăng nhập hoặc tạo tài khoản AutoPost để bắt đầu quản lý và đăng bài tự động đa nền tảng.',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh' }}>
      {children}
    </div>
  );
}
