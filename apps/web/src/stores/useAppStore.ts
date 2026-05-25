'use client';

import { create } from 'zustand';

// ============================================================
// Types
// ============================================================

export interface SocialAccount {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  connected: boolean;
  status: string;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  timestamp: number;
}

// ============================================================
// App Store — Global state management
// ============================================================

interface AppState {
  // Auth
  isAuthenticated: boolean;
  user: { id: string; name: string; email: string } | null;
  workspaceId: string;
  token: string | null;

  // Social Accounts
  socialAccounts: SocialAccount[];

  // UI
  sidebarOpen: boolean;
  notification: Notification | null;

  // Actions — Auth
  login: (user: { id: string; name: string; email: string }, token: string, workspaceId: string) => void;
  logout: () => void;

  // Actions — Social Accounts
  setSocialAccounts: (accounts: SocialAccount[]) => void;

  // Actions — UI
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  showNotification: (type: Notification['type'], message: string) => void;
  clearNotification: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('auth_token') : false,
  user: null,
  workspaceId: typeof window !== 'undefined'
    ? localStorage.getItem('workspace_id') || 'default_workspace'
    : 'default_workspace',
  token: typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null,

  socialAccounts: [],
  sidebarOpen: false,
  notification: null,

  // Auth actions
  login: (user, token, workspaceId) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
      localStorage.setItem('workspace_id', workspaceId);
    }
    set({ isAuthenticated: true, user, token, workspaceId });
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('workspace_id');
    }
    set({ isAuthenticated: false, user: null, token: null, workspaceId: 'default_workspace' });
  },

  // Social accounts
  setSocialAccounts: (accounts) => set({ socialAccounts: accounts }),

  // UI actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  showNotification: (type, message) => {
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      message,
      timestamp: Date.now(),
    };
    set({ notification });
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      set((state) => {
        if (state.notification?.id === notification.id) {
          return { notification: null };
        }
        return state;
      });
    }, 5000);
  },

  clearNotification: () => set({ notification: null }),
}));
