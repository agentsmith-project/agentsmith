import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

describe('substrate universal proxy runtime contract', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  function readLockedLlmupImage(): string {
    const lock = readFileSync('infra/deploy/shared/llmup-image.lock', 'utf8');
    const image = lock.match(/^llmup_source_image=(.+)$/m)?.[1];
    expect(image).toBeTruthy();
    return image ?? '';
  }

  function copyIfPresent(source: string, destination: string): void {
    if (existsSync(source)) {
      cpSync(source, destination);
    }
  }

  function writeExecutable(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf8');
    chmodSync(filePath, 0o755);
  }

  function createIsolatedRepoRoot(prefix: string): string {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), `${prefix}-parent-`));
    tempRoots.push(parentRoot);
    const repoRoot = path.join(parentRoot, 'agentsmith');
    mkdirSync(repoRoot, { recursive: true });
    return repoRoot;
  }

  function prepareSubstrateFixture(tempRoot: string): { binDir: string; connectionEnv: string; dockerLog: string; upScript: string } {
    const substrateDir = path.join(tempRoot, 'scripts', 'substrate');
    const providersDir = path.join(substrateDir, 'providers');
    const scriptsLibDir = path.join(tempRoot, 'scripts', 'lib');
    const infraSubstrateDir = path.join(tempRoot, 'infra', 'substrate');
    const infraIntegrationDir = path.join(tempRoot, 'infra', 'integration');
    const infraSharedDir = path.join(tempRoot, 'infra', 'deploy', 'shared');
    const universalProxyConfigDir = path.join(infraSharedDir, 'universal-proxy');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'runtime', 'substrate', 'local-dev');
    const connectionEnv = path.join(stateRoot, 'connection.env');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const dockerRunMarker = path.join(tempRoot, 'docker-run.marker');

    mkdirSync(providersDir, { recursive: true });
    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(infraSubstrateDir, { recursive: true });
    mkdirSync(infraIntegrationDir, { recursive: true });
    mkdirSync(universalProxyConfigDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts', 'substrate', 'common.sh'), path.join(substrateDir, 'common.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'substrate', 'up.sh'), path.join(substrateDir, 'up.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'substrate', 'providers', 'compose.sh'), path.join(providersDir, 'compose.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'substrate', 'providers', 'external.sh'), path.join(providersDir, 'external.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'substrate', 'providers', 'k8s.sh'), path.join(providersDir, 'k8s.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'lib', 'llmup-image-lock.sh'), path.join(scriptsLibDir, 'llmup-image-lock.sh'));
    copyIfPresent(
      path.join(process.cwd(), 'scripts', 'lib', 'universal-proxy-runtime.sh'),
      path.join(scriptsLibDir, 'universal-proxy-runtime.sh'),
    );
    cpSync(path.join(process.cwd(), 'infra', 'deploy', 'shared', 'llmup-image.lock'), path.join(infraSharedDir, 'llmup-image.lock'));
    cpSync(
      path.join(process.cwd(), 'infra', 'deploy', 'shared', 'universal-proxy', 'config.yaml'),
      path.join(universalProxyConfigDir, 'config.yaml'),
    );
    writeFileSync(path.join(infraIntegrationDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');
    writeFileSync(
      path.join(infraSubstrateDir, 'local-dev.env'),
      `SUBSTRATE_TYPE=compose
SUBSTRATE_STATE_ROOT=${stateRoot}
SUBSTRATE_COMPOSE_FILE=${path.join(infraIntegrationDir, 'docker-compose.yml')}
SUBSTRATE_PROXY_PORT=38080
SUBSTRATE_KEYCLOAK_PORT=18080
`,
      'utf8',
    );

    writeExecutable(
      path.join(binDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'docker'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
} >> "${dockerLog}"

case "\${1:-}" in
  compose)
    exit 0
    ;;
  image)
    if [[ "\${2:-}" == "inspect" ]]; then
      exit 1
    fi
    ;;
  pull)
    exit 0
    ;;
  run)
    touch "${dockerRunMarker}"
    printf 'fake-substrate-proxy-container\\n'
    exit 0
    ;;
  rm)
    rm -f "${dockerRunMarker}"
    exit 0
    ;;
  logs)
    exit 0
    ;;
