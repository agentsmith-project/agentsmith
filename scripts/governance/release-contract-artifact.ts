import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENTSMITH_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  type CurrentArtifactProvenance,
} from './current-release-boundary-schema';
import {
  assembleAgentSmithReleaseContractFromInput,
} from './release-contract-assemble';
import type {
  AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from './release-contract-input';
import type {
  AgentSmithReleaseContractCiProvenanceInput,
} from './release-contract';

export const RELEASE_CONTRACT_ARTIFACT_NAME = 'agentsmith-release-contract.json' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_COMMAND = 'npm run release:contract:ci-artifact' as const;
export const RELEASE_CONTRACT_ARTIFACT_GENERATOR_VERSION = 'p1.1-release-contract-artifact' as const;

const DEFAULT_OUTPUT_DIR = 'artifacts/release-contract';
const PRODUCER_OWNED_INPUT_FIELDS = ['sourceGitSha', 'ci_provenance'] as const;

interface ReleaseContractArtifactCliOptions {
  argv?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface ReleaseContractArtifactCliConfig {
  inputPath: string;
  outputDir: string;
}

interface GitHubCiProvenanceEnv {
  commitSha: string;
  repositorySlug: string;
  canonicalRepo: typeof AGENTSMITH_CANONICAL_REPO;
  workflowName: string;
  runId: string;
  runAttempt: string;
  job: string;
  generatedAt: string;
}

type ReleaseContractArtifactProducerInput = Omit<
  AgentSmithReleaseContractGeneratorInputAssemblyInput,
  'sourceGitSha' | 'ci_provenance'
> & Partial<Pick<AgentSmithReleaseContractGeneratorInputAssemblyInput, 'sourceGitSha' | 'ci_provenance'>>;

export function runReleaseContractArtifactCli(options: ReleaseContractArtifactCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));
  let outputPath: string | undefined;

  try {
    const config = parseCliArgs(argv, cwd);
    outputPath = path.join(config.outputDir, RELEASE_CONTRACT_ARTIFACT_NAME);
    const input = readInput(config.inputPath);
    assertNoProducerOwnedInputFields(input);
    const ciEnv = resolveGitHubCiProvenanceEnv(env);
    const ciProvenance = buildCiProvenance(ciEnv);
    const contract = assembleAgentSmithReleaseContractFromInput(
      {
        ...input,
        sourceGitSha: ciEnv.commitSha,
        ci_provenance: ciProvenance,
      },
      {
        sourceGitSha: ciEnv.commitSha,
      },
    );

    writeJsonAtomically(outputPath, contract);
    stdout(`release contract artifact: ${outputPath}`);
    return 0;
  } catch (error) {
    if (outputPath) {
      rmSync(outputPath, { force: true });
    }
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readInput(inputPath: string): ReleaseContractArtifactProducerInput {
  return JSON.parse(readFileSync(inputPath, 'utf8')) as ReleaseContractArtifactProducerInput;
}

function parseCliArgs(argv: readonly string[], cwd: string): ReleaseContractArtifactCliConfig {
  let inputPath: string | undefined;
  let outputDir: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        inputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--output-dir':
        outputDir = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported release contract artifact argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error('--input is required.');
  }

  return {
    inputPath: path.resolve(cwd, inputPath),
    outputDir: path.resolve(cwd, outputDir ?? DEFAULT_OUTPUT_DIR),
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--') || value.trim().length === 0) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function assertNoProducerOwnedInputFields(input: ReleaseContractArtifactProducerInput): void {
  if (!isRecord(input)) {
    throw new Error('release contract artifact input must be an object.');
  }

  const failures: string[] = [];
  for (const field of PRODUCER_OWNED_INPUT_FIELDS) {
    if (Object.hasOwn(input, field)) {
      failures.push(`${field} must be provided by GitHub CI env.`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

function resolveGitHubCiProvenanceEnv(
  env: Readonly<Record<string, string | undefined>>,
): GitHubCiProvenanceEnv {
  const repositorySlug = requireEnvString(env, 'GITHUB_REPOSITORY');
  const canonicalRepo = `github.com/${repositorySlug}`;
  if (canonicalRepo !== AGENTSMITH_CANONICAL_REPO) {
    throw new Error(`GITHUB_REPOSITORY must be agentsmith-project/agentsmith.`);
  }

  return {
    commitSha: requireEnvString(env, 'GITHUB_SHA'),
    repositorySlug,
    canonicalRepo,
    workflowName: requireEnvString(env, 'GITHUB_WORKFLOW'),
    runId: requireEnvString(env, 'GITHUB_RUN_ID'),
    runAttempt: requireEnvString(env, 'GITHUB_RUN_ATTEMPT'),
    job: requireEnvString(env, 'GITHUB_JOB'),
    generatedAt: firstNonEmptyString(env.AGENTSMITH_RELEASE_CONTRACT_GENERATED_AT) ?? new Date().toISOString(),
  };
}

function buildCiProvenance(env: GitHubCiProvenanceEnv): AgentSmithReleaseContractCiProvenanceInput {
  return {
    producer_repo: env.canonicalRepo,
    normalized_remote: env.canonicalRepo,
    commit_sha: env.commitSha,
    subject_uri: RELEASE_CONTRACT_ARTIFACT_NAME,
    workflow_name: env.workflowName,
    run_id: env.runId,
    run_attempt: env.runAttempt,
    job: env.job,
    artifact_uri: `gh-artifact://${env.repositorySlug}/release-contract/${env.runId}/${RELEASE_CONTRACT_ARTIFACT_NAME}`,
    generated_at: env.generatedAt,
    generator_command: RELEASE_CONTRACT_ARTIFACT_GENERATOR_COMMAND,
    generator_version: RELEASE_CONTRACT_ARTIFACT_GENERATOR_VERSION,
    attestation: 'none' satisfies CurrentArtifactProvenance['attestation'],
  };
}

function requireEnvString(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = firstNonEmptyString(env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function firstNonEmptyString(value: string | undefined): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function writeJsonAtomically(outputPath: string, value: unknown): void {
  const outputDir = path.dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  const tempPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.tmp`);

  try {
    writeFileSync(tempPath, `${canonicalReleaseBoundaryJson(value)}\n`);
    renameSync(tempPath, outputPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseContractArtifactCli());
}
