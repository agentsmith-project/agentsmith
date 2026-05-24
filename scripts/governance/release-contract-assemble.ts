import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  canonicalReleaseBoundaryJson,
  type CurrentAgentSmithReleaseContract,
} from './current-release-boundary-schema';
import { generateAgentSmithReleaseContract } from './release-contract';
import {
  assembleReleaseContractGeneratorInput,
  type AgentSmithReleaseContractGeneratorInputAssemblyInput,
} from './release-contract-input';

const DEFAULT_OUTPUT_NAME = 'agentsmith-release-contract.json';

interface ReleaseContractAssembleCliOptions {
  argv?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface ReleaseContractAssembleCliConfig {
  inputPath: string;
  outputPath: string;
  explicitSourceGitSha?: string;
}

interface AgentSmithReleaseContractAssemblyOptions {
  sourceGitSha: string;
}

export function assembleAgentSmithReleaseContractFromInput(
  input: AgentSmithReleaseContractGeneratorInputAssemblyInput,
  options: AgentSmithReleaseContractAssemblyOptions,
): CurrentAgentSmithReleaseContract {
  const sourceGitSha = requireNonEmptyString(options.sourceGitSha, 'sourceGitSha');
  const generatorInput = assembleReleaseContractGeneratorInput({
    ...input,
    sourceGitSha,
  });
  return generateAgentSmithReleaseContract(generatorInput, {
    sourceGitSha,
  });
}

export function runReleaseContractAssembleCli(options: ReleaseContractAssembleCliOptions = {}): number {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));
  let outputPath: string | undefined;

  try {
    const config = parseCliArgs(argv, cwd);
    outputPath = config.outputPath;
    const sourceGitSha = resolveCliSourceGitSha(config.explicitSourceGitSha, env);
    const input = readInput(config.inputPath);
    const contract = assembleAgentSmithReleaseContractFromInput(input, { sourceGitSha });
    writeJsonAtomically(config.outputPath, contract);
    stdout(`release contract: ${config.outputPath}`);
    return 0;
  } catch (error) {
    if (outputPath) {
      rmSync(outputPath, { force: true });
    }
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function readInput(inputPath: string): AgentSmithReleaseContractGeneratorInputAssemblyInput {
  return JSON.parse(readFileSync(inputPath, 'utf8')) as AgentSmithReleaseContractGeneratorInputAssemblyInput;
}

function parseCliArgs(argv: readonly string[], cwd: string): ReleaseContractAssembleCliConfig {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  let explicitSourceGitSha: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--input':
        inputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--output':
        outputPath = requireArgValue(argv, index);
        index += 1;
        break;
      case '--source-git-sha':
        explicitSourceGitSha = requireArgValue(argv, index);
        index += 1;
        break;
      default:
        throw new Error(`unsupported release contract assembly argument: ${arg}`);
    }
  }

  if (!inputPath) {
    throw new Error('--input is required.');
  }

  return {
    inputPath: path.resolve(cwd, inputPath),
    outputPath: path.resolve(cwd, outputPath ?? DEFAULT_OUTPUT_NAME),
    explicitSourceGitSha,
  };
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
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

function resolveCliSourceGitSha(
  explicitSourceGitSha: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const envSourceGitSha = firstNonEmptyString(
    explicitSourceGitSha,
    env.AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA,
    env.GITHUB_SHA,
  );
  if (envSourceGitSha) {
    return envSourceGitSha;
  }

  try {
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    return requireNonEmptyString(gitSha, 'sourceGitSha');
  } catch {
    throw new Error(
      'sourceGitSha is required; pass --source-git-sha or set AGENTSMITH_RELEASE_CONTRACT_SOURCE_GIT_SHA or GITHUB_SHA.',
    );
  }
}

function firstNonEmptyString(...values: readonly (string | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runReleaseContractAssembleCli());
}
