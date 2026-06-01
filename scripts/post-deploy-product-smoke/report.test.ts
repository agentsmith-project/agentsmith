import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PRODUCT_VERIFICATION_FLOW_IDS,
  type ProductVerificationFlowId,
} from '../unified-deploy/check-verification-report';
import {
  FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION,
  POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
  PRODUCT_FLOWS_AGGREGATE_PRODUCER,
  PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION,
  runPostDeployProductSmokeReportProducer,
} from './report';

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
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

function focusedEvidence(
  flow: ProductVerificationFlowId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION,
    flow,
    status: 'passed',
    producer: PRODUCT_FLOWS_AGGREGATE_PRODUCER,
    command: `fixture:${flow}`,
    generated_at: '2026-05-07T00:00:00.000Z',
    duration_ms: 1,
    checks: {},
    ...overrides,
  };
}

function writeFocusedEvidenceFiles(
  root: string,
  flows: readonly ProductVerificationFlowId[] = PRODUCT_VERIFICATION_FLOW_IDS,
  overrides: Partial<Record<ProductVerificationFlowId, Record<string, unknown>>> = {},
): void {
  for (const flow of flows) {
    writeJson(root, `${flow}.json`, focusedEvidence(flow, overrides[flow]));
  }
}

function aggregateWithFlows(
  flows: readonly ProductVerificationFlowId[] = PRODUCT_VERIFICATION_FLOW_IDS,
): Record<string, unknown> {
  return {
    schema_version: PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION,
    producer: PRODUCT_FLOWS_AGGREGATE_PRODUCER,
    status: 'passed',
    command: 'npm run test:unified-deploy:product-flows',
    generated_at: '2026-05-07T00:00:00.000Z',
    source: {
      public_base_url: 'http://agentsmith.localtest.me:29180',
      api_base_url: 'http://agentsmith.localtest.me:29180/api/v1',
    },
    flows: flows.map((flow) => ({
      ...focusedEvidence(flow),
    })),
    flow_evidence_paths: Object.fromEntries(flows.map((flow) => [flow, `${flow}.json`])),
    failures: [],
    paths: {
      report_path: 'product-flows.json',
      log_path: 'product-flows.log',
    },
  };
}

function readReport(reportPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
}

