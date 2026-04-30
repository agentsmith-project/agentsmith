import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildSkipDecision } from '../../governance/build-artifact-broker';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const KIND_RUNNER_IMAGE = 'kind-registry:5000/mbos/runner:release-20260427';
const HOST_RUNNER_IMAGE = 'registry.test/mbos/runner:release-20260427';
const FORBIDDEN_SKIP_DECISION_FIELDS = [
  'passed',
  'verdict',
  'reusable',
  'claim_id',
  'result_status',
  'failure_class',
] as const;

function stageClusterRehearsalFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/cluster-rehearsal/common.sh',
    'scripts/scenarios/cluster-rehearsal/status.sh',
    'scripts/scenarios/common.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/local-kind-world.sh',
    'scripts/governance/current-rehearsal-world-health-schema.ts',
    'scripts/governance/rehearsal-world-health.ts',
    'scripts/governance/redaction.ts',
    'infra/deploy/cluster/env/site.env.example',
    'infra/deploy/demo/kind/config.yaml',
    'infra/flows/cluster-rehearsal.env',
  ]) {
    const sourcePath = path.join(process.cwd(), relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function stageKindPreloadFixture(tempRoot: string): {
  binDir: string;
  dockerLogPath: string;
  releaseRoot: string;
  tarballDir: string;
} {
  stageClusterRehearsalFixture(tempRoot);

  mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

ensure_dirs() {
  mkdir -p "\${RELEASE_ROOT}/env"
}

ensure_operator_registry_env() {
  :
}

load_registry_env() {
  export REGISTRY_HOST=registry.test
  export K8S_REGISTRY_HOST=kind-registry:5000
}

require_version_images() {
  export RUNNER_IMAGE="${HOST_RUNNER_IMAGE}"
  export K8S_RUNNER_IMAGE="${KIND_RUNNER_IMAGE}"
  export CHAT_RUNNER_IMAGE=""
  export K8S_CHAT_RUNNER_IMAGE=""
  export SANDBOX_MANAGER_IMAGE=""
  export K8S_SANDBOX_MANAGER_IMAGE=""
  export JUICEFS_MOUNT_IMAGE=""
  export K8S_JUICEFS_MOUNT_IMAGE=""
  export JUICEFS_CSI_DRIVER_IMAGE=""
  export K8S_JUICEFS_CSI_DRIVER_IMAGE=""
  export JUICEFS_CSI_DASHBOARD_IMAGE=""
  export K8S_JUICEFS_CSI_DASHBOARD_IMAGE=""
  export JUICEFS_CSI_PROVISIONER_IMAGE=""
  export K8S_JUICEFS_CSI_PROVISIONER_IMAGE=""
  export JUICEFS_CSI_RESIZER_IMAGE=""
  export K8S_JUICEFS_CSI_RESIZER_IMAGE=""
  export JUICEFS_CSI_LIVENESSPROBE_IMAGE=""
  export K8S_JUICEFS_CSI_LIVENESSPROBE_IMAGE=""
  export JUICEFS_CSI_NODE_REGISTRAR_IMAGE=""
  export K8S_JUICEFS_CSI_NODE_REGISTRAR_IMAGE=""
  export INGRESS_NGINX_CONTROLLER_IMAGE=""
  export K8S_INGRESS_NGINX_CONTROLLER_IMAGE=""
  export INGRESS_NGINX_CERTGEN_IMAGE=""
  export K8S_INGRESS_NGINX_CERTGEN_IMAGE=""
}
`,
    'utf8',
  );

  const binDir = path.join(tempRoot, 'bin');
  const tarballDir = path.join(tempRoot, 'kind-image-tmp');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(tarballDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "\${DOCKER_LOG:?}"

case "\${1:-}" in
  tag)
    exit 0
    ;;
  image)
    if [[ "\${2:-}" == "inspect" ]]; then
      if [[ "\${LOCAL_INSPECT_EXIT:-0}" == "1" ]]; then
        exit 1
      fi
      local_image_id="\${LOCAL_IMAGE_ID:-}"
      local_config_digest="\${LOCAL_CONFIG_DIGEST:-}"
      local_repo_digests_json="\${LOCAL_REPO_DIGESTS_JSON:-[]}"
      case "\${3:-}" in
        --format)
          case "\${4:-}" in
            '{{json .RepoDigests}}')
              printf '%s\\n' "\${local_repo_digests_json}"
              ;;
            '{{.Id}}'|'{{json .Id}}')
              printf '%s\\n' "\${local_image_id}"
              ;;
            '{{.Config.Digest}}'|'{{json .Config.Digest}}')
              printf '%s\\n' "\${local_config_digest}"
              ;;
            *)
              printf '[{"Id":"%s","RepoDigests":%s,"Config":{"Digest":"%s"}}]\\n' \
                "\${local_image_id}" \
                "\${local_repo_digests_json}" \
                "\${local_config_digest}"
              ;;
          esac
          ;;
        *)
          printf '[{"Id":"%s","RepoDigests":%s,"Config":{"Digest":"%s"}}]\\n' \
            "\${local_image_id}" \
            "\${local_repo_digests_json}" \
            "\${local_config_digest}"
          ;;
      esac
      exit 0
    fi
    ;;
  save)
    output_path=""
    while (( "$#" > 0 )); do
      if [[ "\${1}" == "-o" ]]; then
        output_path="\${2:-}"
        shift 2
        continue
      fi
      shift
    done
    [[ -n "\${output_path}" ]] || exit 2
    printf 'tar\\n' > "\${output_path}"
    exit 0
    ;;
  exec)
    if [[ "\${2:-}" == "-i" ]]; then
      cat >/dev/null
      if [[ "\${KIND_IMPORT_EXIT:-0}" != "0" ]]; then
        exit "\${KIND_IMPORT_EXIT}"
      fi
      exit 0
    fi
    if [[ "\${KIND_PROBE_EXIT:-0}" == "1" ]]; then
      exit 1
    fi
    if [[ -n "\${KIND_CTR_IMAGE_INSPECT_JSON:-}" ]]; then
      printf '%s\\n' "\${KIND_CTR_IMAGE_INSPECT_JSON}"
    else
      printf '{}\\n'
    fi
    exit 0
    ;;
esac

echo "unexpected docker invocation: $*" >&2
exit 2
`,
    { encoding: 'utf8', mode: 0o755 },
  );
  writeFileSync(
    path.join(binDir, 'mktemp'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "/tmp/cluster-rehearsal-kind-image."*".tar" ]]; then
  mkdir -p "\${KIND_TARBALL_DIR:?}"
  counter_path="\${KIND_TARBALL_DIR}/counter"
  counter=0
  if [[ -f "\${counter_path}" ]]; then
    counter="$(cat "\${counter_path}")"
  fi
  next_counter=$((counter + 1))
  printf '%s\\n' "\${next_counter}" > "\${counter_path}"
  tarball="\${KIND_TARBALL_DIR}/cluster-rehearsal-kind-image.\${counter}.tar"
  : > "\${tarball}"
  printf '%s\\n' "\${tarball}"
  exit 0
fi

/usr/bin/mktemp "$@"
`,
    { encoding: 'utf8', mode: 0o755 },
  );

  return {
    binDir,
    dockerLogPath: path.join(tempRoot, 'docker.log'),
    releaseRoot: path.join(tempRoot, 'release'),
    tarballDir,
  };
}

function runClusterRehearsalCommand(tempRoot: string, script: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export ROOT_DIR="${tempRoot}"
        export HOME="${tempRoot}"
        export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
        ${script}
      `,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function expectClusterRehearsalCommandFailure(
  tempRoot: string,
  script: string,
  extraEnv: NodeJS.ProcessEnv = {},
): string {
  let failure: (Error & { stderr?: Buffer | string }) | undefined;
  try {
    runClusterRehearsalCommand(tempRoot, script, extraEnv);
  } catch (error) {
    failure = error as Error & { stderr?: Buffer | string };
  }

  expect(failure).toBeDefined();
  return String(failure?.stderr ?? failure?.message ?? '');
}

function readEnvValue(filePath: string, key: string): string {
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.startsWith(`${key}=`)) {
      continue;
    }
    return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function runKindPreloadCommand(
  tempRoot: string,
  extraEnv: NodeJS.ProcessEnv = {},
): { dockerLog: string; releaseRoot: string; tarballDir: string } {
  const { binDir, dockerLogPath, releaseRoot, tarballDir } = stageKindPreloadFixture(tempRoot);

  runClusterRehearsalCommand(
    tempRoot,
    `
      source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
      export RELEASE_ROOT="${releaseRoot}"
      mkdir -p "\${RELEASE_ROOT}"
      preload_cluster_rehearsal_kind_images
    `,
    {
      ...extraEnv,
      DOCKER_LOG: dockerLogPath,
      KIND_TARBALL_DIR: tarballDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  );

  return {
    dockerLog: readFileSync(dockerLogPath, 'utf8'),
    releaseRoot,
    tarballDir,
  };
}

function expectKindPreloadCommandFailure(
  tempRoot: string,
  extraEnv: NodeJS.ProcessEnv = {},
): { dockerLog: string; releaseRoot: string; tarballDir: string; status: number | null } {
  const { binDir, dockerLogPath, releaseRoot, tarballDir } = stageKindPreloadFixture(tempRoot);
  let failure: (Error & { status?: number | null }) | undefined;

  try {
    runClusterRehearsalCommand(
      tempRoot,
      `
        source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
        export RELEASE_ROOT="${releaseRoot}"
        mkdir -p "\${RELEASE_ROOT}"
        preload_cluster_rehearsal_kind_images
      `,
      {
        ...extraEnv,
        DOCKER_LOG: dockerLogPath,
        KIND_TARBALL_DIR: tarballDir,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
      },
    );
  } catch (error) {
    failure = error as Error & { status?: number | null };
  }

  expect(failure).toBeDefined();
  return {
    dockerLog: existsSync(dockerLogPath) ? readFileSync(dockerLogPath, 'utf8') : '',
    releaseRoot,
    tarballDir,
    status: failure?.status ?? null,
  };
}

function readSkipDecisions(releaseRoot: string): Array<Record<string, unknown>> {
  const skipDecisionPath = path.join(releaseRoot, 'skip-decisions.ndjson');
  if (!existsSync(skipDecisionPath)) {
    return [];
  }

  return readFileSync(skipDecisionPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('cluster-rehearsal generated state ownership', () => {
  it('renders status.sh as a read-only world health snapshot without skip or verdict semantics', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-status-health-'));
    try {
      stageClusterRehearsalFixture(tempRoot);

      const output = runClusterRehearsalCommand(
        tempRoot,
        `
          mkdir -p "${tempRoot}/scenario/state" "${tempRoot}/artifacts/runtime"
          printf '{"release":{"phase":"deploy_app_completed","id":"cluster-status-release"}}\\n' > "${tempRoot}/scenario/state/deploy-state.json"
          printf 'cluster-rehearsal\\n' > "${tempRoot}/artifacts/runtime/active-scenario.lock"
          bash "${tempRoot}/scripts/scenarios/cluster-rehearsal/status.sh"
        `,
      );

      expect(output).toContain('AgentSmith Rehearsal World Health');
      expect(output).toContain('Runtime line: cluster-rehearsal');
      expect(output).toContain('Health: degraded');
      expect(output).toContain('World:');
      expect(output).toContain('Public bases: web=http://localhost:43001');
      expect(output).toContain('Ports: web=43001; api=41000; keycloak=48080; sandbox=29080; registry=5002');
      expect(output).toContain('Safe reset level: world');
      expect(output).toContain('Safe next command: make cluster-rehearsal-reset && npm run rehearse:cluster');
      expect(output).toContain('Authority:');
      expect(output).toContain('Scenario detail:');
      expect(output).not.toContain('failure_class');
      expect(output).not.toContain('claim_id');
      expect(output).not.toContain('release_decision');
      expect(output).not.toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(output).not.toContain('reuse');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('canonicalizes legacy operator protocol aliases into scenario-owned site env truth without mutating the operator file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-legacy-protocols-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        [
          'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=anthropic_compatible',
          'PRESET_OPENAI_ENDPOINT_PROTOCOL=openai_compatible',
        ].join('\n') + '\n',
        'utf8',
      );

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const operatorSiteEnv = path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env');

      expect(readEnvValue(seededSiteEnv, 'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL')).toBe('anthropic_messages');
      expect(readEnvValue(seededSiteEnv, 'PRESET_OPENAI_ENDPOINT_PROTOCOL')).toBe('openai_chat_completions');
      expect(readEnvValue(operatorSiteEnv, 'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL')).toBe('anthropic_compatible');
      expect(readEnvValue(operatorSiteEnv, 'PRESET_OPENAI_ENDPOINT_PROTOCOL')).toBe('openai_compatible');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps rejecting unsupported unknown endpoint protocols after ingest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-unknown-protocol-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=totally_unknown\n',
        'utf8',
      );

      let failure: Error | undefined;
      try {
        runClusterRehearsalCommand(
          tempRoot,
          `
            source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            ensure_cluster_rehearsal_site_env
          `,
        );
      } catch (error) {
        failure = error as Error & { stderr?: Buffer | string };
      }

      expect(failure).toBeDefined();
      expect(String((failure as Error & { stderr?: Buffer | string }).stderr ?? failure?.message)).toContain(
        'unsupported endpoint protocol: totally_unknown',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('backfills missing current site env schema keys into a legacy operator config without mutating the operator file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-legacy-site-env-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      const operatorSiteEnv = path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env');
      writeFileSync(operatorSiteEnv, 'PRESET_ENDPOINT_API_KEY=legacy-cluster-secret\n', 'utf8');

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const seededSiteEnvText = readFileSync(seededSiteEnv, 'utf8');
      const operatorSiteEnvText = readFileSync(operatorSiteEnv, 'utf8');

      expect(readEnvValue(seededSiteEnv, 'PRESET_ENDPOINT_API_KEY')).toBe('legacy-cluster-secret');
      expect(readEnvValue(seededSiteEnv, 'RUNTIME_PROXY_MODE')).toBe('sanitized');
      expect(seededSiteEnvText).toContain('RUNTIME_HTTP_PROXY=');
      expect(seededSiteEnvText).toContain('RUNTIME_HTTPS_PROXY=');
      expect(seededSiteEnvText).toContain('RUNTIME_ALL_PROXY=');
      expect(operatorSiteEnvText).not.toContain('RUNTIME_PROXY_MODE=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('seeds a scenario-owned host port range and rewrites kind-facing addresses for local full-auto rehearsal', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-owned-ports-'));

    try {
      stageClusterRehearsalFixture(tempRoot);

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
          CLUSTER_REHEARSAL_KIND_GATEWAY_HOST=10.88.0.1 rewrite_cluster_rehearsal_kind_gateway_site_env "${tempRoot}/scenario/config/site.env"
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'CLUSTER_DEPLOY_MODE')).toBe('full-auto');
      expect(readEnvValue(seededSiteEnv, 'POSTGRES_PORT')).toBe('45432');
      expect(readEnvValue(seededSiteEnv, 'MONGO_PORT')).toBe('47017');
      expect(readEnvValue(seededSiteEnv, 'REDIS_PORT')).toBe('46379');
      expect(readEnvValue(seededSiteEnv, 'MINIO_API_PORT')).toBe('49000');
      expect(readEnvValue(seededSiteEnv, 'MINIO_CONSOLE_PORT')).toBe('49001');
      expect(readEnvValue(seededSiteEnv, 'KEYCLOAK_PORT')).toBe('48080');
      expect(readEnvValue(seededSiteEnv, 'API_PORT')).toBe('41000');
      expect(readEnvValue(seededSiteEnv, 'WEB_PORT')).toBe('43001');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_WEB_BASE_URL')).toBe('http://localhost:43001');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_API_BASE_URL')).toBe('http://localhost:41000/api/v1');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_KEYCLOAK_BASE_URL')).toBe('http://localhost:48080');
      expect(readEnvValue(seededSiteEnv, 'HOST_LOCAL_POSTGRES_PORT')).toBe('45432');
      expect(readEnvValue(seededSiteEnv, 'HOST_LOCAL_MINIO_ENDPOINT')).toBe('http://127.0.0.1:49000');
      expect(readEnvValue(seededSiteEnv, 'CLIENT_PUBLIC_POSTGRES_PORT')).toBe('45432');
      expect(readEnvValue(seededSiteEnv, 'CLIENT_PUBLIC_MINIO_ENDPOINT')).toBe('http://127.0.0.1:49000');
      expect(readEnvValue(seededSiteEnv, 'K8S_EXTERNAL_POSTGRES_HOST')).toBe('10.88.0.1');
      expect(readEnvValue(seededSiteEnv, 'K8S_EXTERNAL_POSTGRES_PORT')).toBe('45432');
      expect(readEnvValue(seededSiteEnv, 'K8S_EXTERNAL_MINIO_HOST')).toBe('10.88.0.1');
      expect(readEnvValue(seededSiteEnv, 'K8S_EXTERNAL_MINIO_PORT')).toBe('49000');
      expect(readEnvValue(seededSiteEnv, 'K8S_EXTERNAL_API_BASE_URL')).toBe('http://10.88.0.1:41000');
      expect(readEnvValue(seededSiteEnv, 'INTEGRATION_PUBLIC_WEB_BASES')).toBe(
        'http://localhost:43001,http://127.0.0.1:43001',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rewrites fresh site.env seeds to the tracked rehearsal sandbox URL truth', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-site-env-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            mkdir -p "${tempRoot}/.infra/cluster-deploy"
            ln -s "${repoRoot}/scripts" "${tempRoot}/scripts"
            ln -s "${repoRoot}/infra" "${tempRoot}/infra"
            cat > "${tempRoot}/.infra/cluster-deploy/site.env" <<'EOF'
SANDBOX_MANAGER_PUBLIC_BASE_URL=http://192.168.0.210:29080
COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=http://192.168.0.210:29080
EOF
            export ROOT_DIR="${tempRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            ensure_cluster_rehearsal_site_env
            grep '^SANDBOX_HOST_PORT=' "${tempRoot}/scenario/config/site.env"
            grep '^SANDBOX_MANAGER_PUBLIC_BASE_URL=' "${tempRoot}/scenario/config/site.env"
            grep '^COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=' "${tempRoot}/scenario/config/site.env"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('SANDBOX_HOST_PORT=29080');
      expect(output).toContain('SANDBOX_MANAGER_PUBLIC_BASE_URL=http://192.168.0.210:29080');
      expect(output).toContain('COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=http://host.docker.internal:29080');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('exports SKIP_BUNDLED_IMAGE_LOAD=1 only when the cluster rehearsal fast-path flag is enabled', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-fast-path-'));

    try {
      const withFastPath = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            export REHEARSAL_MODE=fast
            export CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD=1
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );
      const withoutFastPath = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            printf 'mode=%s\\n' "\${REHEARSAL_MODE:-}"
            printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(withFastPath).toContain('skip=1');
      expect(withoutFastPath).toContain('mode=release-fidelity');
      expect(withoutFastPath).toContain('skip=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('passes release bundle fast-path env to the cluster bundle builder only when the rehearsal fast-path flag is enabled, while preserving explicit caller overrides', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-archive-flag-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${OUT_DIR}"
printf 'SKIP_RELEASE_ARCHIVE=%s\\n' "\${SKIP_RELEASE_ARCHIVE:-}" > "\${OUT_DIR}/builder.env"
printf 'SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=%s\\n' "\${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-}" >> "\${OUT_DIR}/builder.env"
mkdir -p "\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
`,
        'utf8',
      );

      const withFastPath = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
          printf 'release_root=%s\\n' "\${RELEASE_ROOT}"
        `,
        {
          REHEARSAL_MODE: 'fast',
          CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE: '1',
          CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1',
        },
      );

      const withExplicitOverride = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
        { REHEARSAL_MODE: 'fast', SKIP_RELEASE_ARCHIVE: '1' },
      );

      const withExplicitArchiveOverride = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
        { REHEARSAL_MODE: 'fast', SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' },
      );

      const withoutFastPath = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
      );

      expect(withFastPath).toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withFastPath).toContain(`release_root=${path.join(tempRoot, 'scenario', 'releases', 'agentsmith-')}`);
      expect(withExplicitOverride).toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withExplicitArchiveOverride).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withoutFastPath).toContain('SKIP_RELEASE_ARCHIVE=');
      expect(withoutFastPath).not.toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withoutFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=');
      expect(withoutFastPath).not.toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not leak current release truth into the next cluster bundle build', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-current-release-leak-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
{
  printf 'builder_release_root=%s\\n' "\${RELEASE_ROOT:-}"
  printf 'builder_release_id=%s\\n' "\${RELEASE_ID:-}"
} > "\${OUT_DIR}/builder.env"
cat > "\${OUT_DIR}/agentsmith-\${RELEASE_ID}/VERSION" <<EOF
release_id=\${RELEASE_ID}
EOF
`,
        { encoding: 'utf8', mode: 0o755 },
      );
      const currentRoot = path.join(tempRoot, 'scenario', 'releases', 'agentsmith-old-current');
      mkdirSync(currentRoot, { recursive: true });
      writeFileSync(path.join(currentRoot, 'VERSION'), 'release_id=old-current\n', 'utf8');
      mkdirSync(path.join(tempRoot, 'scenario'), { recursive: true });
      symlinkSync(currentRoot, path.join(tempRoot, 'scenario', 'current'));

      const output = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          printf 'initial_release_root=%s\\n' "\${RELEASE_ROOT}"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
          printf 'final_release_root=%s\\n' "\${RELEASE_ROOT}"
          printf 'final_release_id=%s\\n' "\${RELEASE_ID}"
        `,
      );

      expect(output).toContain(`initial_release_root=${currentRoot}`);
      expect(output).toContain('builder_release_root=');
      expect(output).not.toContain(`builder_release_root=${currentRoot}`);
      expect(output).toContain('builder_release_id=cluster-rehearsal-');
      expect(output).toContain(`final_release_root=${path.join(tempRoot, 'scenario', 'releases', 'agentsmith-cluster-rehearsal-')}`);
      expect(output).toContain('final_release_id=cluster-rehearsal-');
      expect(output).not.toContain('final_release_id=old-current');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses scenario-owned registry env for bundle builds instead of operator registry overrides', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-registry-env-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'registry.env'),
        [
          'REGISTRY_HOST=operator-registry.example',
          'REGISTRY_PROJECT=operator',
          'APP_NODE_BASE_IMAGE=node:24.14.1-bookworm',
          '',
        ].join('\n'),
        'utf8',
      );
      mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
printf 'shared_registry_env=%s\\n' "\${CLUSTER_DEPLOY_SHARED_REGISTRY_ENV:-}" > "\${OUT_DIR}/builder.env"
cat "\${CLUSTER_DEPLOY_SHARED_REGISTRY_ENV:?}" > "\${OUT_DIR}/builder-registry.env"
cat > "\${OUT_DIR}/agentsmith-\${RELEASE_ID}/VERSION" <<EOF
release_id=\${RELEASE_ID}
EOF
`,
        { encoding: 'utf8', mode: 0o755 },
      );

      const output = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_registry_env
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
      );
      const builderRegistryEnv = readFileSync(path.join(tempRoot, 'scenario', 'releases', 'builder-registry.env'), 'utf8');

      expect(output).toContain(`shared_registry_env=${path.join(tempRoot, 'scenario', 'config', 'registry.env')}`);
      expect(builderRegistryEnv).toContain('REGISTRY_HOST=localhost:5002');
      expect(builderRegistryEnv).toContain('K8S_REGISTRY_HOST=agentsmith-cluster-registry:5000');
      expect(builderRegistryEnv).not.toContain('operator-registry.example');
      expect(builderRegistryEnv).not.toContain('APP_NODE_BASE_IMAGE=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when release-fidelity cluster rehearsal sees manual skip env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-skip-policy-'));
    const forbiddenCases: Array<[string, NodeJS.ProcessEnv, string]> = [
      ['default mode', {}, 'SKIP_BUNDLED_IMAGE_LOAD'],
      ['release-fidelity mode', { REHEARSAL_MODE: 'release-fidelity' }, 'SKIP_RELEASE_ARCHIVE'],
      [
        'release-fidelity archive generation',
        { REHEARSAL_MODE: 'release-fidelity' },
        'SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION',
      ],
      [
        'offline-package line load',
        { REHEARSAL_MODE: 'offline-package' },
        'CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD',
      ],
      [
        'offline-package line release archive',
        { REHEARSAL_MODE: 'offline-package' },
        'CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE',
      ],
    ];

    try {
      stageClusterRehearsalFixture(tempRoot);

      for (const [caseName, env, skipKey] of forbiddenCases) {
        const stderr = expectClusterRehearsalCommandFailure(
          tempRoot,
          `
            source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
          `,
          { ...env, [skipKey]: '1' },
        );

        expect(stderr, caseName).toContain('REHEARSAL_MODE');
        expect(stderr, caseName).toContain(skipKey);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsupported cluster rehearsal modes before applying skip env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-invalid-mode-'));
    try {
      stageClusterRehearsalFixture(tempRoot);

      const stderr = expectClusterRehearsalCommandFailure(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
        `,
        { REHEARSAL_MODE: 'unsafe-skip' },
      );

      expect(stderr).toContain('invalid REHEARSAL_MODE');
      expect(stderr).toContain('fast');
      expect(stderr).toContain('release-fidelity');
      expect(stderr).toContain('offline-package');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('hydrates a fresh rehearsal site env with MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN without mutating the tracked example', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-proxy-token-'));

    try {
      stageClusterRehearsalFixture(tempRoot);

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const exampleSiteEnv = path.join(tempRoot, 'infra', 'deploy', 'cluster', 'env', 'site.env.example');
      const firstToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const secondToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
      expect(firstToken).not.toBe('');
      expect(secondToken).toBe(firstToken);
      expect(readEnvValue(exampleSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('');
      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN')).toBe('');
      expect(readEnvValue(exampleSiteEnv, 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN')).toBe('');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves an explicit rehearsal MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN instead of replacing it', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-proxy-token-explicit-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=site-proxy-token\n',
        'utf8',
      );

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('site-proxy-token');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('routes handoff and shared kubeconfig paths into scenario-generated state', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-common-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            mark_cluster_rehearsal_admin_ready
            printf 'generated=%s\\n' "\${CLUSTER_REHEARSAL_GENERATED_DIR}"
            printf 'kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_KUBECONFIG}"
            printf 'admin_kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_ADMIN_KUBECONFIG}"
            printf 'manager_kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_MANAGER_KUBECONFIG}"
            printf 'admin_ready=%s\\n' "\${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV}"
            printf 'handoff=%s\\n' "\${CLUSTER_DEPLOY_ADMIN_HANDOFF_DIR}"
            cat "\${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      const generatedDir = path.join(tempRoot, 'scenario', 'state', 'generated');
      expect(output).toContain(`generated=${generatedDir}`);
      expect(output).toContain(`kubeconfig=${path.join(generatedDir, 'kubeconfig')}`);
      expect(output).toContain(`admin_kubeconfig=${path.join(generatedDir, 'admin-kubeconfig')}`);
      expect(output).toContain(`manager_kubeconfig=${path.join(generatedDir, 'manager-kubeconfig')}`);
      expect(output).toContain(`admin_ready=${path.join(generatedDir, 'admin-ready.env')}`);
      expect(output).toContain(`handoff=${path.join(generatedDir, 'admin-handoff')}`);
      expect(output).toContain('ADMIN_READY=1');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('cleans legacy generated handoff artifacts from the rehearsal root', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-legacy-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            mkdir -p "${tempRoot}/scenario/config" "${tempRoot}/scenario/admin-handoff"
            printf 'old\\n' > "${tempRoot}/scenario/config/kubeconfig"
            printf 'old\\n' > "${tempRoot}/scenario/config/admin-kubeconfig"
            printf 'old\\n' > "${tempRoot}/scenario/config/manager-kubeconfig"
            printf 'ADMIN_READY=1\\n' > "${tempRoot}/scenario/config/admin-ready.env"
            printf 'stale\\n' > "${tempRoot}/scenario/admin-handoff/README.md"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            cleanup_cluster_rehearsal_legacy_generated_state
            test ! -e "${tempRoot}/scenario/config/kubeconfig"
            test ! -e "${tempRoot}/scenario/config/admin-kubeconfig"
            test ! -e "${tempRoot}/scenario/config/manager-kubeconfig"
            test ! -e "${tempRoot}/scenario/config/admin-ready.env"
            test ! -e "${tempRoot}/scenario/admin-handoff"
            printf 'legacy_cleanup=ok\\n'
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('legacy_cleanup=ok');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preloads both notebook and chat runner images into the rehearsal kind node', () => {
    const commonScript = readFileSync(path.join(process.cwd(), 'scripts', 'scenarios', 'cluster-rehearsal', 'common.sh'), 'utf8');

    expect(commonScript).toContain('local host_images=(');
    expect(commonScript).toContain('local kind_images=(');
    expect(commonScript).toContain('"${RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${CHAT_RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${K8S_RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${K8S_CHAT_RUNNER_IMAGE}"');
  });

  it('skips kind image preload when local and kind containerd manifest digests match and records an audit decision', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-skip-match-'));

    try {
      const { dockerLog, releaseRoot } = runKindPreloadCommand(tempRoot, {
        LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
        KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_A}"}}`,
      });
      const skipDecisions = readSkipDecisions(releaseRoot);

      expect(dockerLog).toContain(`tag ${HOST_RUNNER_IMAGE} ${KIND_RUNNER_IMAGE}`);
      expect(dockerLog).toContain(`image inspect --format {{json .RepoDigests}} ${KIND_RUNNER_IMAGE}`);
      expect(dockerLog).toContain(`exec agentsmith-control-plane ctr -n k8s.io images inspect ${KIND_RUNNER_IMAGE}`);
      expect(dockerLog).not.toContain('save --platform linux/amd64');
      expect(dockerLog).not.toContain('exec -i agentsmith-control-plane');

      expect(skipDecisions).toHaveLength(1);
      expect(skipDecisions[0]).toMatchObject({
        schema: 'current-build-skip-decision.v1',
        version: 1,
        target: `image:${KIND_RUNNER_IMAGE}`,
        operation: 'kind_preload',
        input_digest: DIGEST_A,
        existing_artifact_digest: DIGEST_A,
        skip_reason: 'kind_containerd_target_digest_matches_local_manifest_digest',
      });
      expect(String(skipDecisions[0]?.validator)).toContain('docker image inspect');
      expect(String(skipDecisions[0]?.validator)).toContain('ctr images inspect');
      expect(typeof skipDecisions[0]?.generated_at).toBe('string');
      expect(validateBuildSkipDecision(skipDecisions[0]).ok).toBe(true);
      for (const field of FORBIDDEN_SKIP_DECISION_FIELDS) {
        expect(skipDecisions[0]).not.toHaveProperty(field);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('imports into kind when proven local and kind containerd digests differ', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-skip-mismatch-'));

    try {
      const { dockerLog, releaseRoot } = runKindPreloadCommand(tempRoot, {
        LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
        KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_B}"}}`,
      });

      expect(dockerLog).toContain('save --platform linux/amd64');
      expect(dockerLog).toContain('exec -i agentsmith-control-plane sh -lc');
      expect(readSkipDecisions(releaseRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('removes the temporary kind image archive when import fails without masking the failure status', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-import-cleanup-'));

    try {
      const { dockerLog, releaseRoot, status, tarballDir } = expectKindPreloadCommandFailure(tempRoot, {
        LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
        KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_B}"}}`,
        KIND_IMPORT_EXIT: '7',
      });

      expect(status).toBe(7);
      expect(dockerLog).toContain('save --platform linux/amd64');
      expect(dockerLog).toContain('exec -i agentsmith-control-plane sh -lc');
      expect(readdirSync(tarballDir).filter((name) => name.endsWith('.tar'))).toEqual([]);
      expect(readSkipDecisions(releaseRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('imports into kind when digest probes fail, are missing, or return invalid digests', () => {
    const cases: Array<[string, NodeJS.ProcessEnv]> = [
      [
        'kind probe failure',
        {
          LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
          KIND_PROBE_EXIT: '1',
        },
      ],
      [
        'kind invalid digest',
        {
          LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
          KIND_CTR_IMAGE_INSPECT_JSON: '{"target":{"digest":"sha256:not-a-valid-digest"}}',
        },
      ],
      [
        'missing local digest proof',
        {
          LOCAL_REPO_DIGESTS_JSON: '[]',
          KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_A}"}}`,
        },
      ],
      [
        'local invalid digest',
        {
          LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@sha256:not-a-valid-digest"]`,
          KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_A}"}}`,
        },
      ],
    ];

    for (const [caseName, env] of cases) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-skip-fail-closed-'));

      try {
        const { dockerLog, releaseRoot } = runKindPreloadCommand(tempRoot, env);

        expect(dockerLog, caseName).toContain('save --platform linux/amd64');
        expect(dockerLog, caseName).toContain('exec -i agentsmith-control-plane sh -lc');
        expect(readSkipDecisions(releaseRoot), caseName).toEqual([]);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('does not skip from Docker image ID/config digest or containerd target config digest matches', () => {
    const cases: Array<[string, NodeJS.ProcessEnv]> = [
      [
        'docker image id and config digest match kind target digest but RepoDigest differs',
        {
          LOCAL_IMAGE_ID: DIGEST_B,
          LOCAL_CONFIG_DIGEST: DIGEST_B,
          LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
          KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_B}"}}`,
        },
      ],
      [
        'RepoDigest matches containerd target config digest but not target digest',
        {
          LOCAL_IMAGE_ID: DIGEST_A,
          LOCAL_CONFIG_DIGEST: DIGEST_A,
          LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
          KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_B}","config":{"digest":"${DIGEST_A}"}}}`,
        },
      ],
    ];

    for (const [caseName, env] of cases) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-skip-config-digest-'));

      try {
        const { dockerLog, releaseRoot } = runKindPreloadCommand(tempRoot, env);

        expect(dockerLog, caseName).toContain(`image inspect --format {{json .RepoDigests}} ${KIND_RUNNER_IMAGE}`);
        expect(dockerLog, caseName).toContain(
          `exec agentsmith-control-plane ctr -n k8s.io images inspect ${KIND_RUNNER_IMAGE}`,
        );
        expect(dockerLog, caseName).toContain('save --platform linux/amd64');
        expect(dockerLog, caseName).toContain('exec -i agentsmith-control-plane sh -lc');
        expect(readSkipDecisions(releaseRoot), caseName).toEqual([]);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('bypasses digest probes and imports when FORCE_KIND_PRELOAD=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-kind-force-preload-'));

    try {
      const { dockerLog, releaseRoot } = runKindPreloadCommand(tempRoot, {
        FORCE_KIND_PRELOAD: '1',
        LOCAL_REPO_DIGESTS_JSON: `["${KIND_RUNNER_IMAGE.replace(/:[^/:]+$/u, '')}@${DIGEST_A}"]`,
        KIND_CTR_IMAGE_INSPECT_JSON: `{"target":{"digest":"${DIGEST_A}"}}`,
      });

      expect(dockerLog).toContain('save --platform linux/amd64');
      expect(dockerLog).toContain('exec -i agentsmith-control-plane sh -lc');
      expect(dockerLog).not.toContain('image inspect --format');
      expect(dockerLog).not.toContain('ctr -n k8s.io images inspect');
      expect(readSkipDecisions(releaseRoot)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
