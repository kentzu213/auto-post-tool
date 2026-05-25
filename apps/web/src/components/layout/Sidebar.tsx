'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  PenTool,
  Calendar as CalendarIcon,
  MessageSquare,
  Link2,
  Settings,
  Zap,
  KeyRound,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { id: 'composer', label: 'Composer', icon: PenTool, href: '/composer' },
  { id: 'calendar', label: 'Lịch Đăng Bài', icon: CalendarIcon, href: '/calendar' },
  { id: 'inbox', label: 'Hộp Thư', icon: MessageSquare, href: '/inbox' },
  { id: 'accounts', label: 'Tài Khoản MXH', icon: Link2, href: '/accounts' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <Zap size={28} style={{ color: '#6366f1' }} />
        <h1>AutoPost</h1>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link href="/settings/providers" className={`nav-item ${pathname?.startsWith('/settings/providers') ? 'active' : ''}`}>
          <KeyRound size={20} />
          <span>API Providers</span>
        </Link>
        <Link href="/settings" className="nav-item">
          <Settings size={20} />
          <span>Cài Đặt</span>
        </Link>
      </div>
    </aside>
  );
}
