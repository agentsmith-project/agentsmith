import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CURRENT_AFSCP_IMAGE_SOURCE_LOCK_SPEC,
  CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC,
  validateProviderImageSourceLockText,
} from './check-current-build-artifact-broker';

const LLMUP_VALID_LOCK = [
  'llmup_version=v0.2.44',
  'llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.44@sha256:187394a51950148d696edd5e2d558d835d4238415060b2d5f6a23ea58e620976',
  'llmup_release_url=https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44',
  'llmup_commit_sha=9c8208d3a12e8070c4edb0ee07469d023cfe38ad',
  '',
].join('\n');

describe('check-current-build-artifact-broker contract', () => {
  it('validates the current pure build broker schema contract without Docker or registry access', () => {
    const tsxCli = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

    expect(() =>
      execFileSync(tsxCli, ['scripts/contracts/check-current-build-artifact-broker.ts'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('accepts provider image source locks with release URL and tag commit freshness fields', () => {
    const afscpLock = [
      'afscp_version=v1.0.8',
      'afscp_source_image=ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.8@sha256:a059b2e4e2549a1ea4efdeda5bc5e0f606750065ad9b7fd86abf581a2d274511',
      'afscp_release_url=https://github.com/agentsmith-project/agentsmith-fs-control-plane/releases/tag/v1.0.8',
      'afscp_commit_sha=31da1e82a3e6e4593811d96502d9d57530f57664',
      '',
    ].join('\n');

    expect(validateProviderImageSourceLockText(LLMUP_VALID_LOCK, CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC)).toEqual([]);
    expect(validateProviderImageSourceLockText(afscpLock, CURRENT_AFSCP_IMAGE_SOURCE_LOCK_SPEC)).toEqual([]);
  });

  it('fails provider image source locks that omit release URL or commit sha', () => {
    const failures = validateProviderImageSourceLockText(
      [
        'llmup_version=v0.2.44',
        'llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.44@sha256:187394a51950148d696edd5e2d558d835d4238415060b2d5f6a23ea58e620976',
        '',
      ].join('\n'),
      CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC,
    );

    expect(failures).toContain('llmup_release_url must be present in shared image lock.');
    expect(failures).toContain('llmup_commit_sha must be present in shared image lock.');
  });

  it('fails provider image source locks with malformed non-comment lines', () => {
    const failures = validateProviderImageSourceLockText(
      LLMUP_VALID_LOCK.replace(
        'llmup_release_url=https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44',
        'llmup_release_url https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44',
      ),
      CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC,
    );

    expect(failures).toEqual(['llmup provider image source lock line 3 must be key=value.']);
  });

  it('fails provider image source locks with duplicate keys', () => {
    const failures = validateProviderImageSourceLockText(
      [
        'llmup_version=v0.2.44',
        'llmup_version=v0.2.43',
        'llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.44@sha256:187394a51950148d696edd5e2d558d835d4238415060b2d5f6a23ea58e620976',
        'llmup_release_url=https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44',
        'llmup_commit_sha=9c8208d3a12e8070c4edb0ee07469d023cfe38ad',
        '',
      ].join('\n'),
      CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC,
    );

    expect(failures).toEqual(['llmup provider image source lock line 2 must not duplicate llmup_version.']);
  });

  it('fails provider image source locks when release URL, tag, or digest-pinned source image drifts', () => {
    const failures = validateProviderImageSourceLockText(
      LLMUP_VALID_LOCK
        .replace(
          'llmup_release_url=https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44',
          'llmup_release_url=https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.43',
        )
        .replace(
          'llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.44@sha256:187394a51950148d696edd5e2d558d835d4238415060b2d5f6a23ea58e620976',
          'llmup_source_image=ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.43',
        ),
      CURRENT_LLMUP_IMAGE_SOURCE_LOCK_SPEC,
    );

    expect(failures).toContain(
      'llmup_release_url must match llmup_version; expected https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.44; actual https://github.com/agentsmith-project/llm-universal-proxy/releases/tag/v0.2.43.',
    );
    expect(failures).toContain('llmup_source_image failed validation: image ref must include a sha256 digest.');
  });
});
