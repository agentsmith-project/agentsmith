import { createHash } from 'node:crypto';
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
const RELEASE_CONTRACT_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const RELEASE_CONTRACT_RELEASE_ID = '2026.05.23-p0';
const RELEASE_CONTRACT_FIXTURE_PATH = join(
  process.cwd(),
  'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
);

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

function writeText(root: string, name: string, value: string): string {
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, 'utf8');
  return target;
}

function releaseContractFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(JSON.parse(readFileSync(RELEASE_CONTRACT_FIXTURE_PATH, 'utf8')) as Record<string, unknown>),
    ...overrides,
  };
}

function writeReleaseContract(
  root: string,
  overrides: Record<string, unknown> = {},
  name = 'release-contract/agentsmith-release-contract.json',
): string {
  return writeJson(root, name, releaseContractFixture(overrides));
}

function fileSha256(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function withReleaseContract(
  root: string,
  options: Omit<Parameters<typeof runPostDeployProductSmokeReportProducer>[0], 'releaseContractPath'>,
  releaseContract: {
    overrides?: Record<string, unknown>;
    name?: string;
  } = {},
): Parameters<typeof runPostDeployProductSmokeReportProducer>[0] {
  return {
    ...options,
    releaseContractPath: writeReleaseContract(
      root,
      releaseContract.overrides ?? {},
      releaseContract.name,
    ),
  };
}

function focusedEvidence(
  flow: ProductVerificationFlowId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const providerNeutralChecks = flow === 'chat_via_llmup'
    ? {
      provider_neutral_endpoint: {
        endpoint_type: 'custom',
        provider_family: 'custom',
        upstream_protocol: 'openai_chat_completions',
        credential_type: 'api_key',
        success_path: 'provider_neutral_endpoint',
      },
    }
    : {};

  return {
    schema_version: FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION,
    flow,
    status: 'passed',
    producer: PRODUCT_FLOWS_AGGREGATE_PRODUCER,
    command: `fixture:${flow}`,
    generated_at: '2026-05-07T00:00:00.000Z',
    duration_ms: 1,
    checks: providerNeutralChecks,
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
    const siteEnvPath = writeText(
      root,
      'site.env',
      [
        'UNIFIED_DEPLOY_PROFILE=local-kind',
        'PUBLIC_BASE_URL=http://agentsmith.localtest.me:29180',
        'PUBLIC_API_BASE_URL=http://agentsmith.localtest.me:29180/api/v1',
        'RUNNER_PUBLIC_API_BASE_URL=ws://agentsmith.localtest.me:29180/api/v1',
        '',
      ].join('\n'),
    );
    const substrateTruthPath = writeJson(root, 'substrate-truth.json', {
      schema_version: 'fixture.substrate-truth/v1',
      target: 'local-kind',
    });
    const aggregate = aggregateWithFlows();
    aggregate.source = {
      ...(aggregate.source as Record<string, unknown>),
      runner_public_api_base_url: 'ws://agentsmith.localtest.me:29180/api/v1',
      site_env_path: siteEnvPath,
      substrate_truth_path: substrateTruthPath,
    };
    const aggregatePath = writeJson(root, 'product-flows.json', aggregate);
    const releaseContractPath = writeReleaseContract(root);

    const result = await runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      releaseContractPath,
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
    expect(report.release_contract).toMatchObject({
      path: releaseContractPath,
      input_sha256: fileSha256(releaseContractPath),
      release_id: RELEASE_CONTRACT_RELEASE_ID,
      git_sha: RELEASE_CONTRACT_GIT_SHA,
    });
    expect(report.source).toMatchObject({
      product_flows_path: aggregatePath,
      product_flows_sha256: fileSha256(aggregatePath),
    });
    expect(report.deployment_target).toMatchObject({
      profile: 'local-kind',
      public_base_url: 'http://agentsmith.localtest.me:29180',
      api_base_url: 'http://agentsmith.localtest.me:29180/api/v1',
      runner_public_api_base_url: 'ws://agentsmith.localtest.me:29180/api/v1',
      site_env: {
        path: siteEnvPath,
        sha256: fileSha256(siteEnvPath),
      },
      substrate_truth: {
        path: substrateTruthPath,
        sha256: fileSha256(substrateTruthPath),
      },
    });
    const smokeResults = report.smoke_results as Record<string, unknown>;
    expect(Object.keys(smokeResults)).toContain('provider_neutral_endpoint');
    expect(Object.keys(smokeResults)).not.toContain('chat_via_llmup');
    expect(smokeResults.provider_neutral_endpoint).toMatchObject({
      source_flow: 'chat_via_llmup',
      source_evidence_path: join(root, 'chat_via_llmup.json'),
      source_evidence_sha256: fileSha256(join(root, 'chat_via_llmup.json')),
      status: 'passed',
      proof: {
        endpoint_type: 'custom',
        provider_family: 'custom',
        upstream_protocol: 'openai_chat_completions',
        credential_type: 'api_key',
        success_path: 'provider_neutral_endpoint',
      },
    });
    for (const smokeResult of Object.values(smokeResults) as Record<string, unknown>[]) {
      expect(smokeResult.source_evidence_path).toEqual(expect.stringMatching(root));
      expect(smokeResult.source_evidence_sha256).toEqual(fileSha256(smokeResult.source_evidence_path as string));
    }
  });

  it('serializes report paths relative to pathRoot using POSIX paths while reading absolute evidence', async () => {
    const campaignRoot = tempDir('post-deploy-product-smoke-campaign-');
    const productFlowsDir = join(campaignRoot, 'unified-deploy', 'product-flows');
    const outputDir = join(campaignRoot, 'post-deploy-product-smoke');
    writeFocusedEvidenceFiles(productFlowsDir);
    const aggregatePath = writeJson(productFlowsDir, 'aggregate.json', aggregateWithFlows());
    const releaseContractPath = writeReleaseContract(campaignRoot);

    const result = await runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      releaseContractPath,
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
    expect(report.release_contract).toMatchObject({
      path: 'release-contract/agentsmith-release-contract.json',
      input_sha256: fileSha256(releaseContractPath),
      release_id: RELEASE_CONTRACT_RELEASE_ID,
      git_sha: RELEASE_CONTRACT_GIT_SHA,
    });

    const smokeResults = report.smoke_results as Record<string, Record<string, unknown>>;
    expect(smokeResults.provider_neutral_endpoint).toMatchObject({
      source_flow: 'chat_via_llmup',
      source_evidence_path: 'unified-deploy/product-flows/chat_via_llmup.json',
      proof: {
        endpoint_type: 'custom',
        provider_family: 'custom',
        upstream_protocol: 'openai_chat_completions',
        credential_type: 'api_key',
        success_path: 'provider_neutral_endpoint',
      },
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
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(productFlowsRoot, {
      productFlowsPath: outsideAggregatePath,
      outputDir: outsideProductOutputDir,
      pathRoot: productFlowsRoot,
    }))).rejects.toThrow(/source\.product_flows_path must stay under --path-root/u);
    expect(existsSync(join(outsideProductOutputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);

    const reportRoot = tempDir('post-deploy-product-smoke-outside-report-root-');
    const reportProductFlowsDir = join(reportRoot, 'unified-deploy', 'product-flows');
    const outsideReportRoot = tempDir('post-deploy-product-smoke-outside-report-target-');
    writeFocusedEvidenceFiles(reportProductFlowsDir);
    const reportAggregatePath = writeJson(reportProductFlowsDir, 'aggregate.json', aggregateWithFlows());
    const outsideReportOutputDir = join(outsideReportRoot, 'post-deploy-product-smoke');
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(reportRoot, {
      productFlowsPath: reportAggregatePath,
      outputDir: outsideReportOutputDir,
      pathRoot: reportRoot,
    }))).rejects.toThrow(/paths\.report_path must stay under --path-root/u);
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
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(evidenceRoot, {
      productFlowsPath: evidenceAggregatePath,
      outputDir: evidenceOutputDir,
      pathRoot: evidenceRoot,
    }))).rejects.toThrow(/smoke_results\.files\.source_evidence_path must stay under --path-root/u);
    expect(existsSync(join(evidenceOutputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);
  });

  it('fails fast when the release contract is outside pathRoot', async () => {
    const root = tempDir('post-deploy-product-smoke-outside-release-contract-root-');
    const outsideRoot = tempDir('post-deploy-product-smoke-outside-release-contract-source-');
    const productFlowsDir = join(root, 'unified-deploy', 'product-flows');
    const outputDir = join(root, 'post-deploy-product-smoke');
    writeFocusedEvidenceFiles(productFlowsDir);
    const aggregatePath = writeJson(productFlowsDir, 'aggregate.json', aggregateWithFlows());
    const releaseContractPath = writeReleaseContract(outsideRoot);

    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      releaseContractPath,
      outputDir,
      pathRoot: root,
    })).rejects.toThrow(/release_contract\.path must stay under --path-root/u);
    expect(existsSync(join(outputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME))).toBe(false);
  });

  it('fails when releaseContractPath is missing or empty', async () => {
    const root = tempDir('post-deploy-product-smoke-missing-release-contract-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());
    const missingOptions = {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out-missing'),
    } as unknown as Parameters<typeof runPostDeployProductSmokeReportProducer>[0];

    await expect(runPostDeployProductSmokeReportProducer(missingOptions))
      .rejects.toThrow(/releaseContractPath is required/u);
    await expect(runPostDeployProductSmokeReportProducer({
      productFlowsPath: aggregatePath,
      releaseContractPath: '   ',
      outputDir: join(root, 'out-empty'),
    })).rejects.toThrow(/releaseContractPath is required/u);
  });

  it.each([
    [
      'schema_version',
      { schema_version: 'agentsmith.release-contract/v0' },
      /release_contract failed full release contract validation: .*schema_version: schema_version must be "agentsmith\.release-contract\/v1"/u,
    ],
    [
      'git_sha',
      { git_sha: '0123456789abcdef0123456789abcdef0123456Z' },
      /release_contract failed full release contract validation: .*git_sha: git_sha must be a 40-character lowercase git sha/u,
    ],
  ] as const)('fails when release contract %s is invalid', async (_field, overrides, expectedError) => {
    const root = tempDir('post-deploy-product-smoke-bad-release-contract-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    }, {
      overrides,
      name: 'bad-release-contract.json',
    }))).rejects.toThrow(expectedError);
  });

  it('fails when the full release contract validator rejects a non-top-level contract drift', async () => {
    const root = tempDir('post-deploy-product-smoke-full-release-contract-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    }, {
      overrides: {
        required_product_flows: PRODUCT_VERIFICATION_FLOW_IDS.filter((flow) => flow !== 'files'),
      },
      name: 'release-contract-missing-flow.json',
    }))).rejects.toThrow(
      /release_contract failed full release contract validation: .*required_product_flows: required product flow "files" is missing/u,
    );
  });

  it('fails when a required source flow is missing', async () => {
    const root = tempDir('post-deploy-product-smoke-missing-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(
      root,
      'product-flows.json',
      aggregateWithFlows(PRODUCT_VERIFICATION_FLOW_IDS.filter((flow) => flow !== 'files')),
    );

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(/missing required source flow: files/u);
  });

  it('fails fast for release-kit-shaped product-flow aggregate producers', async () => {
    const root = tempDir('post-deploy-product-smoke-release-kit-');
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate.producer = 'agentsmith-release-kit';
    const aggregatePath = writeJson(root, 'product-flows-release-kit.json', aggregate);

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(/producer must be unified-deploy-product-flows; release-kit producers are not accepted/u);
  });

  it('fails when provider_neutral_endpoint source evidence lacks provider-neutral endpoint proof', async () => {
    const root = tempDir('post-deploy-product-smoke-provider-neutral-proof-');
    writeFocusedEvidenceFiles(root, PRODUCT_VERIFICATION_FLOW_IDS, {
      chat_via_llmup: {
        checks: {
          provider_neutral_endpoint: {
            endpoint_type: 'catalog',
            provider_family: 'openai',
            upstream_protocol: 'openai_chat_completions',
            credential_type: 'oauth',
            success_path: 'provider_specific_saas',
            oauth_provider: 'openai',
          },
        },
      },
    });
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(
      /checks\.provider_neutral_endpoint must prove the provider-neutral Endpoint success path/u,
    );
  });

  it('fails when flow_evidence_paths is missing or omits a required source flow', async () => {
    const root = tempDir('post-deploy-product-smoke-missing-paths-');
    writeFocusedEvidenceFiles(root);

    const missingPaths = aggregateWithFlows();
    delete missingPaths.flow_evidence_paths;
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-no-paths.json', missingPaths),
      outputDir: join(root, 'out-no-paths'),
    }))).rejects.toThrow(/flow_evidence_paths must be an object/u);

    const missingFlowPath = aggregateWithFlows();
    delete (missingFlowPath.flow_evidence_paths as Record<string, unknown>).files;
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-missing-flow-path.json', missingFlowPath),
      outputDir: join(root, 'out-missing-flow-path'),
    }))).rejects.toThrow(/flow_evidence_paths\.files is required/u);
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
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-bad-schema.json', badSchema),
      outputDir: join(root, 'out-bad-schema'),
    }))).rejects.toThrow(/product_flows\.flows\.files\.schema_version must be agentsmith\.focused-product-flow\.evidence\/v1/u);

    const badProducer = aggregateWithFlows();
    const badProducerFlow = (badProducer.flows as Record<string, unknown>[])
      .find((flow) => flow.flow === 'usage');
    if (!badProducerFlow) {
      throw new Error('missing usage flow fixture');
    }
    badProducerFlow.producer = 'agentsmith-release-kit';
    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-bad-producer.json', badProducer),
      outputDir: join(root, 'out-bad-producer'),
    }))).rejects.toThrow(/product_flows\.flows\.usage\.producer must be unified-deploy-product-flows/u);
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

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-failed-flow.json', aggregate),
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(/product_flows\.flows\.files\.status must be passed/u);
  });

  it('fails when aggregate failures are non-empty', async () => {
    const root = tempDir('post-deploy-product-smoke-aggregate-failures-');
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate.failures = [{ path: 'flow:files', message: 'files failed' }];

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, 'product-flows-failures.json', aggregate),
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(/failures must be empty/u);
  });

  it.each([
    ['schema_version', 'agentsmith.unified-deploy.product-flows.aggregate/v0', /product_flows\.schema_version must be agentsmith\.unified-deploy\.product-flows\.aggregate\/v1/u],
    ['status', 'failed', /product_flows\.status must be passed/u],
  ] as const)('fails when aggregate %s is unsupported', async (field, value, expectedError) => {
    const root = tempDir(`post-deploy-product-smoke-bad-aggregate-${field}-`);
    writeFocusedEvidenceFiles(root);
    const aggregate = aggregateWithFlows();
    aggregate[field] = value;

    await expect(runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: writeJson(root, `product-flows-bad-${field}.json`, aggregate),
      outputDir: join(root, 'out'),
    }))).rejects.toThrow(expectedError);
  });

  it('does not emit formal_verdict or legacy top-level release binding fields', async () => {
    const root = tempDir('post-deploy-product-smoke-no-verdict-');
    writeFocusedEvidenceFiles(root);
    const aggregatePath = writeJson(root, 'product-flows.json', aggregateWithFlows());

    const result = await runPostDeployProductSmokeReportProducer(withReleaseContract(root, {
      productFlowsPath: aggregatePath,
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    }));

    expect(result.report).not.toHaveProperty('formal_verdict');
    expect(result.report.source.product_flows_sha256).toBe(fileSha256(aggregatePath));
    expect(result.report.deployment_target).toMatchObject({
      public_base_url: 'http://agentsmith.localtest.me:29180',
      api_base_url: 'http://agentsmith.localtest.me:29180/api/v1',
    });
    expect(result.report.deployment_target).not.toHaveProperty('site_env');
    expect(result.report.deployment_target).not.toHaveProperty('substrate_truth');
    const report = readReport(result.reportPath);
    expect(report).not.toHaveProperty('formal_verdict');
    for (const legacyField of [
      'release_id',
      'git_sha',
      'release_contract_digest',
      'artifact_provenance',
      'covered_flows',
    ]) {
      expect(result.report).not.toHaveProperty(legacyField);
      expect(report).not.toHaveProperty(legacyField);
    }
  });
});
