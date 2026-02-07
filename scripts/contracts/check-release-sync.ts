import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const REQUIRED_ACTIVE_FILES = [
  'docs/contracts/README.md',
  'docs/contracts/auth-permission-model.md',
  'docs/contracts/frontend-backend-gating-matrix.md',
  'docs/contracts/frontend-mvp-role-governance-requirements.md',
  'docs/contracts/frontend-token-interaction-contract.md',
  'docs/contracts/route-gate-test-checklist.md',
];

function toAbs(p: string): string {
  return path.join(ROOT, p);
}

function readNormalized(filePath: string): string {
  return fs.readFileSync(toAbs(filePath), 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

function collectMarkdownFiles(dir: string): string[] {
  const abs = toAbs(dir);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(path.relative(ROOT, full)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.relative(ROOT, full).replaceAll(path.sep, '/'));
    }
  }
  return files.sort();
}

function main(): void {
  let hasErrors = false;

  console.log('Contract Consistency Check');
  console.log('='.repeat(80));

  for (const file of REQUIRED_ACTIVE_FILES) {
    if (!fs.existsSync(toAbs(file))) {
      hasErrors = true;
      console.error(`Missing required contract file: ${file}`);
    }
  }

  const contractFiles = collectMarkdownFiles('docs/contracts');
  const legacyRefs: Array<{ file: string; marker: string }> = [];
  for (const file of contractFiles) {
    const text = readNormalized(file);
    if (text.includes('releases/v1.1') || text.includes('v1.1')) {
      legacyRefs.push({ file, marker: 'v1.1' });
    }
    if (text.includes('releases/v1/')) {
      legacyRefs.push({ file, marker: 'releases/v1/' });
    }
  }

  if (legacyRefs.length > 0) {
    hasErrors = true;
    console.error('\nLegacy release references detected:');
    for (const item of legacyRefs) {
      console.error(`  - ${item.file}: ${item.marker}`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log('\nContracts are clean and aligned with active baseline.');
}

main();
