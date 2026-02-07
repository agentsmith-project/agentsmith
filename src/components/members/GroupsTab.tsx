'use client';

import { ProjectGroupsSection } from './ProjectGroupsSection';

export interface GroupsTabProps {
  workspaceId: string;
  projectId: string;
}

export function GroupsTab({ workspaceId, projectId }: GroupsTabProps) {
  return (
    <div className="flex-1 min-h-0 overflow-auto overflow-x-auto">
      <ProjectGroupsSection workspaceId={workspaceId} projectId={projectId} />
    </div>
  );
}
