'use client';

import { Button } from '@/components/ui/button';

import type { ApplyResultState, PreviewDiff, ProjectGroupLike } from './types';

interface GroupListProps {
  applyPending: boolean;
  canManage: boolean;
  deletePending: boolean;
  groups: ProjectGroupLike[];
  lastApplyResult: ApplyResultState;
  memberNameMap: Map<string, string>;
  previewDiffs: PreviewDiff[];
  previewGroupId: string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  templateNameMap: Map<string, string>;
  onApply: (group: ProjectGroupLike) => void;
  onCopyFailed: (groupId: string) => void;
  onDelete: (group: ProjectGroupLike) => void;
  onEdit: (group: ProjectGroupLike) => void;
  onExportFailed: (groupId: string) => void;
  onPreviewToggle: (groupId: string) => void;
  onRetryFailed: (groupId: string, failedMemberIds: string[]) => void;
}

export function GroupList({
  applyPending,
  canManage,
  deletePending,
  groups,
  lastApplyResult,
  memberNameMap,
  previewDiffs,
  previewGroupId,
  t,
  templateNameMap,
  onApply,
  onCopyFailed,
  onDelete,
  onEdit,
  onExportFailed,
  onPreviewToggle,
  onRetryFailed,
}: GroupListProps) {
  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-subtle bg-white/[0.02] p-5 text-sm text-secondary">
          {t('group_empty')}
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.id}
            className="rounded-[22px] border border-subtle bg-surface-high/75 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
            data-testid={`members__group-row--${group.id}`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-primary">{group.name}</p>
                <p className="text-sm text-secondary">
                  {templateNameMap.get(group.permission_template_id) || group.permission_template_id}
                  {' · '}
                  {t('selected_count', { count: group.member_ids.length })}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                    {templateNameMap.get(group.permission_template_id) || group.permission_template_id}
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                    {t('selected_count', { count: group.member_ids.length })}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || applyPending}
                  onClick={() => onApply(group)}
                  data-testid={`members__group-apply-btn--${group.id}`}
                >
                  {t('apply_to_members')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onPreviewToggle(group.id)}
                  data-testid={`members__group-preview-btn--${group.id}`}
                >
                  {t('preview_changes')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage}
                  onClick={() => onEdit(group)}
                  data-testid={`members__group-edit-btn--${group.id}`}
                >
                  {t('edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || deletePending}
                  onClick={() => onDelete(group)}
                  data-testid={`members__group-delete-btn--${group.id}`}
                >
                  {t('delete')}
                </Button>
              </div>
            </div>
            {previewGroupId === group.id ? (
              <div className="mt-4 rounded-[18px] border border-subtle bg-surface p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-tertiary">
                  {t('group_preview_title')}
                </p>
                <div className="space-y-1">
                  {previewDiffs.length === 0 ? (
                    <p className="text-xs text-tertiary">{t('group_preview_empty')}</p>
                  ) : (
                    previewDiffs.map((diff) => (
                      <div
                        key={diff.memberId}
                        className="flex items-center justify-between text-xs"
                        data-testid={`members__group-preview-row--${group.id}--${diff.memberId}`}
                      >
                        <span className="text-primary">{diff.memberName}</span>
                        <span className="text-tertiary">
                          +{diff.addCount} / -{diff.removeCount}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            {lastApplyResult?.groupId === group.id ? (
              <div className="mt-3 rounded-[18px] border border-subtle bg-surface p-3 text-xs text-tertiary">
                <p data-testid={`members__group-apply-result--${group.id}`}>
                  {t('group_apply_result', {
                    applied: lastApplyResult.appliedCount,
                    failed: lastApplyResult.failedMemberIds.length,
                  })}
                </p>
                {lastApplyResult.failedDetails.length > 0 ? (
                  <div className="mt-2 space-y-1" data-testid={`members__group-apply-failed-list--${group.id}`}>
                    {lastApplyResult.failedDetails.map((item) => (
                      <p key={item.memberId} className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
                        {memberNameMap.get(item.memberId) ?? item.memberId}
                        {item.message ? ` (${item.message})` : ''}
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onRetryFailed(group.id, lastApplyResult.failedMemberIds)}
                        disabled={applyPending}
                        data-testid={`members__group-retry-failed-btn--${group.id}`}
                      >
                        {t('retry_failed_members')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onCopyFailed(group.id)}
                        data-testid={`members__group-copy-failed-btn--${group.id}`}
                      >
                        {t('copy_failed_members')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onExportFailed(group.id)}
                        data-testid={`members__group-export-failed-btn--${group.id}`}
                      >
                        {t('export_failed_members')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
