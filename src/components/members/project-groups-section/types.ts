import type { ProjectGroup } from '@/lib/api/endpoints/members';

export type PreviewDiff = {
  memberId: string;
  memberName: string;
  addCount: number;
  removeCount: number;
};

export type ApplyResultState = {
  groupId: string;
  appliedCount: number;
  failedMemberIds: string[];
  failedDetails: Array<{ memberId: string; message?: string }>;
} | null;

export type GroupTemplateOption = {
  id: string;
  name: string;
  permissions: string[];
  is_default?: boolean;
};

export type GroupMemberLike = {
  id: string;
  name?: string | null;
  email: string;
  permissions?: string[];
};

export type ProjectGroupLike = ProjectGroup;
