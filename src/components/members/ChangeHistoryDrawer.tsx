'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, History, ShieldCheck } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { ChangeHistoryEntry } from '@/lib/api/types';

export interface ChangeHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  history?: ChangeHistoryEntry[];
}

export function ChangeHistoryDrawer({
  open,
  onOpenChange,
  memberName,
  history = [],
}: ChangeHistoryDrawerProps) {
  const t = useTranslations('members.history');
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const getChangeTypeLabel = (type: string) => {
    switch (type) {
      case 'permissions':
        return t('permissions_updated');
      case 'resource_policy':
        return t('acl_updated');
      case 'role':
        return t('role_updated');
      default:
        return type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <History className="h-3.5 w-3.5" />
            Members
          </div>
          <DialogTitle>
            {t('title')} - {memberName}
          </DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-10 text-center text-tertiary">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-accent">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <p className="text-sm">{t('empty')}</p>
            </div>
          ) : (
            history.map((entry) => {
              const isExpanded = expandedItems.has(entry.id);
              return (
                <div
                  key={entry.id}
                  className="border border-border rounded-md bg-surface p-4"
                >
                  <button
                    onClick={() => toggleExpanded(entry.id)}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-tertiary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-tertiary" />
                      )}
                      <Badge variant="outline" className="text-xs">
                        {getChangeTypeLabel(entry.change_type)}
                      </Badge>
                      <span className="text-sm text-tertiary">
                        {t('by_actor', { actor: entry.actor_email })}
                      </span>
                      <span className="text-xs text-tertiary">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 space-y-3 pl-7">
                      {entry.changes.added && entry.changes.added.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-success mb-2">{t('added')}</p>
                          <ul className="space-y-1">
                            {entry.changes.added.map((item, idx) => (
                              <li key={idx} className="text-xs text-foreground">
                                <code className="font-mono">{item}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {entry.changes.removed && entry.changes.removed.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-error mb-2">{t('removed')}</p>
                          <ul className="space-y-1">
                            {entry.changes.removed.map((item, idx) => (
                              <li key={idx} className="text-xs text-foreground line-through">
                                <code className="font-mono">{item}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {entry.changes.updated && Object.keys(entry.changes.updated).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-foreground mb-2">{t('updated')}</p>
                          <ul className="space-y-1">
                            {Object.entries(entry.changes.updated).map(([key, value]) => (
                              <li key={key} className="text-xs text-foreground">
                                <code className="font-mono">{key}</code>: {JSON.stringify(value.from)} → {JSON.stringify(value.to)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
