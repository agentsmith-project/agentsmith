'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { FilesPage as FilesPageComponent } from '@/components/files/FilesPage';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface FilesPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function FilesPage({ params }: FilesPageProps) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
  } | null>(null);
  const canUseFiles = useHasPermission('project:source:use');

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
      }),
    );
  }, [params]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canUseFiles) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <FilesPageComponent
        workspaceId={resolvedParams.workspace}
        projectId={resolvedParams.project}
      />
    </PageState>
  );
}
