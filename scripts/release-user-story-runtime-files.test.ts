import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HELPER_PATH = 'scripts/lib/release-story-verify-source-set.sh';

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

function readSourceSetContract(): { name: string; helperPath: string } {
  const output = execFileSync(
    'bash',
    [
      '-lc',
      `source "${HELPER_PATH}" && printf '%s\\n%s\\n' "$(release_story_verify_source_set_name)" "$(release_story_verify_source_set_helper_path)"`,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    name: output[0] ?? '',
    helperPath: output[1] ?? '',
  };
}

describe('release story verify source set runtime contract', () => {
  it('keeps a single helper-owned release story source list for deploy bundle and verify flows', () => {
    const helper = read(HELPER_PATH);
    const sources = listReleaseStoryVerifySources();

    expect(helper).toContain('e2e/trace-bundle-support.ts');
    expect(helper).toContain('find "${story_root}" -type f -name \'*.story.md\'');
    expect(sources).toContain('e2e/integration-release-user-story.spec.ts');
    expect(sources).toContain('e2e/trace-bundle-support.ts');
    expect(sources.some((relativePath) => relativePath.endsWith('.story.md'))).toBe(true);
  });

  it('makes demo and cluster build/verify and bundle-input gates consume the shared verify source set helper and source-set contract', () => {
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

    for (const script of [demoBuild, clusterBuild, demoBundleInputs, clusterBundleInputs]) {
      expect(script).toContain('release_story_verify_source_set_name');
    }

    expect(demoBundleInputs).toContain('bundle_source_sets');
    expect(clusterBundleInputs).toContain('bundle_source_sets');
    expect(demoVerify).toContain('prepare_release_story_verify_mounts');
    expect(demoVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
    expect(clusterVerify).toContain('prepare_release_story_verify_mounts');
    expect(clusterVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
  });

  it('keeps both deployment manifests aligned with the shared release story verify source-set declaration', () => {
    const sourceSetContract = readSourceSetContract();
    const demoManifest = JSON.parse(read('infra/deploy/demo/deployment.manifest.json')) as {
      bundle_source_sets?: Array<{ name?: string; helper?: string }>;
    };
    const clusterManifest = JSON.parse(read('infra/deploy/cluster/deployment.manifest.json')) as {
      bundle_source_sets?: Array<{ name?: string; helper?: string }>;
    };

    for (const manifest of [demoManifest, clusterManifest]) {
      expect(manifest.bundle_source_sets).toEqual(
        expect.arrayContaining([
          {
            name: sourceSetContract.name,
            helper: sourceSetContract.helperPath,
          },
        ]),
      );
    }
  });
});
