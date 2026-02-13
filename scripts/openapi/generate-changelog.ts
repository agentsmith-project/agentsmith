import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

type DiffSummary = {
  addedOperations: string[];
  removedOperations: string[];
  addedResponses: string[];
  removedResponses: string[];
};

function getRepoRoot(): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, '../..');
}

function loadCurrentSpec(repoRoot: string): OpenApiDoc {
  return JSON.parse(
    readFileSync(path.join(repoRoot, 'docs/contracts/specs/openapi.json'), 'utf-8'),
  ) as OpenApiDoc;
}

function loadBaseSpecFromOriginMain(): OpenApiDoc | null {
  try {
    const raw = execSync('git show origin/main:docs/contracts/specs/openapi.json', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return JSON.parse(raw) as OpenApiDoc;
  } catch {
    return null;
  }
}

function collectOperationKeys(doc: OpenApiDoc): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(pathItem ?? {})) {
      keys.add(`${method.toUpperCase()} ${apiPath}`);
    }
  }
  return keys;
}

function collectResponseKeys(doc: OpenApiDoc): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      for (const status of Object.keys(operation.responses ?? {})) {
        keys.add(`${method.toUpperCase()} ${apiPath} -> ${status}`);
      }
    }
  }
  return keys;
}

function summarizeDiff(base: OpenApiDoc, current: OpenApiDoc): DiffSummary {
  const baseOps = collectOperationKeys(base);
  const currentOps = collectOperationKeys(current);
  const baseResponses = collectResponseKeys(base);
  const currentResponses = collectResponseKeys(current);

  return {
    addedOperations: Array.from(currentOps).filter((k) => !baseOps.has(k)).sort(),
    removedOperations: Array.from(baseOps).filter((k) => !currentOps.has(k)).sort(),
    addedResponses: Array.from(currentResponses).filter((k) => !baseResponses.has(k)).sort(),
    removedResponses: Array.from(baseResponses).filter((k) => !currentResponses.has(k)).sort(),
  };
}

function toMarkdown(summary: DiffSummary): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push('# OpenAPI Changelog');
  lines.push('');
  lines.push(`Last generated: ${today}`);
  lines.push('Baseline: `origin/main`');
  lines.push('');

  function section(title: string, items: string[]): void {
    lines.push(`## ${title}`);
    if (items.length === 0) {
      lines.push('- none');
    } else {
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');
  }

  section('Added Operations', summary.addedOperations);
  section('Removed Operations', summary.removedOperations);
  section('Added Responses', summary.addedResponses);
  section('Removed Responses', summary.removedResponses);

  return lines.join('\n');
}

function main(): void {
  const repoRoot = getRepoRoot();
  const current = loadCurrentSpec(repoRoot);
  const base = loadBaseSpecFromOriginMain();
  const outputPath = path.join(repoRoot, 'docs/contracts/specs/CHANGELOG.md');

  if (!base) {
    const fallback = '# OpenAPI Changelog\n\nBaseline `origin/main` is not available locally.\n';
    writeFileSync(outputPath, fallback, 'utf-8');
    process.stdout.write('[openapi] wrote fallback changelog (no origin/main baseline).\n');
    return;
  }

  const summary = summarizeDiff(base, current);
  writeFileSync(outputPath, toMarkdown(summary), 'utf-8');
  process.stdout.write('[openapi] wrote docs/contracts/specs/CHANGELOG.md\n');
}

main();