esac
exit 0
`,
    );

    writeExecutable(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
	set -euo pipefail
	url="\${!#}"
	status="000"
	has_admin_bearer=0
	previous=""
	for arg in "$@"; do
	  if [[ "\${previous}" == "-H" && "\${arg}" == "Authorization: Bearer "* ]]; then
	    has_admin_bearer=1
	  fi
	  previous="\${arg}"
	done
	case "\${url}" in
	  */.well-known/openid-configuration)
	    status="200"
	    ;;
	  */admin/state)
	    if [[ -f "${dockerRunMarker}" && "\${has_admin_bearer}" == "1" ]]; then
	      status="200"
	    elif [[ -f "${dockerRunMarker}" ]]; then
	      status="403"
	    fi
	    ;;
	esac
for arg in "$@"; do
  if [[ "\${arg}" == "-w" ]]; then
    printf '%s' "\${status}"
    exit 0
  fi
done
if [[ "\${status}" == "000" ]]; then
  exit 1
fi
exit 0
`,
    );

    chmodSync(path.join(substrateDir, 'up.sh'), 0o755);

    return {
      binDir,
      connectionEnv,
      dockerLog,
      upScript: path.join(substrateDir, 'up.sh'),
    };
  }

  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  function prepareRuntimeHelperFixture(
    tempRoot: string,
    options: { rmFails?: boolean } = {},
  ): {
    binDir: string;
    containerIdFile: string;
    containersDir: string;
    curlLog: string;
    dockerLog: string;
    rootDir: string;
    stateDir: string;
  } {
    const binDir = path.join(tempRoot, 'bin');
    const stateDir = path.join(tempRoot, 'runtime');
    const containersDir = path.join(tempRoot, 'docker-containers');
    const curlLog = path.join(tempRoot, 'curl.log');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const infraSharedDir = path.join(tempRoot, 'infra', 'deploy', 'shared');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(containersDir, { recursive: true });
    mkdirSync(infraSharedDir, { recursive: true });
    cpSync(path.join(process.cwd(), 'infra', 'deploy', 'shared', 'llmup-image.lock'), path.join(infraSharedDir, 'llmup-image.lock'));

    writeExecutable(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'curl'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
	} >> "${curlLog}"
	url="\${!#}"
	status="000"
	has_admin_bearer=0
	previous=""
	for arg in "$@"; do
	  if [[ "\${previous}" == "-H" && "\${arg}" == "Authorization: Bearer "* ]]; then
	    has_admin_bearer=1
	  fi
	  previous="\${arg}"
	done
	if [[ "\${url}" == */admin/state && -f "${containersDir}/started-managed-container.env" ]]; then
	  if [[ "\${has_admin_bearer}" == "1" ]]; then
	    status="200"
	  else
	    status="403"
	  fi
	fi
	for arg in "$@"; do
  if [[ "\${arg}" == "-w" ]]; then
    printf '%s' "\${status}"
    exit 0
  fi
done
if [[ "\${status}" == "000" ]]; then
  exit 1
fi
exit 0
`,
    );

    writeExecutable(
      path.join(binDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
containers_dir="${containersDir}"
{
  printf 'docker'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
} >> "${dockerLog}"

find_container_file() {
  local ref="$1"
  local file
  if [[ -f "\${containers_dir}/\${ref}.env" ]]; then
    printf '%s\\n' "\${containers_dir}/\${ref}.env"
    return 0
  fi
  for file in "\${containers_dir}"/*.env; do
    [[ -e "\${file}" ]] || continue
    id=""
    name=""
    managed_by=""
    runtime_label=""
    # shellcheck disable=SC1090
    source "\${file}"
    if [[ "\${ref}" == "\${id}" || "\${ref}" == "\${name}" || "\${ref}" == "/\${name}" ]]; then
      printf '%s\\n' "\${file}"
      return 0
    fi
  done
  return 1
}

case "\${1:-}" in
  ps)
    shift
    name_filter=""
    while [[ "$#" -gt 0 ]]; do
      case "\${1}" in
        --filter)
          raw_filter="\${2:-}"
          if [[ "\${raw_filter}" == name=^/* ]]; then
            name_filter="\${raw_filter#name=^/}"
            name_filter="\${name_filter%\\$}"
          fi
          shift 2
          ;;
        --format)
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    for file in "\${containers_dir}"/*.env; do
      [[ -e "\${file}" ]] || continue
      id=""
      name=""
      # shellcheck disable=SC1090
      source "\${file}"
      if [[ -z "\${name_filter}" || "\${name}" == "\${name_filter}" ]]; then
        printf '%s\\n' "\${id}"
      fi
    done
    exit 0
    ;;
  container)
    if [[ "\${2:-}" == "inspect" ]]; then
      shift 2
      format=""
      ref=""
      while [[ "$#" -gt 0 ]]; do
        case "\${1}" in
          --format)
            format="\${2:-}"
            shift 2
            ;;
          *)
            ref="\${1}"
            shift
            ;;
        esac
      done
      file="$(find_container_file "\${ref}")" || exit 1
      id=""
      managed_by=""
      runtime_label=""
      # shellcheck disable=SC1090
      source "\${file}"
      if [[ "\${format}" == *"com.agentsmith.managed-by"* ]]; then
        printf '%s\\n' "\${managed_by}"
        exit 0
      fi
      if [[ "\${format}" == *"com.agentsmith.runtime-label"* ]]; then
        printf '%s\\n' "\${runtime_label}"
        exit 0
      fi
      if [[ "\${format}" == *".Id"* ]]; then
        printf '%s\\n' "\${id}"
        exit 0
      fi
      exit 0
    fi
    ;;
  image)
    if [[ "\${2:-}" == "inspect" ]]; then
      exit 1
    fi
    ;;
  pull)
    exit 0
    ;;
  run)
    shift
    id="started-managed-container"
    name=""
    managed_by=""
    runtime_label=""
    while [[ "$#" -gt 0 ]]; do
      case "\${1}" in
        --name)
          name="\${2:-}"
          shift 2
          ;;
        --label)
          label="\${2:-}"
          case "\${label}" in
            com.agentsmith.managed-by=*) managed_by="\${label#com.agentsmith.managed-by=}" ;;
            com.agentsmith.runtime-label=*) runtime_label="\${label#com.agentsmith.runtime-label=}" ;;
          esac
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    cat > "\${containers_dir}/\${id}.env" <<EOF_CONTAINER
id=\${id}
name=\${name}
managed_by=\${managed_by}
runtime_label=\${runtime_label}
EOF_CONTAINER
    printf '%s\\n' "\${id}"
    exit 0
    ;;
  rm)
    if [[ "${options.rmFails ? '1' : '0'}" == "1" ]]; then
      printf 'fake rm failure\\n' >&2
      exit 51
    fi
    ref="\${@: -1}"
    file="$(find_container_file "\${ref}")" || exit 1
    rm -f "\${file}"
    exit 0
    ;;
  logs)
    exit 0
    ;;
esac

exit 0
`,
    );

    return {
      binDir,
      containerIdFile: path.join(stateDir, 'container.id'),
      containersDir,
      curlLog,
      dockerLog,
      rootDir: tempRoot,
      stateDir,
    };
  }

  function writeFakeContainer(
    fixture: { containersDir: string },
    container: { id: string; managedBy: string; name: string; runtimeLabel: string },
  ): void {
    writeFileSync(
      path.join(fixture.containersDir, `${container.id}.env`),
      `id=${container.id}
name=${container.name}
managed_by=${container.managedBy}
runtime_label=${container.runtimeLabel}
`,
      'utf8',
    );
  }

  function runtimeEnvPrefix(
    fixture: { containerIdFile: string; rootDir: string; stateDir: string },
    overrides: Record<string, string> = {},
  ): string {
    const entries: Record<string, string> = {
      UNIVERSAL_PROXY_RUNTIME_BASE_URL: 'http://127.0.0.1:39180',
      UNIVERSAL_PROXY_RUNTIME_CONTAINER_ID_FILE: fixture.containerIdFile,
      UNIVERSAL_PROXY_RUNTIME_DEFAULT_URLS: 'http://127.0.0.1:39180',
      UNIVERSAL_PROXY_RUNTIME_LABEL: 'test-runtime',
      UNIVERSAL_PROXY_RUNTIME_PORT: '39180',
      UNIVERSAL_PROXY_RUNTIME_ROOT_DIR: fixture.rootDir,
      UNIVERSAL_PROXY_RUNTIME_STATE_DIR: fixture.stateDir,
      UNIVERSAL_PROXY_RUNTIME_WAIT_TIMEOUT_SECONDS: '1',
      ...overrides,
    };

    return Object.entries(entries)
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(' ');
  }

  function runRuntimeHelper(
    fixture: { binDir: string; rootDir: string },
    command: string,
  ): ReturnType<typeof spawnSync> {
    return spawnSync(
      'bash',
      [
        '-lc',
        `source ${shellQuote(path.join(process.cwd(), 'scripts', 'lib', 'universal-proxy-runtime.sh'))}; ${command}`,
      ],
      {
        cwd: fixture.rootDir,
        env: {
          ...process.env,
          PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  }

  it('can source common.sh without a sibling llm-universal-proxy checkout', () => {
    const tempRoot = createIsolatedRepoRoot('substrate-source-no-sibling');
    const fixture = prepareSubstrateFixture(tempRoot);

    const result = spawnSync('bash', ['-lc', `source "${path.join(tempRoot, 'scripts', 'substrate', 'common.sh')}"; printf 'source-ok\\n'`], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source-ok');
  });

  it('uses the shared helper and fake docker instead of cargo/source coupling for compose substrate proxy startup', () => {
    const tempRoot = createIsolatedRepoRoot('substrate-compose-managed-proxy');
    const fixture = prepareSubstrateFixture(tempRoot);

    const result = spawnSync('bash', [fixture.upScript], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
        UNIVERSAL_PROXY_RUNTIME_WAIT_TIMEOUT_SECONDS: '1',
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status).toBe(0);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    const lockedImage = readLockedLlmupImage();
    expect(dockerLog).toContain('docker compose');
    expect(dockerLog).toContain(`docker pull ${lockedImage}`);
    expect(dockerLog).toContain('docker run');
    expect(dockerLog).toContain(lockedImage);
    expect(dockerLog).toContain('127.0.0.1:38080:8080');
    const connectionEnv = readFileSync(fixture.connectionEnv, 'utf8');
    expect(connectionEnv).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080');
    expect(connectionEnv).toMatch(/^MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=.+$/m);
  }, 10000);

  it('writes an explicit empty admin token field before the runtime helper exposes one', () => {
    const tempRoot = createIsolatedRepoRoot('substrate-empty-admin-token-contract');
    const fixture = prepareSubstrateFixture(tempRoot);

    const result = spawnSync('bash', ['-lc', `source "${path.join(tempRoot, 'scripts', 'substrate', 'common.sh')}"; write_connection_env`], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
        MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: '',
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(fixture.connectionEnv, 'utf8')).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=\n');
  });

  it('keeps the compose provider structurally delegated to universal-proxy-runtime.sh', () => {
    const composeProvider = readFileSync('scripts/substrate/providers/compose.sh', 'utf8');
    expect(composeProvider).not.toContain('cargo build');
    expect(composeProvider).not.toContain('target/debug/llm-universal-proxy');
    expect(composeProvider).toContain('universal_proxy_runtime_ensure');
  });

  it('keeps local and backend-real admin probes delegated to the bearer-aware runtime helper', () => {
    const probeEntrypoints = [
      'scripts/local-manual/verify.sh',
      'scripts/local-manual/status.sh',
      'scripts/substrate/providers/compose.sh',
      'scripts/api-key-endpoint-access-gate.sh',
      'scripts/member-isolation-backend-real-gate.sh',
    ];

    for (const entrypoint of probeEntrypoints) {
      const content = readFileSync(entrypoint, 'utf8');
      expect(content, entrypoint).toContain('universal_proxy_runtime_probe');
      expect(content, entrypoint).not.toMatch(/curl[^\n]*admin\/state/);
    }
  });

  it('keeps the shared static container config on the current llmup schema', () => {
    const config = readFileSync('infra/deploy/shared/universal-proxy/config.yaml', 'utf8');

    expect(config).toContain('listen: 0.0.0.0:8080');
    expect(config).toContain('upstream_timeout_secs: 120');
    expect(config).toContain('data_auth:\n  mode: client_provider_key');
    expect(config).toContain('upstreams: {}');
    expect(config).toContain('model_aliases: {}');
    expect(config).not.toMatch(/^routes:/m);
  });

  it('starts managed containers with client-provider-key auth and bearer admin probes', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-managed-auth-contract');
    const fixture = prepareRuntimeHelperFixture(tempRoot);

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture)} universal_proxy_runtime_start_managed_container ${shellQuote(readLockedLlmupImage())}`,
    );

    expect(result.status).toBe(0);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    const curlLog = readFileSync(fixture.curlLog, 'utf8');
    expect(dockerLog).toContain('-e LLM_UNIVERSAL_PROXY_AUTH_MODE=client_provider_key');
    expect(dockerLog).toMatch(/-e LLM_UNIVERSAL_PROXY_ADMIN_TOKEN=[^ ]+/);
    expect(dockerLog).not.toContain('LLM_UNIVERSAL_PROXY_KEY');
    expect(curlLog).toMatch(/-H Authorization: Bearer [^ ]+ .*\/admin\/state/);
  });

  it('does not treat a naked admin probe as a reachable bearer-protected proxy', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-naked-admin-probe');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFileSync(path.join(fixture.containersDir, 'started-managed-container.env'), 'id=external\n', 'utf8');

    const result = runRuntimeHelper(
      fixture,
      `export ${runtimeEnvPrefix(fixture)}; if universal_proxy_runtime_probe_url http://127.0.0.1:39180; then printf 'reachable\\n'; exit 7; else printf 'not-reachable\\n'; fi`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('not-reachable');
    expect(existsSync(fixture.curlLog) ? readFileSync(fixture.curlLog, 'utf8') : '').toBe('');
  });

  it('probes explicit admin-token URLs with bearer auth without invoking docker', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-explicit-admin-token');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFileSync(path.join(fixture.containersDir, 'started-managed-container.env'), 'id=external\n', 'utf8');

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture, {
        MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://127.0.0.1:39180',
        MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
      })} universal_proxy_runtime_ensure`,
    );

    expect(result.status).toBe(0);
    expect(readFileSync(fixture.curlLog, 'utf8')).toContain('-H Authorization: Bearer fixture-admin-token');
    expect(existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, 'utf8') : '').toBe('');
  });

  it('removes the recorded container id only after owned docker rm succeeds', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-cleanup-success');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFakeContainer(fixture, {
      id: 'owned-container',
      managedBy: 'universal-proxy-runtime',
      name: 'owned-proxy',
      runtimeLabel: 'test-runtime',
    });
    writeFileSync(fixture.containerIdFile, 'owned-container\n', 'utf8');

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture)} universal_proxy_runtime_cleanup_managed_container`,
    );

    expect(result.status).toBe(0);
    expect(existsSync(fixture.containerIdFile)).toBe(false);
    expect(existsSync(path.join(fixture.containersDir, 'owned-container.env'))).toBe(false);
    expect(readFileSync(fixture.dockerLog, 'utf8')).toContain('docker rm -f owned-container');
  });

  it('keeps the recorded container id when owned docker rm fails', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-cleanup-rm-fail');
    const fixture = prepareRuntimeHelperFixture(tempRoot, { rmFails: true });
    writeFakeContainer(fixture, {
      id: 'owned-container',
      managedBy: 'universal-proxy-runtime',
      name: 'owned-proxy',
      runtimeLabel: 'test-runtime',
    });
    writeFileSync(fixture.containerIdFile, 'owned-container\n', 'utf8');

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture)} universal_proxy_runtime_cleanup_managed_container`,
    );

    expect(result.status).toBe(0);
    expect(readFileSync(fixture.containerIdFile, 'utf8')).toBe('owned-container\n');
    expect(existsSync(path.join(fixture.containersDir, 'owned-container.env'))).toBe(true);
    expect(result.stderr).toContain('failed to remove recorded container owned-container');
  });

  it('clears stale recorded container state when docker confirms the container is absent', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-cleanup-stale-record');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    const metadataFile = `${fixture.containerIdFile}.meta`;
    writeFileSync(fixture.containerIdFile, 'missing-recorded-container\n', 'utf8');
    writeFileSync(
      metadataFile,
      `runtime_label=test-runtime
