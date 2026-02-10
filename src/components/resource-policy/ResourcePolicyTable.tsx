'use client';

import { Bot, FolderOpen, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { ResourcePolicyStatusBadge, type ResourcePolicyStatus } from '@/components/resource-policy/ResourcePolicyStatusBadge';

export type ResourceRow = {
  id: string;
  type: 'endpoint' | 'source_library' | 'agent';
  name: string;
  subtitle?: string;
};

export function ResourcePolicyTable({
  groupedRows,
  selectedResource,
  onSelectResource,
  getRowPolicyState,
}: {
  groupedRows: {
    endpoint: ResourceRow[];
    agent: ResourceRow[];
    source_library: ResourceRow[];
  };
  selectedResource: ResourceRow | null;
  onSelectResource: (row: ResourceRow) => void;
  getRowPolicyState: (row: ResourceRow) => {
    isLoading: boolean;
    status: ResourcePolicyStatus;
    label: string;
    title: string;
  };
}) {
  const tResource = useTranslations('resource_policy');

  return (
    <div className="space-y-2" data-testid="resource-policy__table">
      {(['endpoint', 'agent', 'source_library'] as const).map((resourceType) => {
        const typeRows = groupedRows[resourceType];
        if (typeRows.length === 0) return null;
        return (
          <section
            key={resourceType}
            className="rounded-sm border border-subtle bg-surface p-2.5 space-y-2"
            data-testid={`resource-policy__group--${resourceType}`}
          >
            <div className="flex items-center justify-between px-1.5">
              <p className="text-[11px] uppercase tracking-wide font-medium text-primary">
                {tResource(`resource_type.${resourceType}`)}
              </p>
              <span className="text-[11px] text-tertiary">{typeRows.length}</span>
            </div>
            {typeRows.map((row) => {
              const isSelected = selectedResource?.id === row.id && selectedResource.type === row.type;
              const rowPolicyState = getRowPolicyState(row);
              return (
                <Button
                  key={`${row.type}:${row.id}`}
                  type="button"
                  onClick={() => onSelectResource(row)}
                  variant="secondary"
                  className={`w-full h-auto justify-between rounded-sm border p-2.5 text-left ${
                    isSelected
                      ? 'border-[rgb(var(--accent))] bg-surface-high'
                      : 'border-subtle bg-surface-high hover:bg-hover'
                  }`}
                  data-testid={`resource-policy__row--${row.type}--${row.id}`}
                >
                  <div className="flex items-center gap-2">
                    {row.type === 'endpoint' && <Server className="h-4 w-4 text-icon-default" />}
                    {row.type === 'source_library' && <FolderOpen className="h-4 w-4 text-icon-default" />}
                    {row.type === 'agent' && <Bot className="h-4 w-4 text-icon-default" />}
                    <div>
                      <p className="text-sm text-foreground">{row.name}</p>
                      {row.subtitle ? <p className="text-xs text-tertiary">{row.subtitle}</p> : null}
                    </div>
                  </div>
                  <ResourcePolicyStatusBadge
                    data-testid={`resource-policy__row-status--${row.type}--${row.id}`}
                    status={rowPolicyState.isLoading ? 'loading' : rowPolicyState.status}
                    label={rowPolicyState.label}
                    title={rowPolicyState.title}
                  />
                </Button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
