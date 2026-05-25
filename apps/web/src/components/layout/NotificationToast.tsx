'use client';

import React from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';

const ICON_MAP = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const CLASS_MAP = {
  success: 'toast-success',
  error: 'toast-error',
  info: 'toast-success',
  warning: 'toast-error',
};

export default function NotificationToast() {
  const notification = useAppStore((s) => s.notification);
  const clearNotification = useAppStore((s) => s.clearNotification);

  if (!notification) return null;

  const Icon = ICON_MAP[notification.type];
  const className = CLASS_MAP[notification.type];

  return (
    <div className={`toast ${className}`} onClick={clearNotification} role="alert">
      <Icon size={20} />
      <span>{notification.message}</span>
    </div>
  );
}
