'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
      case 'quota':
        return t('quota_updated');
      case 'resource_policy':
        return t('acl_updated');
      case 'role':
        return 'Role updated';
      default:
        return type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('title')} - {memberName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">No change history available</p>
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
                        by {entry.actor_email}
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
                          <p className="text-xs font-medium text-success mb-2">Added:</p>
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
                          <p className="text-xs font-medium text-error mb-2">Removed:</p>
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
                          <p className="text-xs font-medium text-foreground mb-2">Updated:</p>
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
