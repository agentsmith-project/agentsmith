/**
 * Userdata Page
 *
 * Manage project-scoped user data.
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { UserDataPage } from '@/components/userdata/UserDataPage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface UserdataPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UserdataPage({ params }: UserdataPageProps) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
  } | null>(null);
  const canUserdataStorageRead = useHasPermission('userdata:storage:read');
  const canUserdataDocdbRead = useHasPermission('userdata:docdb:read');
  const canUserdataVectordbSearch = useHasPermission('userdata:vectordb:search');
  const canReadUserdata =
    canUserdataStorageRead || canUserdataDocdbRead || canUserdataVectordbSearch;

  useEffect(() => {
    params.then((p) => {
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
      });
    });
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

  if (!canReadUserdata) {
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
      <UserDataPage workspaceId={resolvedParams.workspace} projectId={resolvedParams.project} />
    </PageState>
  );
}
