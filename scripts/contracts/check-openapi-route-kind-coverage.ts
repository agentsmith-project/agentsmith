import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
};

type RouteMap = Record<string, { path: string; method: string }>;

function loadFile(relativePath: string): string {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../..');
  return readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

function extractRouteKinds(contents: string): Set<string> {
  const kinds = new Set<string>();
  const re = /kind:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(contents))) {
    kinds.add(m[1]);
  }
  return kinds;
}

function main(): void {
  const projectsMatcher = loadFile('packages/api-entry-node/src/projects-route-match.ts');
  const chatMatcher = loadFile('packages/api-entry-node/src/chat-route-match.ts');
  const map = JSON.parse(loadFile('docs/contracts/specs/openapi-route-kind-map.json')) as RouteMap;
  const openApi = JSON.parse(loadFile('docs/contracts/specs/openapi.json')) as OpenApiDoc;

  const kinds = new Set<string>([
    ...extractRouteKinds(projectsMatcher),
    ...extractRouteKinds(chatMatcher),
  ]);

  const missingMap = Array.from(kinds).filter((kind) => !map[kind]);
  const staleMap = Object.keys(map).filter((kind) => !kinds.has(kind));
  const missingOpenApi = Object.entries(map).filter(([_, target]) => {
    const pathItem = openApi.paths?.[target.path];
    if (!pathItem) return true;
    return !Object.prototype.hasOwnProperty.call(pathItem, target.method.toLowerCase());
  });

  if (missingMap.length === 0 && staleMap.length === 0 && missingOpenApi.length === 0) {
    process.stdout.write('[contracts] OpenAPI route-kind coverage check passed.\n');
    return;
  }

  process.stderr.write('[contracts] OpenAPI route-kind coverage check failed.\n');

  if (missingMap.length > 0) {
    process.stderr.write('Missing kind mapping:\n');
    for (const kind of missingMap.sort()) process.stderr.write(`- ${kind}\n`);
  }
  if (staleMap.length > 0) {
    process.stderr.write('Stale kind mapping (kind no longer exists):\n');
    for (const kind of staleMap.sort()) process.stderr.write(`- ${kind}\n`);
  }
  if (missingOpenApi.length > 0) {
    process.stderr.write('Mapped kind missing in OpenAPI (path/method):\n');
    for (const [kind, target] of missingOpenApi.sort(([a], [b]) => a.localeCompare(b))) {
      process.stderr.write(`- ${kind}: ${target.method.toUpperCase()} ${target.path}\n`);
    }
  }
  process.exit(1);
}

main();
