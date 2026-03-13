import type { EditableSubjectDraft } from '@/lib/utils/resource-policy-subjects';
import type { PolicyRule, PolicyRuleKey } from '@/lib/api/types';

export type EditableSubject = EditableSubjectDraft & {
  rowId: string;
  subject_type: 'group' | 'user';
  subject_id: string;
  draftRules: Partial<Record<PolicyRuleKey, string>>;
  existingRateRules: PolicyRule[];
  existingSpendingRules: PolicyRule[];
};

export interface SubjectOption {
  id: string;
  label: string;
}
