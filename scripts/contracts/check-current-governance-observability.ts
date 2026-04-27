import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_SCHEMA,
  CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_VERSION,
  CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS,
  listCurrentGovernanceObservabilityObjects,
  validateCurrentGovernanceObservabilityManifest,
  type CurrentGovernanceObservabilityObjectDefinition,
} from '../governance/current-governance-observability-manifest';
import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  CURRENT_RUN_DIAGNOSTICS_ARTIFACTS,
  CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
  CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
  validateCurrentRunDiagnosticArtifactPayload,
} from '../governance/current-run-diagnostics-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
  validateCurrentStatusProjection,
} from '../governance/current-status-projection-schema';
import {
  MINIMAL_LEASE_STATUS_SHADOW_SCHEMA,
  MINIMAL_LEASE_STATUS_SHADOW_VERSION,
} from '../governance/lease-status-shadow';
import {
  CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS,
  CURRENT_REHEARSAL_METADATA_SCHEMA,
  CURRENT_REHEARSAL_METADATA_VERSION,
  buildCurrentRehearsalMetadata,
  validateCurrentRehearsalMetadata,
} from '../governance/current-rehearsal-metadata-schema';
import { buildRedactedDiagnostic, findRedactionLeaks } from '../governance/redaction';
import { ORDERED_SENTINEL_PROBES } from '../governance/sentinel-preflight';
import { buildStatusProjection } from '../governance/status-projection';

type PackageJson = {
  scripts?: Record<string, string>;
};

const failures: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures.push(message);
  }
}

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), 'utf8');
}

function objectById(id: string): CurrentGovernanceObservabilityObjectDefinition {
  const definition = listCurrentGovernanceObservabilityObjects().find((candidate) => candidate.id === id);
  assert(definition, `missing observability manifest object: ${id}`);
  return definition!;
}

function assertExactArray(label: string, actual: readonly string[], expected: readonly string[]): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch.\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
  );
}

function assertNoForbiddenDiagnosticField(field: string): void {
  const result = validateCurrentRunDiagnosticArtifactPayload('stage_events', {
    schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    artifact_kind: 'stage_event',
    run_id: 'current-governance-observability-contract',
    stage: 'verify',
    event: 'failed',
    stage_failure_reason: 'forbidden_field_contract_test',
    generated_at: '2026-04-27T12:00:00.000Z',
    [field]: 'forbidden',
  });

  assert(result.ok === false, `diagnostics schema must reject forbidden field: ${field}`);
}

