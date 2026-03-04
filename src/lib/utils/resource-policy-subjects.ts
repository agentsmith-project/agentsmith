import type { PolicyRule, PolicyRuleKey } from '@/lib/api/types';

export type EditableSubjectDraft = {
  rowId: string;
  subject_type: 'group' | 'user';
  subject_id: string;
  draftRules: Partial<Record<PolicyRuleKey, string>>;
  existingRateRules: PolicyRule[];
  existingSpendingRules: PolicyRule[];
};

export type DuplicateSubjectConflict = {
  subject_type: 'group' | 'user';
  subject_id: string;
  rows: string[];
};

export function normalizeSubjectId(subjectId: string): string {
  return subjectId.trim();
}

function subjectKey(subjectType: 'group' | 'user', subjectId: string): string {
  return `${subjectType}:${normalizeSubjectId(subjectId)}`;
}

export function findDuplicateSubjects(subjects: EditableSubjectDraft[]): DuplicateSubjectConflict[] {
  const rowsBySubject = new Map<string, string[]>();

  for (const subject of subjects) {
    const normalizedSubjectId = normalizeSubjectId(subject.subject_id);
    if (!normalizedSubjectId) continue;
    const key = subjectKey(subject.subject_type, normalizedSubjectId);
    const currentRows = rowsBySubject.get(key) ?? [];
    currentRows.push(subject.rowId);
    rowsBySubject.set(key, currentRows);
  }

  const duplicates: DuplicateSubjectConflict[] = [];
  for (const [key, rows] of rowsBySubject.entries()) {
    if (rows.length <= 1) continue;
    const [subject_type, subject_id] = key.split(':') as ['group' | 'user', string];
    duplicates.push({ subject_type, subject_id, rows });
  }
  return duplicates;
}

/**
 * Returns rowIds of subjects that are stale: user no longer in project members,
 * or group no longer in project groups. Used to show stale indicator and one-click cleanup.
 */
export function findStaleSubjectRowIds(
  subjects: Array<{ rowId: string; subject_type: 'group' | 'user'; subject_id: string }>,
  memberIds: string[],
  groupIds: string[],
): string[] {
  const memberSet = new Set(memberIds);
  const groupSet = new Set(groupIds);
  const staleRowIds: string[] = [];
  for (const subject of subjects) {
    const id = normalizeSubjectId(subject.subject_id);
    if (!id) continue;
    if (subject.subject_type === 'user' && !memberSet.has(id)) {
      staleRowIds.push(subject.rowId);
    } else if (subject.subject_type === 'group' && !groupSet.has(id)) {
      staleRowIds.push(subject.rowId);
    }
  }
  return staleRowIds;
}
