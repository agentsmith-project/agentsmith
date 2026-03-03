/**
 * TDD Test Suite: Permission Decision Explain
 *
 * Epic A1: Permission Decision Chain Unification
 * Acceptance Criteria 1: Any member permission decision can return explain (can be used for UI display)
 *
 * RED PHASE: Write failing tests first
 */

import { describe, it, expect } from 'vitest';
import {
  explainPermissionDecision,
  type PermissionDecision,
  type PermissionExplain,
} from '../permission-explain';

describe('explainPermissionDecision', () => {
  // Test Case 1: Template-based permission (owner role)
  it('should explain template permission granted from owner role', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-1',
      permission: 'project:settings:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: true,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.granted).toBe(true);
    expect(explain.source.type).toBe('template');
    expect(explain.source.template_id).toBe('owner');
    expect(explain.source.template_name).toBe('Owner');
    expect(explain.source.description).toContain('template');
  });

  // Test Case 2: Custom permission (explicitly granted)
  it('should explain custom permission granted directly', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-2',
      permission: 'project:endpoint:use',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: true,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.granted).toBe(true);
    expect(explain.source.type).toBe('custom');
    expect(explain.source.custom_permissions).toContain('project:endpoint:use');
    expect(explain.source.description).toContain('custom');
  });

  // Test Case 3: Group-based permission
  it('should explain permission granted from group membership', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-3',
      permission: 'project:endpoint:use',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: true,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.granted).toBe(true);
    expect(explain.source.type).toBe('group');
    expect(explain.source.group_id).toBeDefined();
    expect(explain.source.group_name).toBeDefined();
    expect(explain.source.description).toContain('group');
  });

  // Test Case 4: Permission denied with reason
  it('should explain why permission was denied', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-4',
      permission: 'project:settings:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: false,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.granted).toBe(false);
    expect(explain.denial_reason).toBeDefined();
    expect(explain.denial_reason).not.toBe('');
  });

  // Test Case 5: Multiple sources (union of template + custom + group)
  it('should show all contributing sources when multiple apply', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-5',
      permission: 'project:endpoint:use',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: true,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.granted).toBe(true);
    if (explain.all_sources) {
      expect(explain.all_sources.length).toBeGreaterThan(1);
      expect(explain.all_sources.some((s) => s.type === 'template')).toBe(true);
      expect(explain.all_sources.some((s) => s.type === 'custom')).toBe(true);
    }
  });

  // Test Case 6: UI-friendly explanation text
  it('should provide UI-friendly explanation in English and Chinese', async () => {
    const decision: PermissionDecision = {
      member_id: 'user-1',
      permission: 'project:settings:manage',
      resource_context: {
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      },
      granted: true,
    };

    const explain: PermissionExplain = await explainPermissionDecision(decision);

    expect(explain.ui_text.en).toBeDefined();
    expect(explain.ui_text.zh).toBeDefined();
    expect(explain.ui_text.en).not.toBe('');
    expect(explain.ui_text.zh).not.toBe('');
  });
});