function main(): void {
  const objects = listCurrentGovernanceObservabilityObjects();
  const validation = validateCurrentGovernanceObservabilityManifest({ objects });
  assert(validation.ok, validation.ok ? '' : validation.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('\n'));
  assert(CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_SCHEMA === 'current-governance-observability-manifest.v1', 'unexpected observability manifest schema id');
  assert(CURRENT_GOVERNANCE_OBSERVABILITY_MANIFEST_VERSION === 1, 'unexpected observability manifest version');
  assertExactArray(
    'observability object ids',
    objects.map((definition) => definition.id),
    CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS,
  );

  for (const definition of objects) {
    assert(definition.authority.non_verdict === true, `${definition.id} must be non-verdict`);
    assert(definition.authority.non_evidence_truth === true, `${definition.id} must be non-evidence-truth`);
    assert(definition.authority.writes_canonical_result === false, `${definition.id} must not write canonical result`);
    assert(definition.authority.produces_release_verdict === false, `${definition.id} must not produce release verdict`);
    assert(
      definition.authority.participates_in_evidence_completeness === false,
      `${definition.id} must not participate in evidence completeness`,
    );
    for (const path of [
      ...definition.implementation_refs,
      ...definition.contract_refs,
      ...definition.docs_refs,
    ]) {
      assert(existsSync(resolve(path)), `${definition.id} references missing path: ${path}`);
    }
  }

  const statusProjection = objectById('status_projection_schema');
  assert(statusProjection.kind === 'read_only_projection', 'status projection must be a read-only projection');
  assert(statusProjection.authority.read_only === true, 'status projection must be read_only');
  assert(statusProjection.schema_ref === CURRENT_STATUS_PROJECTION_SCHEMA, 'status projection schema ref drifted');
  assert(statusProjection.schema_version === CURRENT_STATUS_PROJECTION_VERSION, 'status projection schema version drifted');
  assertExactArray(
    'status projection implementation refs',
    statusProjection.implementation_refs,
    [
      'scripts/governance/current-status-projection-schema.ts',
      'scripts/governance/status-projection.ts',
      'scripts/governance/release-status.ts',
      'scripts/governance/rehearsal-entrypoint.ts',
      'scripts/governance/local-real-status.ts',
    ],
  );
  assert(
    statusProjection.safety_boundary.redaction_required === true,
    'status projection terminal summaries must remain inside the redaction boundary',
  );
  assertExactArray(
    'status projection forbidden fields',
    statusProjection.safety_boundary.forbidden_fields,
    ['release_verdict', 'automated_release_verdict'],
  );
  for (const field of statusProjection.safety_boundary.forbidden_fields) {
    const projection = buildStatusProjection({
      goal: 'release-ready',
      generatedAt: '2026-04-27T12:00:00.000Z',
    });
    const result = validateCurrentStatusProjection({
      ...projection,
      [field]: 'forbidden',
    });
    assert(result.ok === false, `status projection schema must reject forbidden field: ${field}`);
  }

  const diagnostics = objectById('run_diagnostics_artifacts');
  assert(diagnostics.kind === 'diagnostic_artifact_family', 'run diagnostics must be a diagnostic artifact family');
  assert(diagnostics.authority.diagnostic_audit === true, 'run diagnostics must be diagnostic audit');
  assert(diagnostics.schema_version === CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION, 'run diagnostics schema version drifted');
  assertExactArray(
    'run diagnostics artifact files',
    diagnostics.artifact_files ?? [],
    Object.values(CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES),
  );
  assertExactArray(
    'run diagnostics forbidden fields',
    diagnostics.safety_boundary.forbidden_fields,
    CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
  );
  for (const artifact of CURRENT_RUN_DIAGNOSTICS_ARTIFACTS) {
    assert(artifact.purpose === 'diagnostic_audit', `${artifact.kind} must remain diagnostic audit`);
    assert(
      artifact.participates_in_evidence_completeness === false,
      `${artifact.kind} must not participate in evidence completeness`,
    );
  }
  for (const field of CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS) {
    assertNoForbiddenDiagnosticField(field);
  }

  const sentinel = objectById('sentinel_preflight');
  assert(sentinel.kind === 'preflight_diagnostic', 'sentinel must be registered as a preflight diagnostic');
  assert(sentinel.authority.diagnostic_audit === true, 'sentinel must be diagnostic audit');
  assertExactArray('sentinel probes', sentinel.sentinel_probes ?? [], ORDERED_SENTINEL_PROBES);

  const leaseShadow = objectById('lease_status_shadow');
  assert(leaseShadow.kind === 'read_only_shadow', 'lease status must be a read-only shadow');
  assert(leaseShadow.authority.read_only === true, 'lease status shadow must be read_only');
  assert(leaseShadow.schema_ref === MINIMAL_LEASE_STATUS_SHADOW_SCHEMA, 'lease status shadow schema ref drifted');
  assert(leaseShadow.schema_version === MINIMAL_LEASE_STATUS_SHADOW_VERSION, 'lease status shadow version drifted');

  const rehearsalMetadata = objectById('rehearsal_metadata_schema');
  assert(rehearsalMetadata.kind === 'read_only_metadata_schema', 'rehearsal metadata must be a read-only metadata schema');
  assert(rehearsalMetadata.authority.read_only === true, 'rehearsal metadata schema must be read_only');
  assert(rehearsalMetadata.authority.diagnostic_audit === false, 'rehearsal metadata schema must not be a diagnostic writer');
  assert(rehearsalMetadata.schema_ref === CURRENT_REHEARSAL_METADATA_SCHEMA, 'rehearsal metadata schema ref drifted');
  assert(rehearsalMetadata.schema_version === CURRENT_REHEARSAL_METADATA_VERSION, 'rehearsal metadata schema version drifted');
  assertExactArray(
    'rehearsal metadata implementation refs',
    rehearsalMetadata.implementation_refs,
    ['scripts/governance/current-rehearsal-metadata-schema.ts'],
  );
  assertExactArray(
    'rehearsal metadata forbidden fields',
    rehearsalMetadata.safety_boundary.forbidden_fields,
    CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS,
  );
  assert(
    rehearsalMetadata.safety_boundary.redaction_required === true,
    'rehearsal metadata must remain inside the redaction boundary',
  );
  const sampleRehearsalMetadata = buildCurrentRehearsalMetadata({
    rehearsalMode: 'fast',
    resetLevel: 'none',
    generatedAt: '2026-04-27T12:00:00.000Z',
    worldIdentity: {
      runtime_line: 'demo-rehearsal',
      world_root: 'artifacts/runtime/scenario/demo-rehearsal',
      service_ports: {
        web: 3000,
        api: 20000,
      },
    },
    skipInvalidation: {
      target: 'rollout',
      operation: 'skip-if-inputs-unchanged',
      input_digest: `sha256:${'a'.repeat(64)}`,
      existing_artifact_digest: `sha256:${'b'.repeat(64)}`,
      skip_reason: 'input_digest_matches',
      validator: 'current-rehearsal-metadata-schema',
    },
  });
  assert(
    validateCurrentRehearsalMetadata(sampleRehearsalMetadata).ok === true,
    'sample rehearsal metadata must validate',
  );
  assert(
    validateCurrentRehearsalMetadata({
      ...sampleRehearsalMetadata,
      world_identity: {
        ...sampleRehearsalMetadata.world_identity,
        runtime_line: 'local-real',
      },
    }).ok === false,
    'local-real must stay a goal adapter, not a rehearsal runtime line',
  );
  for (const field of CURRENT_REHEARSAL_METADATA_FORBIDDEN_FIELDS) {
    assert(
      validateCurrentRehearsalMetadata({
        ...sampleRehearsalMetadata,
        skip_invalidation: {
          ...sampleRehearsalMetadata.skip_invalidation,
          [field]: 'forbidden',
        },
      }).ok === false,
      `rehearsal metadata schema must reject forbidden field: ${field}`,
    );
  }
  const { rehearsal_mode: _rehearsalMode, ...legacyModeShape } = sampleRehearsalMetadata;
  assert(
    validateCurrentRehearsalMetadata({
      ...legacyModeShape,
      mode: 'fast',
    }).ok === false,
    'rehearsal metadata schema must reject legacy mode field',
  );
  const { skip_reason: _skipReason, ...legacySkipInvalidationShape } = sampleRehearsalMetadata.skip_invalidation;
  assert(
    validateCurrentRehearsalMetadata({
      ...sampleRehearsalMetadata,
      skip_invalidation: {
        ...legacySkipInvalidationShape,
        reason: 'legacy_reason_field',
      },
    }).ok === false,
    'rehearsal metadata schema must reject legacy skip invalidation reason field',
  );
  assert(
    validateCurrentRehearsalMetadata({
      ...sampleRehearsalMetadata,
      world_identity: {
        ...sampleRehearsalMetadata.world_identity,
        api_key: 'sk-current-rehearsal-raw-secret-value',
      },
    }).ok === false,
    'rehearsal metadata schema must reject raw secret fields',
  );
  assert(
    validateCurrentRehearsalMetadata({
      ...sampleRehearsalMetadata,
      world_identity: {
        ...sampleRehearsalMetadata.world_identity,
        world_id: 'Bearer raw-token-value',
      },
    }).ok === false,
    'rehearsal metadata schema must reject raw secret-looking values',
  );
  assert(
    validateCurrentRehearsalMetadata({
      ...sampleRehearsalMetadata,
      skip_invalidation: {
        ...sampleRehearsalMetadata.skip_invalidation,
        skip_reason: 'managed_credentials: {"feishu":"raw-secret"}',
      },
    }).ok === false,
    'rehearsal metadata schema must reject object-ish raw secret strings',
  );
  assertExactArray(
    'rehearsal skip invalidation fields',
    Object.keys(sampleRehearsalMetadata.skip_invalidation),
    ['target', 'operation', 'input_digest', 'existing_artifact_digest', 'skip_reason', 'validator'],
  );
  for (const blockedField of ['verdict', 'claim_id', 'reusable']) {
    assert(
      !Object.prototype.hasOwnProperty.call(sampleRehearsalMetadata.skip_invalidation, blockedField),
      `skip invalidation must not expose ${blockedField}`,
    );
  }

  const redaction = objectById('redaction_boundary');
  assert(redaction.kind === 'redaction_boundary', 'redaction boundary kind drifted');
  assert(redaction.safety_boundary.raw_secret_output_allowed === false, 'redaction boundary must forbid raw secret output');
  assertExactArray(
    'redaction allowed output fields',
    redaction.safety_boundary.allowed_output_fields ?? [],
    ['presence', 'profile_digest', 'public_endpoint', 'port_family'],
  );
  const redacted = buildRedactedDiagnostic({
    env: {
      NEXT_PUBLIC_API_BASE: 'https://api.example.test:20000/api/v1?access_token=query-token',
      AUTHORIZATION: 'Bearer raw-token-value',
      OPENAI_API_KEY: 'sk-current-governance-observability-raw-value',
      RUNNER_TICKET: 'ticket=raw-ticket-value',
    },
  });
  assertExactArray(
    'runtime redacted diagnostic output fields',
    Object.keys(redacted),
    redaction.safety_boundary.allowed_output_fields ?? [],
  );
  assert(findRedactionLeaks(redacted).length === 0, 'redacted diagnostic output must not leak secrets');

  const contractDoc = read('docs/contracts/current-governance-observability-contract.md');
  const contractsIndex = read('docs/contracts/README.md');
  const packageJson = JSON.parse(read('package.json')) as PackageJson;
  assert(
    contractsIndex.includes('current-governance-observability-contract.md'),
    'contracts README must index current governance observability contract',
  );
  for (const id of CURRENT_GOVERNANCE_OBSERVABILITY_OBJECT_IDS) {
    assert(contractDoc.includes(id), `observability contract must document ${id}`);
  }
  assert(
    packageJson.scripts?.['contracts:check-current-governance-observability']
      === 'tsx scripts/contracts/check-current-governance-observability.ts',
    'package.json must expose contracts:check-current-governance-observability',
  );
  assert(
    packageJson.scripts?.['contracts:check']?.includes('npm run contracts:check-current-governance-observability'),
    'contracts:check must include current governance observability checker',
  );

  if (failures.length > 0) {
    console.error('[contracts] current governance observability check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('[contracts] current governance observability check passed');
}

main();
