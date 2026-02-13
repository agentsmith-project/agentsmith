import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

function loadCurrent(): OpenApiDoc {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../..');
  const currentPath = path.join(repoRoot, 'docs', 'contracts', 'specs', 'openapi.json');
  return JSON.parse(readFileSync(currentPath, 'utf-8')) as OpenApiDoc;
}

function loadBaseFromGit(): OpenApiDoc | null {
  try {
    execSync('git rev-parse --verify origin/main', {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return null;
  }

  try {
    const raw = execSync('git show origin/main:docs/contracts/specs/openapi.json', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return JSON.parse(raw) as OpenApiDoc;
  } catch {
    // Baseline branch exists but has no OpenAPI spec yet.
    return {};
  }
}

function operationKeys(doc: OpenApiDoc): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(pathItem ?? {})) {
      keys.add(`${method.toLowerCase()} ${apiPath}`);
    }
  }
  return keys;
}

function responseKeys(
  doc: OpenApiDoc,
): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      for (const status of Object.keys(operation.responses ?? {})) {
        keys.add(`${method.toLowerCase()} ${apiPath} -> ${status}`);
      }
    }
  }
  return keys;
}

function main(): void {
  const base = loadBaseFromGit();
  if (!base) {
    const strictMode = process.env.CI === 'true' || process.env.OPENAPI_BREAKING_STRICT === 'true';
    if (strictMode) {
      process.stderr.write(
        '[contracts] OpenAPI breaking check failed: origin/main baseline not available in strict mode.\n',
      );
      process.exit(1);
    }
    process.stdout.write('[contracts] Skipped OpenAPI breaking check (origin/main spec not available).\n');
    return;
  }

  const current = loadCurrent();
  const currentOps = operationKeys(current);
  const currentResponses = responseKeys(current);

  const removedOps = Array.from(operationKeys(base)).filter((op) => !currentOps.has(op));
  const removedResponses = Array.from(responseKeys(base)).filter((key) => !currentResponses.has(key));

  if (removedOps.length === 0 && removedResponses.length === 0) {
    process.stdout.write('[contracts] OpenAPI breaking check passed.\n');
    return;
  }

  process.stderr.write('[contracts] OpenAPI breaking check failed. Removed contract surface detected.\n');
  if (removedOps.length > 0) {
    process.stderr.write('Removed operations:\n');
    for (const op of removedOps) process.stderr.write(`- ${op}\n`);
  }
  if (removedResponses.length > 0) {
    process.stderr.write('Removed responses:\n');
    for (const response of removedResponses) process.stderr.write(`- ${response}\n`);
  }
  process.exit(1);
}

main();
