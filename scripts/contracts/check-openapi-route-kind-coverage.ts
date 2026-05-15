import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
};

type RouteMapEntry = {
  path: string;
  method?: string;
  methods?: string[];
};

type RouteMap = Record<string, RouteMapEntry>;

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
  const missingOpenApi = Object.entries(map).flatMap(([kind, target]) => {
    const pathItem = openApi.paths?.[target.path];
    const methods = target.methods ?? (target.method ? [target.method] : []);
    if (!pathItem || methods.length === 0) return [{ kind, target, method: target.method ?? target.methods?.join(',') ?? '' }];
    return methods
      .filter((method) => !Object.prototype.hasOwnProperty.call(pathItem, method.toLowerCase()))
      .map((method) => ({ kind, target, method }));
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
    for (const item of missingOpenApi.sort((a, b) => a.kind.localeCompare(b.kind))) {
      process.stderr.write(`- ${item.kind}: ${item.method.toUpperCase()} ${item.target.path}\n`);
    }
  }
  process.exit(1);
}

main();
