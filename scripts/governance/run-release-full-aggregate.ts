import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
} from './current-gate-result-schema';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import {
  buildReleaseCampaignEvidencePathRecord,
  evidencePointerPath,
  evaluateCampaignEvidenceChecks,
  nativeResultPath,
  type ParsedGateResult,
  type ReleaseCampaignEvidencePathRecord,
  resolveExistingCampaignRoot,
  resultPath,
  stepDir,
  tryReadGateResult,
  writeCampaignGateResult,
  type ReleaseCampaignEvidencePointer,
} from './release-campaign-io';

interface AggregateFailure {
  failureClass: CurrentGateResultFailureClass;
  message: string;
}

interface ExpectedGateResultTrace {
  gateId: string;
  lineKind: string;
  npmScript: string;
  evidenceDir: string;
}

function asFailureClass(value: unknown): CurrentGateResultFailureClass {
  if (value === 'none') {
    return 'product_regression';
  }
  if (typeof value === 'string' && CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(value as CurrentGateResultFailureClass)) {
    return value as CurrentGateResultFailureClass;
  }
  return 'product_regression';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePath(left: unknown, right: string): boolean {
  return typeof left === 'string' && resolve(left) === resolve(right);
}

function nativeNpmScript(step: CurrentVerificationCampaignStep): string {
  return step.nativeResult?.npmScript ?? step.npmScript;
}

function pushContractDrift(
  failures: AggregateFailure[],
  message: string,
): void {
  failures.push({
    failureClass: 'contract_drift',
    message,
  });
}

function pushEvidenceMissing(
  failures: AggregateFailure[],
  message: string,
): void {
  failures.push({
    failureClass: 'evidence_missing',
    message,
  });
}

function readEvidencePointer(path: string): ReleaseCampaignEvidencePointer {
  return JSON.parse(readFileSync(path, 'utf8')) as ReleaseCampaignEvidencePointer;
}

function readEvidencePointerSafe(path: string): { ok: true; value: ReleaseCampaignEvidencePointer } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      value: readEvidencePointer(path),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pushMalformedResultFailure(
  failures: AggregateFailure[],
  label: string,
  error: string | undefined,
): void {
  failures.push({
    failureClass: 'contract_drift',
    message: `${label}: ${error ?? 'invalid_json'}`,
  });
}

function validateCanonicalGateResult(
  failures: AggregateFailure[],
  label: string,
  result: ParsedGateResult,
  expected: ExpectedGateResultTrace,
): boolean {
  let valid = true;

  if (result.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION) {
    pushContractDrift(
      failures,
      `${label} schema_version mismatch.`,
    );
    valid = false;
  }

  if (result.gate_id !== expected.gateId) {
    pushContractDrift(
      failures,
      `${label} gate_id mismatch.`,
    );
    valid = false;
  }

  if (result.line_kind !== expected.lineKind) {
    pushContractDrift(
      failures,
      `${label} line_kind mismatch.`,
    );
    valid = false;
  }

  if (!samePath(result.evidence_dir, expected.evidenceDir)) {
    pushContractDrift(
      failures,
      `${label} evidence_dir mismatch.`,
    );
    valid = false;
  }

  if (!CURRENT_GATE_RESULT_STATUSES.includes(result.status as never)) {
    pushContractDrift(
      failures,
      `${label} status is not a current gate result status.`,
    );
    valid = false;
  }

  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(result.failure_class as never)) {
    pushContractDrift(
      failures,
      `${label} failure_class is not a current gate result failure class.`,
    );
    valid = false;
  }

  if (!isRecord(result.gate_adapter)) {
    pushContractDrift(
      failures,
      `${label} gate_adapter is malformed.`,
    );
    valid = false;
  } else if (result.gate_adapter.npm_script !== expected.npmScript) {
    pushContractDrift(
      failures,
      `${label} gate_adapter.npm_script mismatch.`,
    );
    valid = false;
  }

  if (typeof result.stage !== 'string' || typeof result.summary !== 'string' || typeof result.generated_at !== 'string') {
    pushContractDrift(
      failures,
      `${label} canonical string fields are malformed.`,
    );
    valid = false;
  }

  return valid;
}

