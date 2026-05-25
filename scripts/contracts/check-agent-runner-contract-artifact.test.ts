import { describe, expect, it } from 'vitest';

import { validatePackFileList } from './check-agent-runner-contract-artifact';

const expectedPackFiles = [
  'contract-artifact.json',
  'dist/artifact.d.ts',
  'dist/artifact.js',
  'dist/contract-schema.d.ts',
  'dist/contract-schema.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/protocol.d.ts',
  'dist/protocol.js',
  'dist/runner-spec.d.ts',
  'dist/runner-spec.js',
  'package.json',
] as const;

describe('check-agent-runner-contract-artifact', () => {
  it('accepts only the expected pack artifact files', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles], errors);

    expect(errors).toEqual([]);
  });

  it('rejects stale dist files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'dist/stale.js'], errors);

    expect(errors).toContain('pack tarball contains unexpected artifact file: dist/stale.js');
  });

  it('rejects source files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'src/index.ts'], errors);

    expect(errors).toContain('pack tarball must not include source tests or source files: src/index.ts');
    expect(errors).toContain('pack tarball contains unexpected artifact file: src/index.ts');
  });

  it('rejects test files from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([...expectedPackFiles, 'dist/index.test.js'], errors);

    expect(errors).toContain('pack tarball must not include source tests or source files: dist/index.test.js');
    expect(errors).toContain('pack tarball contains unexpected artifact file: dist/index.test.js');
  });

  it('rejects local and sibling paths from the pack artifact boundary', () => {
    const errors: string[] = [];

    validatePackFileList([
      ...expectedPackFiles,
      '/home/percy/works/mbos-v1/agentsmith/packages/agent-runner-contract/dist/index.js',
      '../agentsmith-runner/dist/index.js',
    ], errors);

    expect(errors).toContain(
      'pack tarball must not include workspace/local/sibling paths: /home/percy/works/mbos-v1/agentsmith/packages/agent-runner-contract/dist/index.js',
    );
    expect(errors).toContain(
      'pack tarball must not include workspace/local/sibling paths: ../agentsmith-runner/dist/index.js',
    );
  });
});
