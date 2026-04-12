import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HELPER_PATH = 'scripts/lib/release-story-verify-source-set.sh';

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

function readJson(relativePath: string): unknown {
  return JSON.parse(read(relativePath)) as unknown;
}

function listReleaseStoryVerifySources(): string[] {
  const output = execFileSync(
    'bash',
    ['-lc', `source "${HELPER_PATH}" && release_story_verify_source_set "${process.cwd()}"`],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
  return output
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
}

describe('release story verify source set', () => {
  it('declares the full release story contract family and committed story files', () => {
    const sources = listReleaseStoryVerifySources();

    expect(sources).toEqual(
      expect.arrayContaining([
        'e2e/integration-release-user-story.spec.ts',
        'e2e/release-user-story.contract.ts',
        'e2e/story-contract.ts',
        'e2e/story-generated-spec.ts',
        'e2e/story-loader.ts',
        'e2e/story-trace-binding.ts',
        'e2e/generated/story-specs.generated.json',
        'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
        'e2e/stories/backend-real/real-backend-visual-review.story.md',
      ]),
    );
  });

  it('keeps demo and cluster bundle manifests aligned with the shared source set', () => {
    const sources = listReleaseStoryVerifySources();
    const demoManifest = readJson('infra/deploy/demo/deployment.manifest.json') as { bundle_files?: string[] };
    const clusterManifest = readJson('infra/deploy/cluster/deployment.manifest.json') as { bundle_files?: string[] };

    expect(demoManifest.bundle_files).toEqual(expect.arrayContaining(sources));
    expect(clusterManifest.bundle_files).toEqual(expect.arrayContaining(sources));
  });

  it('makes demo and cluster build/verify scripts consume the shared source set helper instead of a spec-only copy', () => {
    const demoBuild = read('scripts/demo-deploy/build-offline-bundle.sh');
    const clusterBuild = read('scripts/cluster-deploy/build-bundle.sh');
    const demoVerify = read('scripts/demo-deploy/verify.sh');
    const clusterVerify = read('scripts/cluster-deploy/verify.sh');

    for (const script of [demoBuild, clusterBuild, demoVerify, clusterVerify]) {
      expect(script).toContain('source "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh"');
      expect(script).toContain('release_story_verify_source_set');
    }

    expect(demoBuild).not.toContain('copy_bundle_file "${ROOT_DIR}/e2e/integration-release-user-story.spec.ts"');
    expect(clusterBuild).not.toContain('copy_bundle_file "${ROOT_DIR}/e2e/integration-release-user-story.spec.ts"');
    expect(demoVerify).not.toContain('VERIFY_INTEGRATION_RELEASE_USER_STORY_SPEC=');
    expect(clusterVerify).not.toContain('VERIFY_INTEGRATION_RELEASE_USER_STORY_SPEC=');
    expect(demoVerify).toContain('prepare_release_story_verify_mounts');
    expect(demoVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
    expect(clusterVerify).toContain('prepare_release_story_verify_mounts');
    expect(clusterVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
  });
});
