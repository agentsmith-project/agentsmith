'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { PermissionTemplatesTab } from './PermissionTemplatesTab';

export interface TemplatesTabProps {
  workspaceId: string;
  projectId: string;
}

export function TemplatesTab({ workspaceId, projectId }: TemplatesTabProps) {
  const t = useTranslations('members.templates');
  return (
    <section className="w-full min-w-0">
      <h3 className="text-sm font-medium text-foreground">{t('permission_templates')}</h3>
      <div className="mt-4 overflow-x-auto">
        <PermissionTemplatesTab workspaceId={workspaceId} projectId={projectId} />
      </div>
    </section>
  );
}
