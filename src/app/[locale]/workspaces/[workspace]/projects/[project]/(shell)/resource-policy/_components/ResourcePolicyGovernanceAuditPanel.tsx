'use client';

interface ResourcePolicyGovernanceAuditPanelProps {
  policyAuditEvents: Array<{
    id: string;
    timestamp: string;
    actor_id: string;
    action: string;
    resource_type?: string | null;
    resource_id?: string | null;
  }>;
  tResource: (key: string) => string;
}

export function ResourcePolicyGovernanceAuditPanel({
  policyAuditEvents,
  tResource,
}: ResourcePolicyGovernanceAuditPanelProps) {
  return (
    <div className="rounded-sm border border-subtle bg-surface p-3 space-y-2" data-testid="resource-policy__governance-audit">
      <p className="text-xs font-medium text-foreground">{tResource('governance_audit.title')}</p>
      {policyAuditEvents.length === 0 ? (
        <p className="text-xs text-tertiary">{tResource('governance_audit.empty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {policyAuditEvents.map((event) => (
            <li
              key={event.id}
              className="text-xs text-tertiary flex flex-wrap gap-x-2 gap-y-0.5"
              data-testid="resource-policy__audit-event"
            >
              <span>{new Date(event.timestamp).toLocaleString()}</span>
              <span className="text-primary">{tResource('governance_audit.actor')}: {event.actor_id}</span>
              <span className="text-primary">{tResource('governance_audit.action')}: {event.action}</span>
              {event.resource_type != null || event.resource_id != null ? (
                <span className="text-primary">
                  {tResource('governance_audit.resource')}: {[event.resource_type, event.resource_id].filter(Boolean).join(' / ')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
