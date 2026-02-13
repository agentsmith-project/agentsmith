import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTypes } from './generate-types';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');

async function main(): Promise<void> {
  const input = process.argv[2] ?? 'docs/contracts/specs/openapi.yaml';
  const output = process.argv[3] ?? 'src/lib/api/types.generated.ts';

  const generated = await generateTypes({ input, outputPath: output });
  const targetPath = path.resolve(REPO_ROOT, generated.outputPath);
  const existing = await readFile(targetPath, 'utf-8');

  if (existing !== generated.content) {
    process.stderr.write(
      '[openapi] generated types are out of date. Run: npm run openapi:generate\n',
    );
    process.exit(1);
  }

  process.stdout.write('[openapi] generated types are in sync.\n');
}

void main();
