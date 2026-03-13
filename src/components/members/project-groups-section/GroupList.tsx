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
    <div className="space-y-2">
      {groups.length === 0 ? (
        <div className="rounded-md border border-dashed border-subtle p-4 text-xs text-tertiary">
          {t('group_empty')}
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.id}
            className="rounded-md border border-subtle bg-surface p-3"
            data-testid={`members__group-row--${group.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-primary">{group.name}</p>
                <p className="text-xs text-tertiary">
                  {templateNameMap.get(group.permission_template_id) || group.permission_template_id}
                  {' · '}
                  {t('selected_count', { count: group.member_ids.length })}
                </p>
              </div>
              <div className="flex items-center gap-2">
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
              <div className="mt-3 rounded-sm border border-subtle bg-surface-high p-3">
                <p className="mb-2 text-xs text-tertiary">{t('group_preview_title')}</p>
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
              <div className="mt-2 rounded-sm border border-subtle bg-surface-high p-2 text-xs text-tertiary">
                <p data-testid={`members__group-apply-result--${group.id}`}>
                  {t('group_apply_result', {
                    applied: lastApplyResult.appliedCount,
                    failed: lastApplyResult.failedMemberIds.length,
                  })}
                </p>
                {lastApplyResult.failedDetails.length > 0 ? (
                  <div className="mt-2 space-y-1" data-testid={`members__group-apply-failed-list--${group.id}`}>
                    {lastApplyResult.failedDetails.map((item) => (
                      <p key={item.memberId}>
                        {memberNameMap.get(item.memberId) ?? item.memberId}
                        {item.message ? ` (${item.message})` : ''}
                      </p>
                    ))}
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
                ) : null}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