describe('post-deploy product smoke report producer', () => {
  it('writes the fixed report filename and exposes provider_neutral_endpoint instead of a chat_via_llmup smoke id', async () => {
    const root = tempDir('post-deploy-product-smoke-');
    const outputDir = join(root, 'out');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    const result = await runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      outputDir,
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    });

    const expectedPath = join(outputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME);
    expect(result.reportPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const report = readReport(expectedPath);
    expect(report).toMatchObject({
      schema_version: POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
      producer: POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
      owner: 'agentsmith',
      status: 'passed',
    });
    const smokeResults = report.smoke_results as Record<string, unknown>;
    expect(Object.keys(smokeResults)).toContain('provider_neutral_endpoint');
    expect(Object.keys(smokeResults)).not.toContain('chat_via_llmup');
    expect(smokeResults.provider_neutral_endpoint).toMatchObject({
      source_flow: 'chat_via_llmup',
      source_evidence_path: join(root, 'chat_via_llmup.json'),
      status: 'passed',
    });
    for (const smokeResult of Object.values(smokeResults) as Record<string, unknown>[]) {
      expect(smokeResult.source_evidence_path).toEqual(expect.stringMatching(root));
    }
  });

  it('serializes report paths relative to pathRoot using POSIX paths while reading absolute evidence', async () => {
    const campaignRoot = tempDir('post-deploy-product-smoke-campaign-');
    const productFlowsDir = join(campaignRoot, 'unified-deploy', 'product-flows');
    const outputDir = join(campaignRoot, 'post-deploy-product-smoke');
    writeFocusedEvidenceFiles(productFlowsDir);
    const aggregatePath = writeJson(productFlowsDir, 'aggregate.json', aggregateWithFlows());

    const result = await runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      outputDir,
      pathRoot: campaignRoot,
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    });

    const expectedPath = join(outputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME);
    expect(result.reportPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const reportText = readFileSync(expectedPath, 'utf8');
    expect(reportText).not.toContain(campaignRoot);

    const report = readReport(expectedPath);
    expect(report.source).toMatchObject({
      product_flows_path: 'unified-deploy/product-flows/aggregate.json',
    });
    expect(report.paths).toMatchObject({
      report_path: 'post-deploy-product-smoke/post-deploy-product-smoke-report.json',
    });

    const smokeResults = report.smoke_results as Record<string, Record<string, unknown>>;
    expect(smokeResults.provider_neutral_endpoint).toMatchObject({
      source_flow: 'chat_via_llmup',
      source_evidence_path: 'unified-deploy/product-flows/chat_via_llmup.json',
    });
    for (const smokeResult of Object.values(smokeResults)) {
      const sourceEvidencePath = smokeResult.source_evidence_path;
      expect(sourceEvidencePath).toEqual(expect.any(String));
      expect(sourceEvidencePath).not.toMatch(/^\/|\\/u);
    }
  });

  it('fails fast when pathRoot serialization would point outside the campaign root', async () => {
    const productFlowsRoot = tempDir('post-deploy-product-smoke-outside-product-root-');
    const outsideProductFlowsRoot = tempDir('post-deploy-product-smoke-outside-product-source-');
    writeFocusedEvidenceFiles(outsideProductFlowsRoot);
    const outsideAggregatePath = writeJson(
      outsideProductFlowsRoot,
      'aggregate.json',
      aggregateWithFlows(),
    );
    const outsideProductOutputDir = join(productFlowsRoot, 'post-deploy-product-smoke');
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: outsideAggregatePath,
      outputDir: outsideProductOutputDir,
      pathRoot: productFlowsRoot,
    })).rejects.toThrow(/source\.product_flows_path must stay under --path-root/u);
    expect(existsSync(join(outsideProductOutputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);

    const reportRoot = tempDir('post-deploy-product-smoke-outside-report-root-');
    const reportProductFlowsDir = join(reportRoot, 'unified-deploy', 'product-flows');
    const outsideReportRoot = tempDir('post-deploy-product-smoke-outside-report-target-');
    writeFocusedEvidenceFiles(reportProductFlowsDir);
    const reportAggregatePath = writeJson(reportProductFlowsDir, 'aggregate.json', aggregateWithFlows());
    const outsideReportOutputDir = join(outsideReportRoot, 'post-deploy-product-smoke');
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: reportAggregatePath,
      outputDir: outsideReportOutputDir,
      pathRoot: reportRoot,
    })).rejects.toThrow(/paths\.report_path must stay under --path-root/u);
    expect(existsSync(join(outsideReportOutputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);

    const evidenceRoot = tempDir('post-deploy-product-smoke-outside-evidence-root-');
    const evidenceProductFlowsDir = join(evidenceRoot, 'unified-deploy', 'product-flows');
    const outsideEvidenceRoot = tempDir('post-deploy-product-smoke-outside-evidence-source-');
    writeFocusedEvidenceFiles(evidenceProductFlowsDir);
    writeJson(outsideEvidenceRoot, 'files.json', focusedEvidence('files'));
    const aggregate = aggregateWithFlows();
    (aggregate.flow_evidence_paths as Record<string, unknown>).files = join(outsideEvidenceRoot, 'files.json');
    const evidenceAggregatePath = writeJson(evidenceProductFlowsDir, 'aggregate.json', aggregate);
    const evidenceOutputDir = join(evidenceRoot, 'post-deploy-product-smoke');
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: evidenceAggregatePath,
      outputDir: evidenceOutputDir,
      pathRoot: evidenceRoot,
    })).rejects.toThrow(/smoke_results\.files\.source_evidence_path must stay under --path-root/u);
    expect(existsSync(join(evidenceOutputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);
  });

  it('fails when a required source flow is missing', async () => {
    const root = tempDir('post-deploy-product-smoke-missing-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(
      root,
      'product-flows.json',
      aggregateWithFlows(PRODUCT_VERIFICATION_FLOW_IDS.filter((flow) => flow !== 'files')),
    );

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    })).rejects.toThrow(/missing required source flow: files/u);
  });

  it('fails fast for release-kit-shaped product-flow aggregate producers', async () => {
    const root = tempDir('post-deploy-product-smoke-release-kit-');
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate.producer = 'agentsmith-release-kit';
    const aggregatePath = writeJson(root, 'product-flows-release-kit.json', aggregate);

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    })).rejects.toThrow(/producer must be unified-deploy-product-flows; release-kit producers are not accepted/u);
  });

  it('fails when flow_evidence_paths is missing or omits a required source flow', async () => {
    const root = tempDir('post-deploy-product-smoke-missing-paths-');
    writeFocusedEvidenceFiles(root);

    const missingPaths = aggregateWithFlows();
    delete missingPaths.flow_evidence_paths;
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-no-paths.json', missingPaths),
      outputDir: join(root, 'out-no-paths'),
    })).rejects.toThrow(/flow_evidence_paths must be an object/u);

    const missingFlowPath = aggregateWithFlows();
    delete (missingFlowPath.flow_evidence_paths as Record<string, unknown>).files;
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-missing-flow-path.json', missingFlowPath),
      outputDir: join(root, 'out-missing-flow-path'),
    })).rejects.toThrow(/flow_evidence_paths\.files is required/u);
  });

  it('fails when a required focused flow has bad schema or producer provenance', async () => {
    const root = tempDir('post-deploy-product-smoke-bad-focused-');
    writeFocusedEvidenceFiles(root);

    const badSchema = aggregateWithFlows();
    const badSchemaFlow = (badSchema.flows as Record<string, unknown>[])
      .find((flow) => flow.flow === 'files');
    if (!badSchemaFlow) {
      throw new Error('missing files flow fixture');
    }
    badSchemaFlow.schema_version = 'agentsmith.focused-product-flow.evidence/v0';
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-bad-schema.json', badSchema),
      outputDir: join(root, 'out-bad-schema'),
    })).rejects.toThrow(/product_flows\.flows\.files\.schema_version must be agentsmith\.focused-product-flow\.evidence\/v1/u);

    const badProducer = aggregateWithFlows();
    const badProducerFlow = (badProducer.flows as Record<string, unknown>[])
      .find((flow) => flow.flow === 'usage');
    if (!badProducerFlow) {
      throw new Error('missing usage flow fixture');
    }
    badProducerFlow.producer = 'agentsmith-release-kit';
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-bad-producer.json', badProducer),
      outputDir: join(root, 'out-bad-producer'),
    })).rejects.toThrow(/product_flows\.flows\.usage\.producer must be unified-deploy-product-flows/u);
  });

  it('fails when any required source flow status is failed', async () => {
    const root = tempDir('post-deploy-product-smoke-failed-flow-');
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    const filesFlow = (aggregate.flows as Record<string, unknown>[])
      .find((flow) => flow.flow === 'files');
    if (!filesFlow) {
      throw new Error('missing files flow fixture');
    }
    filesFlow.status = 'failed';

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-failed-flow.json', aggregate),
      outputDir: join(root, 'out'),
    })).rejects.toThrow(/product_flows\.flows\.files\.status must be passed/u);
  });

  it('fails when aggregate failures are non-empty', async () => {
    const root = tempDir('post-deploy-product-smoke-aggregate-failures-');
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate.failures = [{ path: 'flow:files', message: 'files failed' }];

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, 'product-flows-failures.json', aggregate),
      outputDir: join(root, 'out'),
    })).rejects.toThrow(/failures must be empty/u);
  });

  it.each([
    ['schema_version', 'agentsmith.unified-deploy.product-flows.aggregate/v0', /product_flows\.schema_version must be agentsmith\.unified-deploy\.product-flows\.aggregate\/v1/u],
    ['status', 'failed', /product_flows\.status must be passed/u],
  ] as const)('fails when aggregate %s is unsupported', async (field, value, expectedError) => {
    const root = tempDir(`post-deploy-product-smoke-bad-aggregate-${field}-`);
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate[field] = value;

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: writeJson(root, `product-flows-bad-${field}.json`, aggregate),
      outputDir: join(root, 'out'),
    })).rejects.toThrow(expectedError);
  });

  it('does not emit a formal_verdict field', async () => {
    const root = tempDir('post-deploy-product-smoke-no-verdict-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    const result = await runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    });

    expect(result.report).not.toHaveProperty('formal_verdict');
    expect(readReport(result.reportPath)).not.toHaveProperty('formal_verdict');
  });
});
