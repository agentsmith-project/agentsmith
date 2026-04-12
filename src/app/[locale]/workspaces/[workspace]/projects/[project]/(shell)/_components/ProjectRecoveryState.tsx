'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface ProjectRecoveryStateProps {
  title: string;
  description: string;
  locale: string;
  workspaceId?: string | null;
}

export function ProjectRecoveryState({ title, description, locale, workspaceId }: ProjectRecoveryStateProps) {
  const tErrors = useTranslations('errors');
  const hasWorkspace = typeof workspaceId === 'string' && workspaceId.length > 0;
  const recoveryHref = hasWorkspace ? `/${locale}/workspaces/${workspaceId}/projects` : `/${locale}/workspaces`;
  const recoveryLabel = hasWorkspace ? tErrors('back_to_project_list') : tErrors('back_to_workspaces');

  return (
    <div className="max-w-md text-center space-y-4">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-tertiary">{description}</p>
      </div>
      <div className="flex justify-center">
        <Button asChild variant="action" size="sm" className="gap-2">
          <Link href={recoveryHref} data-testid="project-recovery__action">
            {recoveryLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
