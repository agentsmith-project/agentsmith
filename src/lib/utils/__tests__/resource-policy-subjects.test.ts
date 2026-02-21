import { findDuplicateSubjects, findStaleSubjectRowIds, normalizeSubjectId } from '../resource-policy-subjects';

describe('normalizeSubjectId', () => {
  it('trims whitespace', () => {
    expect(normalizeSubjectId('  u1  ')).toBe('u1');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeSubjectId('')).toBe('');
  });
});

describe('findDuplicateSubjects', () => {
  it('returns empty when no duplicates', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'user' as const, subject_id: 'u1', draftRules: {}, existingRateRules: [], existingQuotaRules: [] },
      { rowId: 'r2', subject_type: 'user' as const, subject_id: 'u2', draftRules: {}, existingRateRules: [], existingQuotaRules: [] },
    ];
    expect(findDuplicateSubjects(subjects)).toHaveLength(0);
  });

  it('returns duplicate when same user appears twice', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'user' as const, subject_id: 'u1', draftRules: {}, existingRateRules: [], existingQuotaRules: [] },
      { rowId: 'r2', subject_type: 'user' as const, subject_id: 'u1', draftRules: {}, existingRateRules: [], existingQuotaRules: [] },
    ];
    const result = findDuplicateSubjects(subjects);
    expect(result).toHaveLength(1);
    expect(result[0].subject_type).toBe('user');
    expect(result[0].subject_id).toBe('u1');
    expect(result[0].rows).toContain('r1');
    expect(result[0].rows).toContain('r2');
  });
});

describe('findStaleSubjectRowIds', () => {
  it('returns empty when all subjects are current', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'user' as const, subject_id: 'u1' },
      { rowId: 'r2', subject_type: 'group' as const, subject_id: 'g1' },
    ];
    expect(findStaleSubjectRowIds(subjects, ['u1'], ['g1'])).toEqual([]);
  });

  it('returns rowId when user is not in memberIds', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'user' as const, subject_id: 'u_deleted' },
    ];
    expect(findStaleSubjectRowIds(subjects, ['u1'], [])).toEqual(['r1']);
  });

  it('returns rowId when group is not in groupIds', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'group' as const, subject_id: 'g_deleted' },
    ];
    expect(findStaleSubjectRowIds(subjects, [], ['g1'])).toEqual(['r1']);
  });

  it('ignores empty subject_id', () => {
    const subjects = [
      { rowId: 'r1', subject_type: 'user' as const, subject_id: '' },
    ];
    expect(findStaleSubjectRowIds(subjects, [], [])).toEqual([]);
  });
});
