'use client';

import * as React from 'react';
import { User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/utils/dashboard';

export interface UserUsageRank {
  end_user_id: string;
  user_name?: string;
  requests: number;
  tokens?: number;
  errors?: number;
  cost_usd?: number;
}

export interface TopUsersListProps {
  users?: UserUsageRank[];
  onUserClick?: (userId: string) => void;
  loading?: boolean;
}

export function TopUsersList({ users, onUserClick, loading }: TopUsersListProps) {
  const t = useTranslations('dashboard');

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-top-users__loading">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-surface-high rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!users || users.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center" data-testid="dashboard-top-users">
        <p className="text-sm text-tertiary">{t('no_users')}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden" data-testid="dashboard-top-users">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{t('top_users')}</h3>
      </div>
      <div className="divide-y divide-border">
        {users.map((user) => (
          <div
            key={user.end_user_id}
            data-testid={`dashboard-top-users__row--${user.end_user_id}`}
            className={cn(
              'px-4 py-3 hover:bg-hover cursor-pointer transition-colors',
              onUserClick && 'hover:bg-hover'
            )}
            onClick={() => onUserClick?.(user.end_user_id)}
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent/20 to-accent/40 flex items-center justify-center">
                <User className="h-4 w-4 text-accent" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{user.user_name || user.end_user_id}</p>
                <p className="text-xs text-tertiary">{formatNumber(user.requests)} requests</p>
              </div>
              <div className="text-right text-xs text-tertiary">
                {user.cost_usd !== undefined && `$${user.cost_usd.toFixed(2)}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
