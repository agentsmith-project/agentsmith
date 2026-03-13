'use client';

import { Button } from '@/components/ui/button';
import {
  getRuleDefinitionsForResource,
} from '@/lib/constants/resource-policy';
import type { ResourceRow } from '@/components/resource-policy/ResourcePolicyTable';

import type { EditableSubject, SubjectOption } from '../resource-policy-page-types';

interface ResourcePolicySubjectEditorProps {
  canUpdatePolicy: boolean;
  duplicateSubjectRowIds: Set<string>;
  groupOptions: SubjectOption[];
  hasStaleSubjects: boolean;
  selectedResourceType: ResourceRow['type'];
  staleSubjectRowIds: string[];
  subjects: EditableSubject[];
  tResource: (key: string) => string;
  userOptions: SubjectOption[];
  onAddSubject: () => void;
  onRemoveStaleSubjects: () => void;
  onRemoveSubject: (rowId: string) => void;
  onUpdateSubject: (rowId: string, patch: Partial<EditableSubject>) => void;
}

export function ResourcePolicySubjectEditor({
  canUpdatePolicy,
  duplicateSubjectRowIds,
  groupOptions,
  hasStaleSubjects,
  selectedResourceType,
  staleSubjectRowIds,
  subjects,
  tResource,
  userOptions,
  onAddSubject,
  onRemoveStaleSubjects,
  onRemoveSubject,
  onUpdateSubject,
}: ResourcePolicySubjectEditorProps) {
  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-tertiary">{tResource('subjects.title')}</p>
        <div className="flex items-center gap-2">
          {hasStaleSubjects ? (
            <Button
              type="button"
              onClick={onRemoveStaleSubjects}
              disabled={!canUpdatePolicy}
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              data-testid="resource-policy__remove-stale"
            >
              {tResource('subjects.remove_stale')}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={onAddSubject}
            disabled={!canUpdatePolicy}
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            data-testid="resource-policy__add-subject"
          >
            {tResource('subjects.add')}
          </Button>
        </div>
      </div>
      {subjects.length === 0 ? (
        <p className="text-xs text-tertiary">{tResource('subjects.empty')}</p>
      ) : (
        <div className="space-y-2" data-testid="resource-policy__subjects">
          {subjects.map((subject) => (
            <div
              key={subject.rowId}
              className={`rounded-sm border bg-surface p-3 space-y-2 ${
                duplicateSubjectRowIds.has(subject.rowId) ? 'border-error/60' : 'border-subtle'
              } ${staleSubjectRowIds.includes(subject.rowId) ? 'border-warning/50' : ''}`}
              data-testid={`resource-policy__subject--${subject.rowId}`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="grid gap-2 md:grid-cols-[120px_1fr_auto] flex-1 min-w-0">
                  <select
                    value={subject.subject_type}
                    onChange={(event) =>
                      onUpdateSubject(subject.rowId, {
                        subject_type: event.target.value as 'group' | 'user',
                        subject_id: '',
                      })
                    }
                    disabled={!canUpdatePolicy}
                    className="h-9 rounded-sm border border-subtle bg-surface-high px-2 text-sm text-foreground"
                    data-testid="resource-policy__subject-type"
                  >
                    <option value="user">{tResource('subjects.user')}</option>
                    <option value="group">{tResource('subjects.group')}</option>
                  </select>
                  <select
                    value={subject.subject_id}
                    onChange={(event) => onUpdateSubject(subject.rowId, { subject_id: event.target.value })}
                    disabled={!canUpdatePolicy}
                    className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                    data-testid="resource-policy__subject-id-select"
                  >
                    <option value="">{tResource('subjects.select_subject')}</option>
                    {(subject.subject_type === 'user' ? userOptions : groupOptions).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    {subject.subject_id &&
                    !(subject.subject_type === 'user' ? userOptions : groupOptions).some(
                      (option) => option.id === subject.subject_id,
                    ) ? (
                      <option value={subject.subject_id}>{subject.subject_id}</option>
                    ) : null}
                  </select>
                  <Button
                    type="button"
                    onClick={() => onRemoveSubject(subject.rowId)}
                    disabled={!canUpdatePolicy}
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs"
                  >
                    {tResource('subjects.remove')}
                  </Button>
                </div>
                {staleSubjectRowIds.includes(subject.rowId) ? (
                  <span
                    className="shrink-0 text-xs text-warning border border-warning/50 rounded px-2 py-0.5"
                    data-testid={`resource-policy__subject-stale--${subject.rowId}`}
                  >
                    {tResource('subjects.stale')}
                  </span>
                ) : null}
              </div>
              {duplicateSubjectRowIds.has(subject.rowId) ? (
                <p className="text-xs text-error" data-testid={`resource-policy__subject-duplicate--${subject.rowId}`}>
                  {tResource('subjects.duplicate')}
                </p>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                {getRuleDefinitionsForResource(selectedResourceType).map((rule) => (
                  <input
                    key={rule.key}
                    type="number"
                    min={1}
                    value={subject.draftRules[rule.key] ?? ''}
                    onChange={(event) =>
                      onUpdateSubject(subject.rowId, {
                        draftRules: {
                          ...subject.draftRules,
                          [rule.key]: event.target.value,
                        },
                      })
                    }
                    disabled={!canUpdatePolicy}
                    placeholder={tResource(rule.subjectPlaceholderKey)}
                    className="h-9 rounded-sm border border-subtle bg-surface-high px-3 text-sm text-foreground"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
