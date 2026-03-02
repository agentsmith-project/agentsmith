/**
 * Runtime Console Route
 *
 * Unified operations console combining runtime observability, alerts, control, and reports.
 * Part of navigation restructure WP-02.
 *
 * Route: /workspaces/:workspace/projects/:project/runtime-console
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { RuntimeConsolePage } from '@/components/runtime/RuntimeConsolePage';

interface RuntimeConsoleRouteProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function RuntimeConsoleRoute({ params }: RuntimeConsoleRouteProps) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);

  // Check permissions - users need at least one of these to access the console
  const canViewUsage = useHasPermission('project:usage:view');
  const canViewAlerts = useHasPermission('project:alert:view');
  const canManageSettings = useHasPermission('project:settings:manage');
  const canAccessConsole = canViewUsage || canViewAlerts || canManageSettings;

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
      locale: p.locale,
    }));
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

  if (!canAccessConsole) {
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
      <RuntimeConsolePage
        workspaceId={resolvedParams.workspace}
        projectId={resolvedParams.project}
        locale={resolvedParams.locale}
      />
    </PageState>
  );
}
