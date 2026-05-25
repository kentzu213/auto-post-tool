'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import NotificationToast from './NotificationToast';

/**
 * AppShell — Conditional layout wrapper
 * Hides sidebar & app chrome on auth pages (/login, /auth)
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Auth pages don't need sidebar
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/auth');

  if (isAuthPage) {
    return (
      <>
        {children}
        <NotificationToast />
      </>
    );
  }

  return (
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
  );
}
