'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { Member } from '@/lib/api/endpoints/members';
import type { PermissionTemplate } from '@/lib/api/types';

export interface ApplyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: PermissionTemplate;
  members: Member[];
  onApply: (
    memberIds: string[],
    permissions: string[],
    template?: string | null
  ) => Promise<{ failedMemberIds?: string[]; failedCount?: number } | void>;
}

const DEFAULT_TEMPLATE_IDS = ['owner', 'admin', 'developer', 'user'];

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  template,
  members,
  onApply,
}: ApplyTemplateDialogProps) {
  const t = useTranslations('members.templates');
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [failedMemberIds, setFailedMemberIds] = React.useState<string[]>([]);
  const [failedCount, setFailedCount] = React.useState(0);

  const applicableMembers = React.useMemo(() => {
    return members.filter((m) => m.status === 'active');
  }, [members]);

  const allSelected = applicableMembers.length > 0 && selectedMemberIds.size === applicableMembers.length;

  const toggleMember = React.useCallback((memberId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(() => {
    if (allSelected) {
      setSelectedMemberIds(new Set());
    } else {
      setSelectedMemberIds(new Set(applicableMembers.map((m) => m.id)));
    }
  }, [allSelected, applicableMembers]);

  const handleApply = React.useCallback(async () => {
    if (selectedMemberIds.size === 0) return;
    const templateId = DEFAULT_TEMPLATE_IDS.includes(template.id) ? template.id : null;
    setSubmitting(true);
    try {
      const result = await onApply(Array.from(selectedMemberIds), template.permissions, templateId);
      const nextFailedMemberIds = result?.failedMemberIds ?? [];
      const nextFailedCount = result?.failedCount ?? nextFailedMemberIds.length;
      if (nextFailedCount > 0) {
        setFailedMemberIds(nextFailedMemberIds);
        setFailedCount(nextFailedCount);
        return;
      }
      setSelectedMemberIds(new Set());
      setFailedMemberIds([]);
      setFailedCount(0);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [selectedMemberIds, template.id, template.permissions, onApply, onOpenChange]);

  const handleRetryFailed = React.useCallback(async () => {
    if (failedMemberIds.length === 0) return;
    const templateId = DEFAULT_TEMPLATE_IDS.includes(template.id) ? template.id : null;

    setSubmitting(true);
    try {
      const result = await onApply(failedMemberIds, template.permissions, templateId);
      const nextFailedMemberIds = result?.failedMemberIds ?? [];
      const nextFailedCount = result?.failedCount ?? nextFailedMemberIds.length;
      if (nextFailedCount > 0) {
        setFailedMemberIds(nextFailedMemberIds);
        setFailedCount(nextFailedCount);
        setSelectedMemberIds(new Set(nextFailedMemberIds));
        return;
      }
      setSelectedMemberIds(new Set());
      setFailedMemberIds([]);
      setFailedCount(0);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [failedMemberIds, onApply, onOpenChange, template.id, template.permissions]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        setSelectedMemberIds(new Set());
        setFailedMemberIds([]);
        setFailedCount(0);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const failedMemberNames = React.useMemo(() => {
    if (failedMemberIds.length === 0) return [];
    const memberMap = new Map(members.map((m) => [m.id, m.name || m.email]));
    return failedMemberIds.map((memberId) => memberMap.get(memberId) ?? memberId);
  }, [failedMemberIds, members]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('apply_to_members')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('apply_dialog_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-tertiary">
            {template.name} ({template.permissions.length} {t('permissions_list').toLowerCase()})
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('select_members')}</Label>
              {applicableMembers.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-1 text-xs"
                  onClick={toggleAll}
                >
                  {allSelected ? t('deselect_all') : t('select_all')}
                </Button>
              )}
            </div>
            <div className="border border-border rounded-md max-h-[240px] overflow-y-auto">
              {applicableMembers.length === 0 ? (
                <div className="py-6 text-center text-sm text-tertiary">
                  {t('no_members_available')}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {applicableMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedMemberIds.has(m.id)}
                        onCheckedChange={() => toggleMember(m.id)}
                      />
                      <span className="text-sm text-foreground flex-1">
                        {m.name || m.email}
                      </span>
                      <span className="text-xs text-tertiary">ID: {m.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {selectedMemberIds.size > 0 && (
              <p className="text-xs text-tertiary">
                {t('selected_count', { count: selectedMemberIds.size })}
              </p>
            )}
            {failedCount > 0 && (
              <div
                className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
                data-testid="members__apply-template-failed-summary"
              >
                <p className="font-medium">{t('apply_failed_members_title')}</p>
                {failedMemberNames.length > 0 ? (
                  <p>{failedMemberNames.join(', ')}</p>
                ) : (
                  <p>{t('apply_failed_members_count', { count: failedCount })}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          {failedCount > 0 && failedMemberIds.length > 0 && (
            <Button variant="outline" onClick={handleRetryFailed} disabled={submitting}>
              {t('retry_failed_members')}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={selectedMemberIds.size === 0 || applicableMembers.length === 0 || submitting}
          >
            {submitting ? t('applying') : t('apply_to_members')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
