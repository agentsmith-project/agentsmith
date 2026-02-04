import { useTranslations } from 'next-intl';
import { useUserdataSummary, useUserdataEndUsers } from '@/lib/hooks/use-userdata';

export interface UserDataPageProps {
  workspaceId: string;
  projectId: string;
}

export function UserDataPage({ workspaceId, projectId }: UserDataPageProps) {
  const t = useTranslations('userdata');
  const { data: summary } = useUserdataSummary(workspaceId, projectId);
  const { data: endUsers } = useUserdataEndUsers(workspaceId, projectId);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-tertiary mt-1">{t('subtitle')}</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">{t('summary_title')}</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-tertiary">{t('summary_storage')}</p>
            <p className="text-foreground">{summary?.total_bytes ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-tertiary">{t('summary_docdb')}</p>
            <p className="text-foreground">{summary?.docdb_collections ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-tertiary">{t('summary_vectordb')}</p>
            <p className="text-foreground">{summary?.vectordb_indexes ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-6">
        <h2 className="text-sm font-medium text-foreground mb-4">{t('end_users_title')}</h2>
        <div className="space-y-2 text-sm">
          {(endUsers ?? []).length === 0 ? (
            <p className="text-tertiary">{t('end_users_empty')}</p>
          ) : (
            endUsers?.map((u) => (
              <div key={u.id} className="flex items-center justify-between border border-subtle rounded-md px-3 py-2">
                <span className="text-foreground">{u.id}</span>
                <span className="text-tertiary">{u.storage_bytes}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
