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

export function renderSpecJsonFromYaml(yamlSource: string): string {
  const spec = YAML.parse(yamlSource) as unknown;
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export async function syncSpecJson(input: string, output: string): Promise<{
  inputPath: string;
  outputPath: string;
}> {
  const inputPath = resolveRepoPath(input);
  const outputPath = resolveRepoPath(output);
  const yaml = await readFile(inputPath, 'utf-8');
  await writeFile(outputPath, renderSpecJsonFromYaml(yaml), 'utf-8');
  return { inputPath, outputPath };
}

async function main(): Promise<void> {
  const { inputPath, outputPath } = await syncSpecJson(
    process.argv[2] ?? 'docs/contracts/specs/openapi.yaml',
    process.argv[3] ?? 'docs/contracts/specs/openapi.json',
  );
  process.stdout.write(`[contracts] generated ${path.relative(REPO_ROOT, outputPath)} from ${path.relative(REPO_ROOT, inputPath)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
