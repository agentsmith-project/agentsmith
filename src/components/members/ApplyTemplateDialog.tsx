'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
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
  onApply: (memberIds: string[], permissions: string[], template?: 'admin' | 'developer' | 'user' | null) => Promise<void>;
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

  const applicableMembers = React.useMemo(() => {
    return members.filter((m) => m.status === 'active' && m.role !== 'owner');
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
    const templateId: 'admin' | 'developer' | 'user' | null = DEFAULT_TEMPLATE_IDS.includes(
      template.id
    )
      ? (template.id as 'admin' | 'developer' | 'user')
      : null;
    setSubmitting(true);
    try {
      await onApply(Array.from(selectedMemberIds), template.permissions, templateId);
      setSelectedMemberIds(new Set());
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [selectedMemberIds, template.id, template.permissions, onApply, onOpenChange]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) setSelectedMemberIds(new Set());
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('apply_to_members')}</DialogTitle>
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
                      <span className="text-xs text-tertiary">({m.role})</span>
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
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
