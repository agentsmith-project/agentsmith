import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { checkUnifiedDeployManifest } from './manifest';

import { checkUnifiedDeployManifest } from './manifest';
import { writeProducerEvidence } from './evidence';

function parseManifestPath(argv: readonly string[]): string | undefined {
  const manifestArg = argv.find((arg) => arg.startsWith('--manifest='));
  return manifestArg?.slice('--manifest='.length);
}

async function main(): Promise<void> {
  const result = checkUnifiedDeployManifest({ manifestPath: parseManifestPath(process.argv.slice(2)) });

  if (!result.ok) {
    const evidence = await writeProducerEvidence({
      producer: 'manifest',
      status: 'failed',
      failures: result.failures,
    });
    process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n`);
    process.stderr.write(`[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
    process.exitCode = 1;
    return;
  }

  const evidence = await writeProducerEvidence({
    producer: 'manifest',
    status: 'passed',
    failures: [],
  });

  process.stdout.write(`[unified-deploy] manifest check passed\n[unified-deploy] evidence: ${evidence.paths.report_path}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
