import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GovernanceRunnerController } from '../governance-runner.js';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  apiFetch,
  apiFetchWithToken,
  startServer,
  startServerWithDeps,
} from './test-support.js';

describe('governance admin integration', () => {
  it('lists and reads internal governance report artifacts', async () => {
    const deps = createDefaultNodeApiDeps();
    const reportsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-reports-'));
    const runsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-runs-'));
    const escalationsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-incidents-'));
    deps.governanceReportsDir = reportsDir;
    deps.governanceRunsDir = runsDir;
    deps.governanceIncidentsDir = escalationsDir;
    writeFileSync(join(reportsDir, 'sample-governance.json'), JSON.stringify({
      metadata: {
        timestamp: '2026-02-28T20:35:10.000Z',
        git: {
          branch: 'main',
          commit_short: 'abc1234',
        },
      },
      summary: {
        status: 'pass',
        governance_policy: {
          decision: 'blocked',
          blockers: [
            {
              id: 'execution_failures_present',
              severity: 'blocker',
              source: 'execution',
              message: 'Execution has 1 failed checks.',
              overridable: true,
            },
          ],
          warnings: [
            {
              severity: 'warning',
              source: 'usage',
              overridable: true,
            },
          ],
          summary: {
            total_issues: 2,
            blocker_count: 1,
            warning_count: 1,
            overridable_count: 2,
          },
        },
        execution_review_evidence: {
          checks: {
            review_status: 'ready',
          },
        },
      },
    }), 'utf-8');
    writeFileSync(join(reportsDir, 'sample-governance.md'), '# Sample Governance\n\nPASS\n', 'utf-8');
    writeFileSync(join(runsDir, 'sample-governance.json'), JSON.stringify({
      id: 'sample-governance',
      report_name: 'sample-governance',
      artifact_name: 'sample-governance',
      trigger: 'manual',
      started_at: '2026-02-28T20:34:50.000Z',
      completed_at: '2026-02-28T20:35:10.000Z',
      duration_ms: 20000,
      status: 'pass',
      branch: 'main',
      commit_short: 'abc1234',
      governance_decision: 'ready',
      execution_review_status: 'ready',
      total_checks: 6,
      passed_checks: 6,
      failed_checks: 0,
      failed_step_names: [],
      failure_categories: [],
    }), 'utf-8');
    writeFileSync(join(escalationsDir, 'sample-governance.json'), JSON.stringify({
      id: 'sample-governance',
      report_name: 'sample-governance',
      run_id: 'sample-governance',
      created_at: '2026-02-28T20:35:10.000Z',
      event_type: 'gate_warning',
      severity: 'warning',
      status: 'open',
      title: 'Governance run completed with warning state',
      body: 'Latest governance run completed with 1 warning issues.',
      artifact_name: 'sample-governance',
      trigger: 'manual',
      governance_decision: 'warning',
      execution_review_status: 'ready',
      failure_categories: [],
    }), 'utf-8');

    const { baseUrl } = startServerWithDeps(deps);

    const listRes = await apiFetch(baseUrl, '/api/v1/internal/governance-reports?workspace_id=ws_default&project_id=proj_1');
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      items: Array<{
        name: string;
        status: string;
        markdown_available: boolean;
        policy_enforcement?: { decision?: string };
      }>;
    };
    expect(listPayload.items[0]).toEqual(expect.objectContaining({
      name: 'sample-governance',
      status: 'pass',
      markdown_available: true,
      policy_enforcement: expect.objectContaining({
        decision: 'blocked',
      }),
    }));

    const detailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-reports/sample-governance?workspace_id=ws_default&project_id=proj_1');
    expect(detailRes.status).toBe(200);
    const detailPayload = (await detailRes.json()) as {
      name: string;
      markdown?: string;
      report?: { summary?: { status?: string } };
      policy_enforcement?: { decision?: string };
    };
    expect(detailPayload.name).toBe('sample-governance');
    expect(detailPayload.markdown).toContain('# Sample Governance');
    expect(detailPayload.report?.summary?.status).toBe('pass');
    expect(detailPayload.policy_enforcement?.decision).toBe('blocked');

    const createOverrideRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'execution_failures_present',
        issue_source: 'execution',
        issue_message: 'Execution has 1 failed checks.',
        reason_category: 'governance_window',
        reason: 'Accepted during controlled governance window',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(createOverrideRes.status).toBe(201);
    const createdOverride = (await createOverrideRes.json()) as { id: string };
    const approveOverrideRes = await apiFetch(baseUrl, `/api/v1/internal/governance-policy-overrides/${createdOverride.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(approveOverrideRes.status).toBe(200);
    const ownerApproveOverrideRes = await apiFetchWithToken(baseUrl, `/api/v1/internal/governance-policy-overrides/${createdOverride.id}/decision`, 'owner-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(ownerApproveOverrideRes.status).toBe(200);

    const runListRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runs?workspace_id=ws_default&project_id=proj_1');
    expect(runListRes.status).toBe(200);
    const runListPayload = (await runListRes.json()) as {
      items: Array<{
        id: string;
        trigger: string;
        artifact_name: string;
        policy_enforcement?: { decision?: string };
      }>;
    };
    expect(runListPayload.items[0]).toEqual(expect.objectContaining({
      id: 'sample-governance',
      trigger: 'manual',
      artifact_name: 'sample-governance',
      policy_enforcement: expect.objectContaining({
        decision: 'releasable_with_override',
      }),
    }));

    const runDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runs/sample-governance?workspace_id=ws_default&project_id=proj_1');
    expect(runDetailRes.status).toBe(200);
    const runDetailPayload = (await runDetailRes.json()) as {
      id: string;
      duration_ms: number;
      status: string;
      policy_enforcement?: { decision?: string };
    };
    expect(runDetailPayload.id).toBe('sample-governance');
    expect(runDetailPayload.duration_ms).toBe(20000);
    expect(runDetailPayload.status).toBe('pass');
    expect(runDetailPayload.policy_enforcement?.decision).toBe('releasable_with_override');

    const escalationListRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents');
    expect(escalationListRes.status).toBe(200);
    const escalationListPayload = (await escalationListRes.json()) as { items: Array<{ id: string; event_type: string }> };
    expect(escalationListPayload.items[0]).toEqual(expect.objectContaining({
      id: 'sample-governance',
      event_type: 'gate_warning',
    }));

    const escalationDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance');
    expect(escalationDetailRes.status).toBe(200);
    const escalationDetailPayload = (await escalationDetailRes.json()) as { title: string };
    expect(escalationDetailPayload.title).toContain('warning');

    const acknowledgeRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(acknowledgeRes.status).toBe(200);
    const acknowledged = (await acknowledgeRes.json()) as { acknowledged_by_user_id?: string };
    expect(acknowledged.acknowledged_by_user_id).toBeTruthy();

    const assignRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignee_user_id: 'user_oncall',
        assignee_name: 'Oncall Engineer',
        due_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(assignRes.status).toBe(200);
    const assigned = (await assignRes.json()) as { assignee_user_id?: string; sla_status?: string };
    expect(assigned.assignee_user_id).toBe('user_oncall');
    expect(assigned.sla_status).toBe('due_soon');

    const reassignRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignee_user_id: 'user_governance',
        assignee_name: 'Release Owner',
      }),
    });
    expect(reassignRes.status).toBe(200);

    const historyDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance');
    expect(historyDetailRes.status).toBe(200);
    const historyDetail = (await historyDetailRes.json()) as {
      incident_history?: Array<{
        event_kind?: string;
        previous_assignee_user_id?: string;
        next_assignee_user_id?: string;
      }>;
    };
    const reassignment = historyDetail.incident_history?.find(
      (item) => item.next_assignee_user_id === 'user_governance',
    );
    expect(reassignment?.event_kind).toBe('escalation_assignment');
    expect(reassignment?.previous_assignee_user_id).toBe('user_oncall');
    expect(reassignment?.next_assignee_user_id).toBe('user_governance');

    const resolveRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/resolution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', reason: 'Mitigated by rerun', category: 'mitigated' }),
    });
    expect(resolveRes.status).toBe(200);
    const resolved = (await resolveRes.json()) as { status: string; resolution_reason?: string; resolution_category?: string; sla_status?: string };
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution_reason).toBe('Mitigated by rerun');
    expect(resolved.resolution_category).toBe('mitigated');
    expect(resolved.sla_status).toBe('resolved');

    const notificationsRes = await apiFetch(baseUrl, '/api/v1/me/notifications');
    expect(notificationsRes.status).toBe(200);
    const notificationsPayload = (await notificationsRes.json()) as { items: Array<{ id: string; title: string }> };
    expect(notificationsPayload.items.some((item) => item.id === 'governance_incident_sample-governance')).toBe(true);
  });

  it('creates and lists governance policy overrides', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'usage_warning',
        issue_source: 'usage',
        issue_message: 'usage_warning',
        reason_category: 'approved_exception',
        reason: 'Accepted exception for current governance review',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { issue_id: string; reason: string; effective_status?: string; incident_id?: string };
    expect(created.issue_id).toBe('usage_warning');
    expect(created.reason).toBe('Accepted exception for current governance review');
    expect(created.effective_status).toBe('pending');
    expect(created.incident_id).toBe('incident-sample-governance');

    const listRes = await apiFetch(
      baseUrl,
      '/api/v1/internal/governance-policy-overrides?workspace_id=ws_default&project_id=proj_1&report_name=sample-governance',
    );
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { items: Array<{ issue_id: string }> };
    expect(listPayload.items[0]?.issue_id).toBe('usage_warning');
  });

  it('creates, lists, updates, and deletes user external connections', async () => {
    const { baseUrl } = startServer();
    const createRes = await apiFetch(baseUrl, '/api/v1/me/external-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'custom',
        custom_domain: 'issues.internal.example',
        kind: 'secret_bundle',
        display_name: 'Issue Tracker Bundle',
        fields: [
          { key: 'base_url', value: 'https://issues.internal.example', secret: false },
          { key: 'token', value: 'secret-token', secret: true },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      fields: Array<{ key: string; masked_value?: string | null }>;
      display_name: string;
    };
    expect(created.display_name).toBe('Issue Tracker Bundle');
    expect(created.fields.find((field) => field.key === 'token')?.masked_value).not.toBe('secret-token');

    const listRes = await apiFetch(baseUrl, '/api/v1/me/external-connections');
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { items: Array<{ id: string; display_name: string }> };
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items.some((item) => item.display_name === 'Issue Tracker Bundle')).toBe(true);

    const updateRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'reauth_required',
        last_error: 'Token rotated',
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { status: string; last_error?: string | null };
    expect(updated.status).toBe('reauth_required');
    expect(updated.last_error).toBe('Token rotated');

    const deleteRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const emptyRes = await apiFetch(baseUrl, '/api/v1/me/external-connections');
    const emptyPayload = (await emptyRes.json()) as { items: unknown[] };
    expect(emptyPayload.items).toHaveLength(0);
  });

  it('approves a governance policy override', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'usage_warning',
        issue_source: 'usage',
        issue_message: 'usage_warning',
        reason_category: 'approved_exception',
        reason: 'Accepted exception for current governance review',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const decideRes = await apiFetch(baseUrl, `/api/v1/internal/governance-policy-overrides/${created.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(decideRes.status).toBe(200);

    const ownerApproveRes = await apiFetchWithToken(baseUrl, `/api/v1/internal/governance-policy-overrides/${created.id}/decision`, 'owner-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(ownerApproveRes.status).toBe(200);
    const decided = (await ownerApproveRes.json()) as { status: string; decided_by_user_id?: string; effective_status?: string };
    expect(decided.status).toBe('approved');
    expect(decided.decided_by_user_id).toBeTruthy();
    expect(decided.effective_status).toBe('approved');
  });

  it('returns governance runner status and triggers a manual rerun request', async () => {
    const deps = createDefaultNodeApiDeps();
    const mockRunner: GovernanceRunnerController = {
      getStatus: () => ({
        running: false,
        recent_operations: [],
      }),
      triggerRun: async (params) => ({
        id: 'runner_1',
        status: 'running',
        mode: params.mode,
        started_at: '2026-03-01T00:00:00.000Z',
        report_name: 'governance-manual-20260301T000000Z',
        source_run_id: params.sourceRunId,
        notes: params.notes,
        actor_user_id: params.actorUserId,
        actor_name: params.actorName,
      }),
    };
    const { baseUrl } = startServerWithDeps(deps);
    deps.governanceRunner = mockRunner;

    const statusRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runner');
    expect(statusRes.status).toBe(200);
    const statusPayload = (await statusRes.json()) as { running: boolean };
    expect(statusPayload.running).toBe(false);

    const triggerRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runner/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'failed_only',
        source_run_id: 'sample-governance',
        notes: 'rerun failing checks',
      }),
    });
    expect(triggerRes.status).toBe(202);
    const triggerPayload = (await triggerRes.json()) as { mode: string; source_run_id?: string };
    expect(triggerPayload.mode).toBe('failed_only');
    expect(triggerPayload.source_run_id).toBe('sample-governance');
  });
});
