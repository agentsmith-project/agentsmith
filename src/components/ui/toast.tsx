/**
 * Toast Notifications
 *
 * Simple toast notification system for user feedback.
 */

'use client';

import { create } from 'zustand';
import { CheckCircle, AlertCircle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message, duration = 5000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, duration }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const typeStyles: Record<ToastType, { iconClass: string; barClass: string }> = {
  success: { iconClass: 'text-success', barClass: 'border-l-success/70' },
  error: { iconClass: 'text-error', barClass: 'border-l-error/70' },
  warning: { iconClass: 'text-warning', barClass: 'border-l-warning/70' },
  info: { iconClass: 'text-accent', barClass: 'border-l-accent/70' },
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        const styles = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            className={[
              'flex items-start gap-3 p-4 rounded-md border border-subtle bg-surface-high shadow-float',
              'border-l-2',
              styles.barClass,
            ].join(' ')}
          >
            <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${styles.iconClass}`} />
            <p className="flex-1 text-sm text-primary">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 text-tertiary hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Convenience functions
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast('success', message, duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast('error', message, duration),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast('warning', message, duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast('info', message, duration),
};
