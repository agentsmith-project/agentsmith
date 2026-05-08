import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PRODUCT_VERIFICATION_FLOWS,
  runUnifiedDeployVerificationReportProducer,
  type ProductVerificationFlowId,
} from './check-verification-report';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeJson(root: string, name: string, value: unknown): string {
  const target = join(root, name);
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

function writeSmokeEvidence(root: string): string {
  return writeJson(root, 'existing-cluster-smoke.json', {
    schema_version: 'agentsmith.unified-deploy.existing-cluster-smoke.evidence/v1',
    producer: 'existing-cluster-smoke',
    status: 'passed',
    profile: 'existing-cluster',
    substrate_truth_fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    rendered_config_fingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    manifest_summary: {
      resources: ['Deployment/agentsmith-api', 'Deployment/agentsmith-llmup'],
    },
    rollouts: [
      { deployment: 'agentsmith-web', status: 'passed' },
      { deployment: 'agentsmith-api', status: 'passed' },
      { deployment: 'agentsmith-llmup', status: 'passed' },
      { deployment: 'agentsmith-sandbox-manager', status: 'passed' },
    ],
    route_probes: [
      { name: 'web-public-workspaces', status: 'passed', status_code: 200 },
      { name: 'api-profile', status: 'passed', status_code: 200 },
      { name: 'api-agent-execution-ws', status: 'passed', status_code: 400 },
      { name: 'internal-services-not-exposed', status: 'passed' },
    ],
    llmup_config_health: {
      status: 'passed',
      config_map: 'agentsmith-llmup-config',
      admin_token_secret: 'agentsmith-app-secrets/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN',
      readiness_path: '/health',
      liveness_path: '/health',
      rollout_status: 'passed',
    },
    product_verification_matrix: {
      login_profile: {
        status: 'not_claimed',
        reason: 'route smoke is not product login/profile evidence',
      },
    },
  });
}

function writeProductEvidence(root: string, flow: ProductVerificationFlowId): string {
  return writeJson(root, `${flow}.json`, {
    schema_version: 'agentsmith.focused-product-flow.evidence/v1',
    flow,
    status: 'passed',
    command: `fixture:${flow}`,
    generated_at: '2026-05-07T00:00:00.000Z',
  });
}

describe('unified deploy verification report producer', () => {
  it('keeps the milestone product matrix required but not passed when only route smoke evidence exists', async () => {
    const root = tempDir('unified-report-smoke-only-');
    const reportDir = tempDir('unified-report-evidence-');
    const smokePath = writeSmokeEvidence(root);

    const result = await runUnifiedDeployVerificationReportProducer({
      evidenceDir: reportDir,
      existingClusterSmokePath: smokePath,
    });
    const report = JSON.parse(readFileSync(result.evidence.paths.report_path, 'utf8')) as {
      status?: string;
      substrate_status?: { status?: string };
      app_rollout_status?: { status?: string };
      ingress_route_probes?: { status?: string };
      llmup_path_config_proof?: { status?: string };
      product_verification_matrix?: Record<string, { status?: string; required_evidence_input?: string }>;
    };

    expect(result.status).toBe('blocked');
    expect(report.substrate_status?.status).toBe('passed');
    expect(report.app_rollout_status?.status).toBe('passed');
    expect(report.ingress_route_probes?.status).toBe('passed');
    expect(report.llmup_path_config_proof?.status).toBe('passed');
    for (const flow of PRODUCT_VERIFICATION_FLOWS) {
      expect(report.product_verification_matrix?.[flow.id]).toMatchObject({
        status: 'required_not_passed',
        required_evidence_input: flow.evidenceInput,
      });
    }
    expect(report.product_verification_matrix?.login_profile?.status).not.toBe('passed');
  });

  it('passes only when every required product flow has an explicit focused evidence input', async () => {
    const root = tempDir('unified-report-complete-');
    const reportDir = tempDir('unified-report-evidence-');
    const smokePath = writeSmokeEvidence(root);
    const productEvidence = Object.fromEntries(
      PRODUCT_VERIFICATION_FLOWS.map((flow) => [flow.id, writeProductEvidence(root, flow.id)]),
    ) as Record<ProductVerificationFlowId, string>;

    const result = await runUnifiedDeployVerificationReportProducer({
      evidenceDir: reportDir,
      existingClusterSmokePath: smokePath,
      productEvidence,
    });

    expect(result.status).toBe('passed');
    for (const flow of PRODUCT_VERIFICATION_FLOWS) {
      expect(result.evidence.product_verification_matrix[flow.id]).toMatchObject({
        status: 'passed',
        evidence_path: productEvidence[flow.id],
      });
    }
  });

  it('can consume aggregate product-flow evidence without repeating every focused evidence path', async () => {
    const root = tempDir('unified-report-aggregate-');
    const reportDir = tempDir('unified-report-evidence-');
    const smokePath = writeSmokeEvidence(root);
    const flowEvidencePaths = Object.fromEntries(
      PRODUCT_VERIFICATION_FLOWS.map((flow) => [flow.id, writeProductEvidence(root, flow.id)]),
    ) as Record<ProductVerificationFlowId, string>;
    const aggregatePath = writeJson(root, 'product-flows.json', {
      schema_version: 'agentsmith.unified-deploy.product-flows.aggregate/v1',
      producer: 'unified-deploy-product-flows',
      status: 'passed',
      flow_evidence_paths: flowEvidencePaths,
    });

    const result = await runUnifiedDeployVerificationReportProducer({
      evidenceDir: reportDir,
      existingClusterSmokePath: smokePath,
      productFlowsAggregatePath: aggregatePath,
    });

    expect(result.status).toBe('passed');
    for (const flow of PRODUCT_VERIFICATION_FLOWS) {
      expect(result.evidence.product_verification_matrix[flow.id]).toMatchObject({
        status: 'passed',
        evidence_path: flowEvidencePaths[flow.id],
      });
    }
  });

  it('rejects product evidence whose flow id or status does not match the requested matrix item', async () => {
    const root = tempDir('unified-report-invalid-product-');
    const reportDir = tempDir('unified-report-evidence-');
    const smokePath = writeSmokeEvidence(root);
    const wrongFlowPath = writeJson(root, 'wrong-flow.json', {
      schema_version: 'agentsmith.focused-product-flow.evidence/v1',
      flow: 'chat_via_llmup',
      status: 'passed',
    });

    const result = await runUnifiedDeployVerificationReportProducer({
      evidenceDir: reportDir,
      existingClusterSmokePath: smokePath,
      productEvidence: {
        login_profile: wrongFlowPath,
      },
    });

    expect(result.status).toBe('blocked');
    expect(result.evidence.product_verification_matrix.login_profile).toMatchObject({
      status: 'required_not_passed',
      evidence_path: wrongFlowPath,
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'product:login_profile',
        message: expect.stringContaining('must contain flow=login_profile and status=passed'),
      }),
    ]));
  });
});
