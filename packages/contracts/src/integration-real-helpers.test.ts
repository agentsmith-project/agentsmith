import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type BoundaryViolation = {
  file: string;
  specifier: string;
  reason: string;
};

const contractsSrcDir = path.dirname(fileURLToPath(import.meta.url));
const contractsPackageDir = path.resolve(contractsSrcDir, '..');

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat();
}

function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const moduleSpecifierPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(moduleSpecifierPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isOutsidePackage(filePath: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolved = path.resolve(path.dirname(filePath), specifier);
  const relative = path.relative(contractsPackageDir, resolved);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

describe('contracts package boundaries', () => {
  it('does not import frontend aliases or repository-local files outside the package', async () => {
    const files = await collectTypeScriptFiles(contractsSrcDir);
    const violations: BoundaryViolation[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of extractModuleSpecifiers(source)) {
        if (specifier.startsWith('@/')) {
          violations.push({
            file: path.relative(contractsPackageDir, file),
            specifier,
            reason: 'frontend alias import',
          });
          continue;
        }

        if (isOutsidePackage(file, specifier)) {
          violations.push({
            file: path.relative(contractsPackageDir, file),
            specifier,
            reason: 'relative import outside @mbos/contracts',
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