container_name=missing-proxy
`,
      'utf8',
    );

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture)} universal_proxy_runtime_cleanup_managed_container`,
    );

    expect(result.status).toBe(0);
    expect(existsSync(fixture.containerIdFile)).toBe(false);
    expect(existsSync(metadataFile)).toBe(false);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    expect(dockerLog).toContain('docker container inspect');
    expect(dockerLog).toContain('docker ps');
    expect(dockerLog).not.toContain('docker rm');
    expect(result.stderr).toContain('stale recorded container missing-recorded-container no longer exists');
  });

  it('does not remove a recorded container when the runtime label does not match', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-cleanup-wrong-label');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFakeContainer(fixture, {
      id: 'wrong-label-container',
      managedBy: 'universal-proxy-runtime',
      name: 'wrong-label-proxy',
      runtimeLabel: 'other-runtime',
    });
    writeFileSync(fixture.containerIdFile, 'wrong-label-container\n', 'utf8');

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture)} universal_proxy_runtime_cleanup_managed_container`,
    );

    expect(result.status).toBe(0);
    expect(readFileSync(fixture.containerIdFile, 'utf8')).toBe('wrong-label-container\n');
    expect(existsSync(path.join(fixture.containersDir, 'wrong-label-container.env'))).toBe(true);
    expect(readFileSync(fixture.dockerLog, 'utf8')).not.toContain('docker rm');
    expect(result.stderr).toContain('not owned by this runtime');
  });

  it('fails fast on deterministic container name conflict with a non-managed container', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-name-conflict');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFakeContainer(fixture, {
      id: 'conflict-container',
      managedBy: 'someone-else',
      name: 'agentsmith-conflict-proxy',
      runtimeLabel: 'other-runtime',
    });

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture, { UNIVERSAL_PROXY_RUNTIME_CONTAINER_NAME: 'agentsmith-conflict-proxy' })} universal_proxy_runtime_start_managed_container ${shellQuote(readLockedLlmupImage())}`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('container name conflict');
    expect(result.stderr).toContain('agentsmith-conflict-proxy');
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    expect(dockerLog).toContain('docker ps');
    expect(dockerLog).toContain('docker container inspect');
    expect(dockerLog).not.toContain('docker pull');
    expect(dockerLog).not.toContain('docker run');
    expect(dockerLog).not.toContain('docker rm');
  });

  it('reconciles an owned deterministic container name before starting a replacement', () => {
    const tempRoot = createIsolatedRepoRoot('runtime-owned-name-reconcile');
    const fixture = prepareRuntimeHelperFixture(tempRoot);
    writeFakeContainer(fixture, {
      id: 'old-managed-container',
      managedBy: 'universal-proxy-runtime',
      name: 'agentsmith-owned-proxy',
      runtimeLabel: 'test-runtime',
    });

    const result = runRuntimeHelper(
      fixture,
      `${runtimeEnvPrefix(fixture, { UNIVERSAL_PROXY_RUNTIME_CONTAINER_NAME: 'agentsmith-owned-proxy' })} universal_proxy_runtime_start_managed_container ${shellQuote(readLockedLlmupImage())}`,
    );

    expect(result.status).toBe(0);
    expect(readFileSync(fixture.containerIdFile, 'utf8')).toBe('started-managed-container\n');
    expect(existsSync(path.join(fixture.containersDir, 'old-managed-container.env'))).toBe(false);
    expect(existsSync(path.join(fixture.containersDir, 'started-managed-container.env'))).toBe(true);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    expect(dockerLog).toContain('docker rm -f old-managed-container');
    expect(dockerLog).toContain('docker run');
  });
});
