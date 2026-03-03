# Alert Center Authorization Design

## Overview

This document provides authorization design guidance for Epic C2 (Alert Center Basic Version) integration with the governance system built in Epic A.

## Permission Model

### Alert Permissions

Following the Epic A permission pattern, alert management requires these permissions:

```typescript
// Add to src/lib/constants/permissions.ts
ALERT: [
  'project:endpoint:use',        // View alert center and notifications
  'project:settings:manage',     // Create/edit/delete alert rules
  'project:endpoint:use',     // Receive alert notifications
] as const,
```

### Permission Grouping

**For Permission Templates (GROUP_TEMPLATES):**

| Role | Alert Permissions |
|------|-------------------|
| owner | All alert permissions |
| admin | All alert permissions |
| developer | project:endpoint:use, project:endpoint:use |
| user | project:endpoint:use |

### High-Risk Alert Operations

The following operations should be flagged as high-risk:

1. **Creating alert rules** - Could be used for spam/abuse
2. **Modifying threshold-based rules** - Could disable critical alerts
3. **Deleting alert rules** - Could disable monitoring

## Authorization Hook Usage

### Viewing Alert Center

```typescript
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export function AlertCenterPage({ workspaceId, projectId }: AlertCenterPageProps) {
  const canView = useHasPermission('project:endpoint:use');

  if (!canView) {
    return <PageState type="permission-denied" />;
  }

  return (
    // Alert center content
  );
}
```

### Managing Alert Rules

```typescript
export function AlertRulesList({ rules, onEdit, onDelete, onToggle }: AlertRulesListProps) {
  const canManage = useHasPermission('project:settings:manage');

  return (
    <div>
      {rules.map(rule => (
        <AlertRuleCard
          key={rule.id}
          rule={rule}
          onEdit={canManage ? onEdit : undefined}
          onDelete={canManage ? onDelete : undefined}
          onToggle={canManage ? onToggle : undefined}
        />
      ))}
    </div>
  );
}
```

### Create/Edit Rule Dialog

```typescript
export function AlertRuleFormDialog({ rule, onSave, onCancel }: Props) {
  const canManage = useHasPermission('project:settings:manage');

  // Redirect or disable if no permission
  if (!canManage) {
    return <PermissionDenied />;
  }

  return (
    // Form content
  );
}
```

## Resource Policy Integration

Alert rules should follow the resource policy pattern from Epic A2:

### Alert Resource Type

```typescript
// Add to src/lib/api/types/index.ts
export type PolicyResourceType =
  | 'endpoint'
  | 'source_library'
  | 'agent'
  | 'alert';  // NEW

export const RESOURCE_POLICY_RULE_MATRIX: Record<
  PolicyResourceType,
  { rate: PolicyRuleKey[]; quota: PolicyRuleKey[] }
> = {
  // ... existing types
  alert: {
    rate: ['alert.notifications_per_minute'],
    quota: ['alert.max_rules_per_project'],
  },
};
```

## Audit Events (Epic B2 Integration)

Alert actions should create standardized audit events:

```typescript
// Audit events for alert operations
const alertAuditEvents = [
  'alert.rule.created',
  'alert.rule.updated',
  'alert.rule.deleted',
  'alert.rule.enabled',
  'alert.rule.disabled',
  'alert.triggered',
];
```

## Implementation Checklist

- [ ] Add alert permissions to `src/lib/constants/permissions.ts`
- [ ] Add alert to `HIGH_RISK_PERMISSIONS` if applicable
- [ ] Update permission templates with alert permissions
- [ ] Implement `useHasPermission('project:endpoint:use')` in AlertCenterPage
- [ ] Implement `useHasPermission('project:settings:manage')` in rule management
- [ ] Add alert resource type to policy system
- [ ] Create audit events for alert operations
- [ ] Add tests for authorization behavior
- [ ] Add tests for permission denial scenarios

## Testing Strategy

### Unit Tests

```typescript
describe('AlertCenterPage', () => {
  it('should show permission denied when user lacks alert:view', () => {
    // Mock useHasPermission to return false
    // Render page
    // Expect permission denied state
  });

  it('should show alert center when user has alert:view', () => {
    // Mock useHasPermission to return true
    // Render page
    // Expect alert center content
  });
});
```

### Integration Tests

```typescript
describe('Alert Authorization Integration', () => {
  it('should prevent rule creation without alert:manage permission', async () => {
    // Attempt to create rule without permission
    // Expect 403 Forbidden
    // Verify audit event created
  });
});
```

## Related Files

- `src/lib/constants/permissions.ts` - Add alert permissions
- `src/lib/hooks/use-permissions.ts` - Use existing hooks
- `src/lib/constants/resource-policy.ts` - Add alert resource type
- `src/components/alerts/*` - Implement authorization checks
