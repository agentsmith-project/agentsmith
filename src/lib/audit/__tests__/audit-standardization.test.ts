/**
 * Tests for Audit Field Standardization (Epic B2)
 *
 * Tests the new standardized audit structure:
 * - actor: { type, id, name? }
 * - target: { type, id, workspace_id, project_id? }
 * - action: string
 * - at: ISO timestamp
 * - request_id: string
 * - diff: object (optional)
 */

import { describe, it, expect } from 'vitest';
import {
  StandardizedAuditEvent,
  standardizeAuditEvent,
  exportAuditToCSV,
  exportAuditToJSON,
  parseAuditDiff,
} from '../audit-standardization';

describe('Audit Field Standardization', () => {
  describe('StandardizedAuditEvent Type', () => {
    it('has required fields: actor, target, action, at, request_id', () => {
      const event: StandardizedAuditEvent = {
        actor: { type: 'user', id: 'user-123', name: 'John Doe' },
        target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
        action: 'member.add',
        at: '2026-02-27T10:00:00Z',
        request_id: 'req-abc123',
      };

      expect(event.actor).toBeDefined();
      expect(event.actor.type).toBe('user');
      expect(event.actor.id).toBe('user-123');
      expect(event.target).toBeDefined();
      expect(event.target.type).toBe('member');
      expect(event.action).toBe('member.add');
      expect(event.at).toBe('2026-02-27T10:00:00Z');
      expect(event.request_id).toBe('req-abc123');
    });

    it('allows optional diff field for changes', () => {
      const event: StandardizedAuditEvent = {
        actor: { type: 'user', id: 'user-123' },
        target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
        action: 'member.update',
        at: '2026-02-27T10:00:00Z',
        request_id: 'req-abc123',
        diff: {
          before: { role: 'user' },
          after: { role: 'developer' },
        },
      };

      expect(event.diff).toBeDefined();
      expect(event.diff?.before).toEqual({ role: 'user' });
      expect(event.diff?.after).toEqual({ role: 'developer' });
    });

    it('allows optional project_id in target', () => {
      const event: StandardizedAuditEvent = {
        actor: { type: 'user', id: 'user-123' },
        target: {
          type: 'agent_runner',
          id: 'runner-789',
          workspace_id: 'ws-1',
          project_id: 'proj-1',
        },
        action: 'agent_runner.create',
        at: '2026-02-27T10:00:00Z',
        request_id: 'req-abc123',
      };

      expect(event.target.project_id).toBe('proj-1');
    });
  });

  describe('standardizeAuditEvent adapter', () => {
    it('transforms AuditEvent to StandardizedAuditEvent', () => {
      const auditEvent = {
        id: 'audit-001',
        timestamp: '2026-02-27T10:00:00Z',
        workspace_id: 'ws-1',
        project_id: 'proj-1',
        actor_type: 'user' as const,
        actor_id: 'user-123',
        action: 'member.add',
        resource_type: 'member',
        resource_id: 'member-456',
        end_user_id: 'user-123',
        result: 'ok' as const,
        request_id: 'req-abc123',
        metadata_json: { invited_user: 'user-456', role: 'developer' },
      };

      const standardized = standardizeAuditEvent(auditEvent);

      expect(standardized.actor).toEqual({ type: 'user', id: 'user-123' });
      expect(standardized.target).toEqual({
        type: 'member',
        id: 'member-456',
        workspace_id: 'ws-1',
        project_id: 'proj-1',
      });
      expect(standardized.action).toBe('member.add');
      expect(standardized.at).toBe('2026-02-27T10:00:00Z');
      expect(standardized.request_id).toBe('req-abc123');
    });

    it('includes metadata_json as diff when action implies change', () => {
      const auditEvent = {
        id: 'audit-002',
        timestamp: '2026-02-27T10:00:00Z',
        workspace_id: 'ws-1',
        project_id: 'proj-1',
        actor_type: 'user' as const,
        actor_id: 'user-123',
        action: 'member.update',
        resource_type: 'member',
        resource_id: 'member-456',
        end_user_id: 'user-123',
        result: 'ok' as const,
        request_id: 'req-abc123',
        metadata_json: { previous_role: 'user', new_role: 'developer' },
      };

      const standardized = standardizeAuditEvent(auditEvent);

      expect(standardized.diff).toBeDefined();
      expect(standardized.diff).toEqual({
        before: { previous_role: 'user' },
        after: { new_role: 'developer' },
      });
    });

    it('handles runner actor type', () => {
      const auditEvent = {
        id: 'audit-003',
        timestamp: '2026-02-27T10:00:00Z',
        workspace_id: 'ws-1',
        project_id: 'proj-1',
        actor_type: 'runner' as const,
        actor_id: 'runner-789',
        action: 'endpoint.invoke',
        resource_type: 'endpoint',
        resource_id: 'endpoint-001',
        end_user_id: 'user-123',
        result: 'ok' as const,
        request_id: 'req-abc123',
        metadata_json: { model: 'gpt-4o' },
      };

      const standardized = standardizeAuditEvent(auditEvent);

      expect(standardized.actor.type).toBe('runner');
      expect(standardized.actor.id).toBe('runner-789');
    });
  });

  describe('exportAuditToCSV', () => {
    it('exports single audit event to CSV format', () => {
      const events: StandardizedAuditEvent[] = [
        {
          actor: { type: 'user', id: 'user-123', name: 'John Doe' },
          target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
          action: 'member.add',
          at: '2026-02-27T10:00:00Z',
          request_id: 'req-abc123',
        },
      ];

      const csv = exportAuditToCSV(events);

      expect(csv).toContain('actor_type,actor_id,actor_name');
      expect(csv).toContain('target_type,target_id,workspace_id,project_id');
      expect(csv).toContain('action,at,request_id');
      expect(csv).toContain('user,user-123,John Doe');
      expect(csv).toContain('member,member-456,ws-1');
    });

    it('exports multiple audit events to CSV format', () => {
      const events: StandardizedAuditEvent[] = [
        {
          actor: { type: 'user', id: 'user-123' },
          target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
          action: 'member.add',
          at: '2026-02-27T10:00:00Z',
          request_id: 'req-001',
        },
        {
          actor: { type: 'user', id: 'user-789' },
          target: { type: 'agent_runner', id: 'runner-001', workspace_id: 'ws-1', project_id: 'proj-1' },
          action: 'agent_runner.create',
          at: '2026-02-27T11:00:00Z',
          request_id: 'req-002',
        },
      ];

      const csv = exportAuditToCSV(events);

      const lines = csv.split('\n').filter((line) => line.trim().length > 0);
      expect(lines.length).toBe(3); // Header + 2 data rows
    });

    it('includes diff as JSON string in CSV when present', () => {
      const events: StandardizedAuditEvent[] = [
        {
          actor: { type: 'user', id: 'user-123' },
          target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
          action: 'member.update',
          at: '2026-02-27T10:00:00Z',
          request_id: 'req-abc123',
          diff: { before: { role: 'user' }, after: { role: 'admin' } },
        },
      ];

      const csv = exportAuditToCSV(events);

      expect(csv).toContain('diff');
      expect(csv).toContain('role');
    });
  });

  describe('exportAuditToJSON', () => {
    it('exports audit events to JSON format', () => {
      const events: StandardizedAuditEvent[] = [
        {
          actor: { type: 'user', id: 'user-123', name: 'John Doe' },
          target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
          action: 'member.add',
          at: '2026-02-27T10:00:00Z',
          request_id: 'req-abc123',
        },
      ];

      const json = exportAuditToJSON(events);
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        actor: { type: 'user', id: 'user-123', name: 'John Doe' },
        target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
        action: 'member.add',
        at: '2026-02-27T10:00:00Z',
        request_id: 'req-abc123',
      });
    });

    it('includes diff in JSON export when present', () => {
      const events: StandardizedAuditEvent[] = [
        {
          actor: { type: 'user', id: 'user-123' },
          target: { type: 'member', id: 'member-456', workspace_id: 'ws-1' },
          action: 'member.update',
          at: '2026-02-27T10:00:00Z',
          request_id: 'req-abc123',
          diff: { before: { role: 'user' }, after: { role: 'admin' } },
        },
      ];

      const json = exportAuditToJSON(events);
      const parsed = JSON.parse(json);

      expect(parsed[0].diff).toEqual({
        before: { role: 'user' },
        after: { role: 'admin' },
      });
    });
  });

  describe('parseAuditDiff', () => {
    it('parses metadata_json into before/after diff for update actions', () => {
      const metadata = {
        previous_role: 'user',
        new_role: 'developer',
        previous_limit: 1000,
        new_limit: 5000,
      };

      const diff = parseAuditDiff('member.update', metadata);

      expect(diff).toEqual({
        before: { previous_role: 'user', previous_limit: 1000 },
        after: { new_role: 'developer', new_limit: 5000 },
      });
    });

    it('returns null for non-update actions', () => {
      const metadata = { invited_user: 'user-456', role: 'developer' };

      const diff = parseAuditDiff('member.add', metadata);

      expect(diff).toBeNull();
    });

    it('handles actions without recognized diff patterns', () => {
      const metadata = { some_field: 'some_value' };

      const diff = parseAuditDiff('unknown.action', metadata);

      expect(diff).toBeNull();
    });
  });
});
