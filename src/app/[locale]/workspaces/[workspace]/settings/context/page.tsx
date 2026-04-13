'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { ContextManager } from '@/components/context/ContextManager';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

export default function WorkspaceContextPage() {
  const params = useParams();
  const t = useTranslations('context_store');
  const tErrors = useTranslations('errors');
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const canManage = useHasWorkspacePermission('workspace:governance:update');

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canManage) {
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
      <PageLayout
        header={(
          <PageHeader
            title={t('workspace_title')}
            subtitle={t('workspace_subtitle')}
            variant="compact"
          />
        )}
      >
        <div className="mb-4 max-w-3xl text-sm leading-6 text-tertiary" data-testid="context-store__scope-note">{t('workspace_scope_note')}</div>
        <ContextManager scope="workspace" workspaceId={workspaceId} />
      </PageLayout>
    </PageState>
  );
}
