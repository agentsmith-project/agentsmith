'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionTemplatesTab } from './PermissionTemplatesTab';
import { QuotaTemplatesSection } from './QuotaTemplatesSection';
import { useProject } from '@/lib/hooks/use-projects';

export interface TemplatesTabProps {
  workspaceId: string;
  projectId: string;
}

export function TemplatesTab({ workspaceId, projectId }: TemplatesTabProps) {
  const t = useTranslations('members.templates');
  const { data: project } = useProject(workspaceId, projectId);
  const projectGovernance = project?.governance_json as Record<string, unknown> | undefined;

  return (
    <Tabs defaultValue="permission" className="w-full">
      <TabsList>
        <TabsTrigger value="permission">{t('permission_templates')}</TabsTrigger>
        <TabsTrigger value="quota">{t('quota_templates')}</TabsTrigger>
      </TabsList>

      <TabsContent value="permission" className="mt-4 min-w-0">
        <div className="overflow-x-auto">
          <PermissionTemplatesTab workspaceId={workspaceId} projectId={projectId} />
        </div>
      </TabsContent>

      <TabsContent value="quota" className="mt-4 min-w-0">
        <div className="overflow-x-auto">
        <QuotaTemplatesSection
          workspaceId={workspaceId}
          projectId={projectId}
          projectGovernance={projectGovernance}
        />
        </div>
      </TabsContent>
    </Tabs>
  );
}
