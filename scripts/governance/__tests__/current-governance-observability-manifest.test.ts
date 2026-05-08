import { describe, expect, it } from 'vitest';

import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
  validateCurrentRunDiagnosticArtifactPayload,
} from '../current-run-diagnostics-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
  validateCurrentStatusProjection,
} from '../current-status-projection-schema';
import {
  CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS,
  listCurrentGovernanceObservabilityObjects,
  validateCurrentGovernanceObservabilityManifest,
} from '../current-governance-observability-manifest';
import {
  MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
  MINIMAL_LEASE_STATUS_SHADOW_VERSION,
} from '../lease-status-shadow';
import { buildRedactedDiagnostic, findRedactionLeaks } from '../redaction';
import { ORDERED_SENTINEL_PROBES } from '../sentinel-preflight';
import { buildStatusProjection } from '../status-projection';

function byId(id: string) {
  const definition = listCurrentGovernanceObservabilityObjects().find((candidate) => candidate.id === id);
  expect(definition, `missing governance observability object ${id}`).toBeTruthy();
  return definition!;
}

describe('current governance observability manifest', () => {
  it('registers P0 observability objects as current truth without creating verdict or evidence truth', () => {
    const objects = listCurrentGovernanceObservabilityObjects();

    expect(objects.map((definition) => definition.id)).toEqual(CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS);
    expect(validateCurrentGovernanceObservabilityManifest({ objects })).toEqual({
      ok: true,
      value: { objects },
    });

    for (const definition of objects) {
      expect(definition.authority.non_verdict, definition.id).toBe(true);
      expect(definition.authority.non_evidence_truth, definition.id).toBe(true);
      expect(definition.authority.writes_canonical_result, definition.id).toBe(false);
      expect(definition.authority.produces_release_verdict, definition.id).toBe(false);
      expect(definition.authority.participates_in_evidence_completeness, definition.id).toBe(false);
    }

    expect(byId('status_projection_schema')).toMatchObject({
      kind: 'read_only_projection',
      schema_ref: CURRENT_STATUS_PROJECTION_SCHEMA,
      schema_version: CURRENT_STATUS_PROJECTION_VERSION,
      implementation_refs: [
        'scripts/governance/current-status-projection-schema.ts',
        'scripts/governance/status-projection.ts',
        'scripts/governance/release-status.ts',
        'scripts/governance/local-real-status.ts',
      ],
      authority: {
        read_only: true,
      },
      safety_boundary: {
        forbidden_fields: ['release_verdict', 'automated_release_verdict'],
        redaction_required: true,
      },
    });
    expect(byId('run_diagnostics_artifacts')).toMatchObject({
      kind: 'diagnostic_artifact_family',
      artifact_files: Object.values(CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES),
      authority: {
        diagnostic_audit: true,
      },
      safety_boundary: {
        forbidden_fields: [...CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS],
      },
    });
    expect(byId('sentinel_preflight')).toMatchObject({
      kind: 'preflight_diagnostic',
      sentinel_probes: [...ORDERED_SENTINEL_PROBES],
      authority: {
        diagnostic_audit: true,
      },
    });
    expect(byId('lease_status_shadow')).toMatchObject({
      kind: 'read_only_shadow',
      schema_ref: MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
      schema_version: MINIMAL_LEASE_STATUS_SHADOW_VERSION,
      authority: {
        read_only: true,
      },
    });
    expect(byId('redaction_boundary')).toMatchObject({
      kind: 'redaction_boundary',
      safety_boundary: {
        allowed_output_fields: ['presence', 'profile_digest', 'public_endpoint', 'port_family'],
        raw_secret_output_allowed: false,
      },
    });
  });

  it('keeps manifest forbidden fields aligned with projection, diagnostics, and redacted diagnostic output', () => {
    const projection = buildStatusProjection({
      goal: 'release-ready',
      generatedAt: '2026-04-27T12:00:00.000Z',
    });
    const statusForbiddenFields = byId('status_projection_schema').safety_boundary.forbidden_fields;

    for (const field of statusForbiddenFields) {
      const pollutedProjection = {
        ...projection,
        [field]: 'forbidden',
      };

      const result = validateCurrentStatusProjection(pollutedProjection);

      expect(result.ok, `${field} must be rejected by status projection schema`).toBe(false);
    }

    const diagnosticsForbiddenFields = byId('run_diagnostics_artifacts').safety_boundary.forbidden_fields;
    for (const field of diagnosticsForbiddenFields) {
      const result = validateCurrentRunDiagnosticArtifactPayload('stage_events', {
        schema_version: '1.0.0',
        artifact_kind: 'stage_event',
        run_id: 'observability-manifest-test',
        stage: 'verify',
        event: 'failed',
        stage_failure_reason: 'contract_pollution_test',
        generated_at: '2026-04-27T12:00:00.000Z',
        [field]: 'forbidden',
      });

      expect(result.ok, `${field} must be rejected by diagnostics schema`).toBe(false);
    }

    const redacted = buildRedactedDiagnostic({
      env: {
        NEXT_PUBLIC_API_BASE: 'https://api.example.test:20000/api/v1?access_token=query-token',
        AUTHORIZATION: 'Bearer raw-token-value',
        OPENAI_API_KEY: 'sk-observability-manifest-raw-value',
        RUNNER_TICKET: 'ticket=raw-ticket-value',
      },
    });

    expect(Object.keys(redacted)).toEqual(byId('redaction_boundary').safety_boundary.allowed_output_fields);
    expect(findRedactionLeaks(redacted)).toEqual([]);
  });
});
