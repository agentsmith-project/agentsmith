import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HELPER_PATH = 'scripts/lib/release-story-verify-source-set.sh';

const REQUIRED_RELEASE_STORY_VERIFY_FILES = [
  'e2e/integration-release-user-story.spec.ts',
  'e2e/release-user-story.contract.ts',
  'e2e/story-contract.ts',
  'e2e/story-loader.ts',
  'e2e/story-trace-binding.ts',
  'e2e/trace-bundle-support.ts',
  'e2e/generated/story-specs.generated.json',
  'e2e/stories/backend-real/release-user-story-end-to-end.story.md',
  'e2e/stories/backend-real/real-backend-visual-review.story.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
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

describe('release story verify source set runtime contract', () => {
  it('keeps a single helper-owned release story source list for deploy bundle and verify flows', () => {
    const helper = read(HELPER_PATH);
    const sources = listReleaseStoryVerifySources();

    expect(helper).toContain('e2e/trace-bundle-support.ts');
    expect(helper).toContain('find "${story_root}" -type f -name \'*.story.md\'');

    for (const relativePath of REQUIRED_RELEASE_STORY_VERIFY_FILES) {
      expect(sources).toContain(relativePath);
    }
  });

  it('makes demo and cluster build/verify and bundle-input gates consume the shared verify source set helper', () => {
    const demoBuild = read('scripts/demo-deploy/build-offline-bundle.sh');
    const clusterBuild = read('scripts/cluster-deploy/build-bundle.sh');
    const demoVerify = read('scripts/demo-deploy/verify.sh');
    const clusterVerify = read('scripts/cluster-deploy/verify.sh');
    const demoBundleInputs = read('scripts/demo-deploy/check-bundle-inputs.sh');
    const clusterBundleInputs = read('scripts/cluster-deploy/check-bundle-inputs.sh');

    for (const script of [
      demoBuild,
      clusterBuild,
      demoVerify,
      clusterVerify,
      demoBundleInputs,
      clusterBundleInputs,
    ]) {
      expect(script).toContain('source "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh"');
      expect(script).toContain('release_story_verify_source_set');
    }

    expect(demoVerify).toContain('prepare_release_story_verify_mounts');
    expect(demoVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
    expect(clusterVerify).toContain('prepare_release_story_verify_mounts');
    expect(clusterVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
  });

  it('keeps both deployment manifests aligned with the shared release story verify source set', () => {
    const demoManifest = JSON.parse(read('infra/deploy/demo/deployment.manifest.json')) as { bundle_files?: string[] };
    const clusterManifest = JSON.parse(read('infra/deploy/cluster/deployment.manifest.json')) as { bundle_files?: string[] };

    for (const relativePath of REQUIRED_RELEASE_STORY_VERIFY_FILES) {
      expect(demoManifest.bundle_files).toContain(relativePath);
      expect(clusterManifest.bundle_files).toContain(relativePath);
    }
  });
});
