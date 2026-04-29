import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HELPER_PATH = 'scripts/lib/release-story-verify-source-set.sh';
const EXPECTED_SOURCE_SET_NAME = 'backend_real_story_verify_source_set';

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

function listBackendRealStoryFiles(): string[] {
  const output = execFileSync('bash', ['-lc', "find e2e/stories/backend-real -type f -name '*.story.md' | sort"], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

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

describe('release story verify source set', () => {
  it('declares the full release story contract family and committed story files', () => {
    const sources = listReleaseStoryVerifySources();
    const storyFiles = listBackendRealStoryFiles();

    expect(sources).toEqual(
      expect.arrayContaining([
        'e2e/integration-release-user-story.spec.ts',
        'e2e/release-user-story.contract.ts',
        'e2e/story-contract.ts',
        'e2e/story-generated-spec.ts',
        'e2e/story-loader.ts',
        'e2e/story-trace-binding.ts',
        'e2e/generated/story-specs.generated.json',
        'packages/contracts/src/auth-handoff-paths.ts',
      ]),
    );
    expect(sources).not.toContain('src/lib/auth/invite-handoff.ts');
    expect(sources).toEqual(expect.arrayContaining(storyFiles));
  });

  it('keeps demo and cluster bundle manifests aligned with the shared source set contract instead of static story file lists', () => {
    const sources = listReleaseStoryVerifySources();
    const sourceSetContract = readSourceSetContract();
    const demoManifest = readJson('infra/deploy/demo/deployment.manifest.json') as {
      bundle_files?: string[];
      bundle_source_sets?: Array<{ name?: string; helper?: string }>;
    };
    const clusterManifest = readJson('infra/deploy/cluster/deployment.manifest.json') as {
      bundle_files?: string[];
      bundle_source_sets?: Array<{ name?: string; helper?: string }>;
    };

    expect(sourceSetContract.name).toBe(EXPECTED_SOURCE_SET_NAME);
    for (const manifest of [demoManifest, clusterManifest]) {
      expect(manifest.bundle_source_sets).toEqual(
        expect.arrayContaining([
          {
            name: sourceSetContract.name,
            helper: sourceSetContract.helperPath,
          },
        ]),
      );
      expect(manifest.bundle_files ?? []).toEqual(
        expect.not.arrayContaining(sources.filter((relativePath) => relativePath.startsWith('e2e/'))),
      );
    }
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
    expect(demoBuild).toContain('release_story_verify_source_set_name');
    expect(clusterBuild).toContain('release_story_verify_source_set_name');
    expect(demoVerify).toContain('prepare_release_story_verify_mounts');
    expect(demoVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
    expect(clusterVerify).toContain('prepare_release_story_verify_mounts');
    expect(clusterVerify).toContain('"${RELEASE_STORY_VERIFY_MOUNTS[@]}"');
  });

  it('makes demo and cluster verify share a token-aware universal proxy admin-state preflight', () => {
    const runtimeVerification = read('scripts/lib/runtime-verification.sh');
    const demoVerify = read('scripts/demo-deploy/verify.sh');
    const clusterVerify = read('scripts/cluster-deploy/verify.sh');
    const adminStateGate = runtimeVerification.match(
      /gate_wait_for_universal_proxy_admin_state\(\) \{[\s\S]*?\n\}\n\n/,
    )?.[0];

    expect(adminStateGate).toContain('gate_wait_for_universal_proxy_admin_state()');
    expect(adminStateGate).toContain('local probe_url="http://localhost:8080/admin/state"');
    expect(adminStateGate).toContain('if [[ -z "${admin_token}" ]]; then');
    expect(adminStateGate).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN is required');
    expect(adminStateGate).toContain('docker_compose exec -T');
    expect(adminStateGate).toContain('-e "GATE_PROXY_ADMIN_TOKEN=${admin_token}"');
    expect(adminStateGate).toContain('-H "Authorization: Bearer $GATE_PROXY_ADMIN_TOKEN"');
    expect(adminStateGate).not.toContain('if [ -n "$GATE_PROXY_ADMIN_TOKEN" ]; then');
    expect(adminStateGate).not.toContain('curl -s -o /dev/null -w "%{http_code}" "$GATE_PROXY_ADMIN_URL"');

    for (const script of [demoVerify, clusterVerify]) {
      expect(script).toContain('gate_wait_for_universal_proxy_admin_state');
      expect(script).toContain('"${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}"');
      expect(script).not.toContain('docker_compose ps --status running universal-proxy | grep -q universal-proxy');
    }
  });
});