function validateEvidencePointer(
  failures: AggregateFailure[],
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  evidence: ReleaseCampaignEvidencePointer,
): boolean {
  let valid = true;
  if (evidence.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION) {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} schema_version mismatch.`,
    );
    valid = false;
  }
  if (evidence.step_id !== step.id) {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} step_id mismatch.`,
    );
    valid = false;
  }
  if (evidence.gate_id !== step.gateId) {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} gate_id mismatch.`,
    );
    valid = false;
  }
  if (evidence.evidence_topology !== 'campaign_root') {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} evidence_topology must be campaign_root.`,
    );
    valid = false;
  }
  if (!samePath(evidence.campaign_root, campaignRoot)) {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} campaign_root mismatch.`,
    );
    valid = false;
  }
  if (!samePath(evidence.evidence_dir, stepDir(campaignRoot, step))) {
    pushContractDrift(
      failures,
      `Evidence pointer for campaign step ${step.id} evidence_dir mismatch.`,
    );
    valid = false;
  }
  if (!Array.isArray(evidence.required_paths)) {
    pushContractDrift(
      failures,
      `Malformed evidence pointer for campaign step: ${step.id}`,
    );
    valid = false;
  }
  if (step.nativeResult) {
    const expectedNativePath = nativeResultPath(campaignRoot, step);
    if (!expectedNativePath) {
      pushContractDrift(
        failures,
        `Missing native result contract for campaign step: ${step.id}`,
      );
      valid = false;
    } else if (!isRecord(evidence.native_result)) {
      pushEvidenceMissing(
        failures,
        `Missing native result pointer for campaign step: ${step.id}`,
      );
      valid = false;
    } else {
      if (evidence.native_result.path !== expectedNativePath) {
        pushContractDrift(
          failures,
          `Native result pointer path mismatch for campaign step: ${step.id}`,
        );
        valid = false;
      }
      if (evidence.native_result.exists !== existsSync(expectedNativePath)) {
        pushContractDrift(
          failures,
          `Native result pointer exists flag mismatch for campaign step: ${step.id}`,
        );
        valid = false;
      }
      if (evidence.native_result.gate_id !== step.nativeResult.gateId) {
        pushContractDrift(
          failures,
          `Native result pointer gate_id mismatch for campaign step: ${step.id}`,
        );
        valid = false;
      }
      if (evidence.native_result.status !== 'passed') {
        pushContractDrift(
          failures,
          `Native result pointer status mismatch for campaign step: ${step.id}`,
        );
        valid = false;
      }
      if (evidence.native_result.failure_class !== 'none') {
        pushContractDrift(
          failures,
          `Native result pointer failure_class mismatch for campaign step: ${step.id}`,
        );
        valid = false;
      }
    }
  }
  return valid;
}

function validateCurrentEvidenceChecks(
  failures: AggregateFailure[],
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  evidence: ReleaseCampaignEvidencePointer,
  requiredPaths: ReleaseCampaignEvidencePathRecord[],
): void {
  const pointerRecords = Array.isArray(evidence.required_paths)
    ? evidence.required_paths
    : [];
  const pointerById = new Map<string, (typeof pointerRecords)[number]>();

  for (const candidate of pointerRecords) {
    if (
      !candidate
      || typeof candidate.id !== 'string'
      || typeof candidate.path !== 'string'
      || typeof candidate.kind !== 'string'
      || typeof candidate.exists !== 'boolean'
    ) {
      pushContractDrift(
        failures,
        `Malformed evidence path record for campaign step: ${step.id}`,
      );
      continue;
    }
    pointerById.set(candidate.id, candidate);
  }

  for (const expected of evaluateCampaignEvidenceChecks(campaignRoot, step)) {
    requiredPaths.push(buildReleaseCampaignEvidencePathRecord(expected));

    const pointerRecord = pointerById.get(expected.id);
    if (!pointerRecord) {
      pushContractDrift(
        failures,
        `Evidence pointer for campaign step ${step.id} missing current evidence check id ${expected.id}.`,
      );
      continue;
    }
    if (pointerRecord.path !== expected.path || pointerRecord.kind !== expected.kind) {
      pushContractDrift(
        failures,
        `Evidence pointer for campaign step ${step.id} check ${expected.id} no longer matches the current manifest.`,
      );
    }
    if (!expected.exists) {
      const failureClass = expected.failure_class ?? 'evidence_missing';
      failures.push({
        failureClass,
        message: expected.error
          ? `Invalid required evidence for campaign step ${step.id} check ${expected.id}: ${expected.error}`
          : `Missing required evidence for campaign step ${step.id} check ${expected.id}: ${expected.path}`,
      });
    }
    if (pointerRecord.exists !== expected.exists) {
      pushContractDrift(
        failures,
        `Evidence pointer for campaign step ${step.id} check ${expected.id} has a stale exists flag.`,
      );
    }
  }
}

function main(): void {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign manifest.');
  }

  const campaignRoot = resolveExistingCampaignRoot();
  const terminalStep = campaign.steps.find((step) => step.id === 'gate-release-full');
  if (!terminalStep) {
    throw new Error('Missing gate-release-full terminal step.');
  }

  const failures: AggregateFailure[] = [];
  const upstreamSteps = terminalStep.dependsOn.map((stepId) => {
    const step = campaign.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      failures.push({
        failureClass: 'contract_drift',
        message: `Terminal verdict depends on unknown step: ${stepId}`,
      });
    }
    return step;
  }).filter((step): step is NonNullable<typeof step> => Boolean(step));

  const requiredPaths: ReleaseCampaignEvidencePathRecord[] = [];
  for (const step of upstreamSteps) {
    const stepResultPath = resultPath(campaignRoot, step);
    requiredPaths.push(buildReleaseCampaignEvidencePathRecord({
      id: `campaign_step_result:${step.id}`,
      path: stepResultPath,
      kind: 'campaign_step_result',
      exists: existsSync(stepResultPath),
    }));
    if (!existsSync(stepResultPath)) {
      failures.push({
        failureClass: 'evidence_missing',
        message: `Missing campaign step result: ${step.id}`,
      });
      continue;
    }

    const stepResult = tryReadGateResult(stepResultPath);
    if (!stepResult.ok || !stepResult.value) {
      pushMalformedResultFailure(
        failures,
        `Malformed campaign step result for ${step.id}`,
        stepResult.error,
      );
      continue;
    }

    const result = stepResult.value;
    const stepResultIsValid = validateCanonicalGateResult(
      failures,
      `Campaign step ${step.id} result`,
      result,
      {
        gateId: step.gateId,
        lineKind: step.lineKind,
        npmScript: step.npmScript,
        evidenceDir: stepDir(campaignRoot, step),
      },
    );
    if (!stepResultIsValid) {
      continue;
    }
    if (result.status !== 'passed') {
      failures.push({
        failureClass: asFailureClass(result.failure_class),
        message: `Campaign step ${step.id} did not pass.`,
      });
      continue;
    }

    if (step.evidenceRequired) {
      const pointerPath = evidencePointerPath(campaignRoot, step);
      requiredPaths.push(buildReleaseCampaignEvidencePathRecord({
        id: `campaign_step_evidence_pointer:${step.id}`,
        path: pointerPath,
        kind: 'campaign_step_evidence_pointer',
        exists: existsSync(pointerPath),
      }));
      if (!existsSync(pointerPath)) {
        failures.push({
          failureClass: 'evidence_missing',
          message: `Missing evidence pointer for campaign step: ${step.id}`,
        });
        continue;
      }

      const evidenceRead = readEvidencePointerSafe(pointerPath);
      if (!evidenceRead.ok) {
        failures.push({
          failureClass: 'contract_drift',
          message: `Malformed evidence pointer for campaign step ${step.id}: ${evidenceRead.error}`,
        });
        continue;
      }

      const evidence = evidenceRead.value;
      const evidencePointerIsValid = validateEvidencePointer(failures, campaignRoot, step, evidence);
      if (!evidencePointerIsValid || !Array.isArray(evidence.required_paths)) {
        continue;
      }

      if (step.nativeResult) {
        const expectedNativePath = nativeResultPath(campaignRoot, step);
        if (!expectedNativePath) {
          failures.push({
            failureClass: 'contract_drift',
            message: `Missing native result contract for campaign step: ${step.id}`,
          });
        } else {
          requiredPaths.push(buildReleaseCampaignEvidencePathRecord({
            id: `campaign_step_native_result:${step.id}`,
            path: expectedNativePath,
            kind: 'campaign_step_native_result',
            exists: existsSync(expectedNativePath),
          }));
          if (!evidence.native_result) {
            failures.push({
              failureClass: 'evidence_missing',
              message: `Missing native result pointer for campaign step: ${step.id}`,
            });
          } else if (evidence.native_result.path !== expectedNativePath) {
            failures.push({
              failureClass: 'contract_drift',
              message: `Native result pointer path mismatch for campaign step: ${step.id}`,
            });
          }

          if (!existsSync(expectedNativePath)) {
            failures.push({
              failureClass: 'evidence_missing',
              message: `Missing native result for campaign step: ${step.id}`,
            });
          } else {
            const nativeResult = tryReadGateResult(expectedNativePath);
            if (!nativeResult.ok || !nativeResult.value) {
              pushMalformedResultFailure(
                failures,
                `Malformed native result for campaign step ${step.id}`,
                nativeResult.error,
              );
            } else {
              const nativeResultIsValid = validateCanonicalGateResult(
                failures,
                `Native result for campaign step ${step.id}`,
                nativeResult.value,
                {
                  gateId: step.nativeResult.gateId,
                  lineKind: step.lineKind,
                  npmScript: nativeNpmScript(step),
                  evidenceDir: dirname(expectedNativePath),
                },
              );
              if (!nativeResultIsValid) {
                continue;
              }
              if (nativeResult.value.status !== 'passed') {
                failures.push({
                  failureClass: asFailureClass(nativeResult.value.failure_class),
                  message: `Native result for campaign step ${step.id} did not pass.`,
                });
              }
            }
          }
        }
      }

      validateCurrentEvidenceChecks(failures, campaignRoot, step, evidence, requiredPaths);
    }
  }

  const terminalDir = stepDir(campaignRoot, terminalStep);
  mkdirSync(terminalDir, { recursive: true });
  const terminalEvidence = {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    step_id: terminalStep.id,
    gate_id: terminalStep.gateId,
    evidence_topology: 'campaign_root',
    campaign_root: resolve(campaignRoot),
    evidence_dir: terminalDir,
    required_paths: requiredPaths,
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(terminalDir, 'evidence.json'), `${JSON.stringify(terminalEvidence, null, 2)}\n`);

  if (failures.length > 0) {
    const firstFailure = failures[0];
    writeCampaignGateResult({
      step: terminalStep,
      campaignRoot,
      status: 'failed',
      failureClass: firstFailure.failureClass,
      stage: 'aggregate',
      summary: failures.map((failure) => failure.message).join(' '),
    });
    for (const failure of failures) {
      console.error(`[gate:release:full] ${failure.message}`);
    }
    process.exit(1);
  }

  writeCampaignGateResult({
    step: terminalStep,
    campaignRoot,
    status: 'passed',
    failureClass: 'none',
    stage: 'aggregate',
    summary: 'Release-full campaign evidence passed aggregate verification.',
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gate:release:full] ${message}`);
  process.exit(1);
}
