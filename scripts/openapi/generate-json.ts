import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');

function resolveRepoPath(targetPath: string): string {
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.resolve(REPO_ROOT, targetPath);
}

async function main(): Promise<void> {
  const inputPath = resolveRepoPath(process.argv[2] ?? 'docs/contracts/specs/openapi.yaml');
  const outputPath = resolveRepoPath(process.argv[3] ?? 'docs/contracts/specs/openapi.json');
  const yaml = await readFile(inputPath, 'utf-8');
  const spec = YAML.parse(yaml) as unknown;
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf-8');
  process.stdout.write(`[openapi] generated ${path.relative(REPO_ROOT, outputPath)} from ${path.relative(REPO_ROOT, inputPath)}\n`);
}

void main();
