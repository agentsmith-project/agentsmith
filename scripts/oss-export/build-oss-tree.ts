import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  ALWAYS_REMOVE_PATHS,
  KEEP_ROOT_SCRIPTS,
  KEEP_SCRIPT_DIR_PATTERNS,
  OSS_GITHUB_REPO,
  OSS_TARGET_DIR,
  REMOVE_ROOT_DEV_DEPENDENCIES,
  REMOVE_SCRIPT_DIR_PATTERNS,
  ROOT_INCLUDE_DIRS,
  ROOT_INCLUDE_FILES,
} from './export-manifest.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const SOURCE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

const EXTRA_REMOVE_PATHS = [
  'infra/integration',
  'src/mocks',
  'src/stories',
  'src/test',
  'infra/deploy/Dockerfile.agentsmith-verify-runner',
  'infra/deploy/Dockerfile.agentsmith-verify-runner-base',
  'infra/runtime/backend-real.env',
  'scripts/demo-deploy/verify.sh',
  'scripts/cluster-deploy/verify.sh',
  'scripts/cluster-deploy/prepare-admin-handoff.sh',
  'scripts/cluster-deploy/report.sh',
  'scripts/lib/backend-real-env.sh',
  'scripts/lib/backend-real-state.sh',
] as const;

function run(cmd: string, args: string[], cwd = ROOT, capture = false): string {
  const result = execFileSync(cmd, args, {
    cwd,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: capture ? 'utf8' : undefined,
  });
  return typeof result === 'string' ? result.trim() : '';
}

function shell(script: string, cwd = OSS_TARGET_DIR): void {
  execFileSync('bash', ['-lc', script], { cwd, stdio: 'inherit' });
}

function ensureCleanTarget(): void {
  rmSync(OSS_TARGET_DIR, { recursive: true, force: true });
  mkdirSync(OSS_TARGET_DIR, { recursive: true });
}

function copySelectedRoots(): void {
  for (const file of ROOT_INCLUDE_FILES) {
    const from = join(ROOT, file);
    if (!existsSync(from)) continue;
    run('cp', ['-a', from, join(OSS_TARGET_DIR, file)]);
  }
  for (const dir of ROOT_INCLUDE_DIRS) {
    const from = join(ROOT, dir);
    if (!existsSync(from)) continue;
    run('cp', ['-a', from, join(OSS_TARGET_DIR, dir)]);
  }
}

function removeAlwaysRemoved(): void {
  for (const item of [...ALWAYS_REMOVE_PATHS, ...EXTRA_REMOVE_PATHS]) {
    rmSync(join(OSS_TARGET_DIR, item), { recursive: true, force: true });
  }
}

function pruneTestFiles(): void {
  shell(`
    shopt -s globstar nullglob
    rm -rf **/__tests__
    rm -rf **/__integration__
    rm -f **/*.test.ts **/*.test.tsx **/*.spec.ts **/*.spec.tsx **/*.snap
    rm -f **/vitest.config.ts **/playwright.config*.ts
  `);
}

function pruneScripts(): void {
  shell(`
    shopt -s globstar nullglob
    mkdir -p .oss-tmp/scripts
    for pattern in ${KEEP_SCRIPT_DIR_PATTERNS.map((p) => `'${p}'`).join(' ')}; do
      for path in $pattern; do
        if [[ -e "$path" ]]; then
          mkdir -p ".oss-tmp/scripts/$(dirname "$path")"
          cp -a "$path" ".oss-tmp/scripts/$path"
        fi
      done
    done
    rm -rf scripts
    mkdir -p scripts
    if [[ -d .oss-tmp/scripts/scripts ]]; then
      cp -a .oss-tmp/scripts/scripts/. scripts/
    fi
    rm -rf .oss-tmp
    for pattern in ${REMOVE_SCRIPT_DIR_PATTERNS.map((p) => `'${p}'`).join(' ')}; do
      rm -rf $pattern
    done
  `);
}

function rewriteRootPackageJson(): void {
  const rootPkgPath = join(OSS_TARGET_DIR, 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as Record<string, any>;
  rootPkg.name = 'agentsmith-oss';
  rootPkg.private = false;
  rootPkg.scripts = { ...KEEP_ROOT_SCRIPTS };
  for (const dep of REMOVE_ROOT_DEV_DEPENDENCIES) {
    if (rootPkg.devDependencies) delete rootPkg.devDependencies[dep];
  }
  writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 2)}\n`);
}

function collectPackageJsonFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry === 'package.json') {
        out.push(full);
      }
    }
  };
  if (existsSync(rootDir)) walk(rootDir);
  return out.sort();
}

function rewriteWorkspacePackageScripts(): void {
  const devDepBlocklist = [/vitest/i, /playwright/i, /storybook/i, /testing-library/i, /jsdom/i, /msw/i];
  for (const file of collectPackageJsonFiles(join(OSS_TARGET_DIR, 'packages'))) {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
    if (pkg.scripts) {
      for (const key of Object.keys(pkg.scripts)) {
        if (key === 'test' || key.startsWith('test:') || key.includes('storybook')) {
          delete pkg.scripts[key];
        }
      }
      if (Object.keys(pkg.scripts).length === 0) delete pkg.scripts;
    }
    if (pkg.devDependencies) {
      for (const key of Object.keys(pkg.devDependencies)) {
        if (devDepBlocklist.some((pattern) => pattern.test(key))) {
          delete pkg.devDependencies[key];
        }
      }
      if (Object.keys(pkg.devDependencies).length === 0) delete pkg.devDependencies;
    }
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

function rewriteLintAndTsConfig(): void {
  writeFileSync(
    join(OSS_TARGET_DIR, 'eslint.config.mjs'),
    [
      'import { dirname } from "path";',
      'import { fileURLToPath } from "url";',
      'import { FlatCompat } from "@eslint/eslintrc";',
      '',
      'const __filename = fileURLToPath(import.meta.url);',
      'const __dirname = dirname(__filename);',
      'const compat = new FlatCompat({ baseDirectory: __dirname });',
      'const config = [',
      '',
      '  ...compat.extends("next/core-web-vitals", "next/typescript"),',
      '  {',
      '    rules: {',
      '      "@typescript-eslint/no-unused-vars": [',
      '        "error",',
      '        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }',
      '      ],',
      '      "@typescript-eslint/no-explicit-any": "error",',
      '      "@typescript-eslint/no-require-imports": "off",',
      '      "react/no-unescaped-entities": "off",',
      '      "react-hooks/rules-of-hooks": "warn",',
      '      "@next/next/no-img-element": "off"',
      '    }',
      '  },',
      '  {',
      '    ignores: [',
      '      "node_modules/**",',
      '      ".next/**",',
      '      "out/**",',
      '      "public/mockServiceWorker.js",',
      '      "next-env.d.ts"',
      '    ]',
      '  }',
      '];',
      'export default config;',
      '',
    ].join('\n'),
  );

  const tsconfig = JSON.parse(readFileSync(join(OSS_TARGET_DIR, 'tsconfig.json'), 'utf8')) as Record<string, any>;
  if (tsconfig.compilerOptions) delete tsconfig.compilerOptions.types;
  tsconfig.exclude = ['node_modules'];
  writeFileSync(join(OSS_TARGET_DIR, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
}

function rewriteDeployScripts(): void {
  const clusterDeployPath = join(OSS_TARGET_DIR, 'scripts', 'cluster-deploy', 'deploy.sh');
  if (existsSync(clusterDeployPath)) {
    writeFileSync(
      clusterDeployPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"',
        'source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"',
        '',
        'ensure_dirs',
        'ensure_operator_site_env',
        'set -a',
        'source "${RELEASE_ROOT}/env/site.env"',
        'set +a',
        'require_supported_cluster_deploy_mode',
        '',
        'bash "${ROOT_DIR}/scripts/cluster-deploy/publish-images.sh"',
        'bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-substrate.sh"',
        'bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-app.sh"',
        '',
        'if [[ "$(cluster_deploy_mode)" == "full-auto" ]]; then',
        '  bash "${ROOT_DIR}/scripts/cluster-deploy/apply-cluster-prereqs.sh"',
        '  bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"',
        '  bash "${ROOT_DIR}/scripts/cluster-deploy/bootstrap.sh"',
        'else',
        '  printf "[cluster-deploy] application resources are deployed; continue with cluster prerequisite setup and sandbox deployment as needed.\\n"',
        'fi',
        '',
      ].join('\n'),
    );
    run('chmod', ['+x', clusterDeployPath]);
  }

  const clusterCheckBundlePath = join(OSS_TARGET_DIR, 'scripts', 'cluster-deploy', 'check-bundle-inputs.sh');
  if (existsSync(clusterCheckBundlePath)) {
    let content = readFileSync(clusterCheckBundlePath, 'utf8');
    content = content.replace(/\s*"\$\{ROOT_DIR\}\/scripts\/cluster-deploy\/prepare-admin-handoff\.sh"\n/g, '\n');
    content = content.replace(/\s*"\$\{ROOT_DIR\}\/scripts\/cluster-deploy\/verify\.sh"\n/g, '\n');
    content = content.replace(/\s*"\$\{ROOT_DIR\}\/scripts\/cluster-deploy\/report\.sh"\n/g, '\n');
    content = content.replace(/\s*bash "\$\{ROOT_DIR\}\/scripts\/cluster-deploy\/prepare-admin-handoff\.sh".*\n/g, '');
    writeFileSync(clusterCheckBundlePath, content);
  }

  const clusterBuildBundlePath = join(OSS_TARGET_DIR, 'scripts', 'cluster-deploy', 'build-bundle.sh');
  if (existsSync(clusterBuildBundlePath)) {
    let content = readFileSync(clusterBuildBundlePath, 'utf8');
    content = content.replace(/\n\s*--exclude='playwright-report' \\\n/g, '\n');
    writeFileSync(clusterBuildBundlePath, content);
  }

  const clusterBuildImagesPath = join(OSS_TARGET_DIR, 'scripts', 'cluster-deploy', 'build-images.sh');
  if (existsSync(clusterBuildImagesPath)) {
    writeFileSync(
      clusterBuildImagesPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"',
        'source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"',
        'source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"',
        '',
        'ensure_operator_registry_env',
        'load_registry_env',
        'require_cmd docker',
        '',
        'K8S_REGISTRY_HOST="${K8S_REGISTRY_HOST:-${REGISTRY_HOST}}"',
        'APP_SOURCE_DIR="${RELEASE_ROOT}/sources/agentsmith"',
        'SANDBOX_SOURCE_DIR="${RELEASE_ROOT}/sources/mbos-sandbox-v1/manager-service"',
        'UNIVERSAL_PROXY_SOURCE_DIR="${RELEASE_ROOT}/sources/llm-universal-proxy"',
        '',
        '[[ -d "${APP_SOURCE_DIR}" ]] || die "missing bundled agentsmith source at ${APP_SOURCE_DIR}"',
        '[[ -d "${SANDBOX_SOURCE_DIR}" ]] || die "missing bundled sandbox manager source at ${SANDBOX_SOURCE_DIR}"',
        '[[ -d "${UNIVERSAL_PROXY_SOURCE_DIR}" ]] || die "missing bundled universal proxy source at ${UNIVERSAL_PROXY_SOURCE_DIR}"',
        '',
        'IMAGE_PREFIX="${REGISTRY_HOST}/${REGISTRY_PROJECT}"',
        'JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"',
        'INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-v1.15.1}"',
        '',
        'APP_BASE_IMAGE="agentsmith-app-base:${RELEASE_ID}"',
        'RUNNER_BASE_IMAGE="agentsmith-codex-runner-base:${RELEASE_ID}"',
        'APP_IMAGE="${IMAGE_PREFIX}/agentsmith-app:${RELEASE_ID}"',
        'RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-codex-runner:${RELEASE_ID}"',
        'SANDBOX_MANAGER_IMAGE="${IMAGE_PREFIX}/sandbox-manager:${RELEASE_ID}"',
        'UNIVERSAL_PROXY_IMAGE="${IMAGE_PREFIX}/llm-universal-proxy:${RELEASE_ID}"',
        '',
        'APP_NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE:-node:24.14.1-bookworm}"',
        'RUNNER_NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE:-node:24.14.1-bookworm}"',
        'SANDBOX_GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE:-golang:1.25-alpine}"',
        'SANDBOX_RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE:-ubuntu:22.04}"',
        'UNIVERSAL_PROXY_RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE:-rust:1.88-bookworm}"',
        'UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE:-debian:bookworm-slim}"',
        '',
        'docker_build_local --build-arg NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE}" -t "${APP_BASE_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" "${APP_SOURCE_DIR}"',
        'docker_build_local --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" --build-arg NODE_RUNTIME_IMAGE="${APP_NODE_BASE_IMAGE}" -t "${APP_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app" "${APP_SOURCE_DIR}"',
        'docker_build_local --build-arg NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE}" -t "${RUNNER_BASE_IMAGE}" -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${APP_SOURCE_DIR}"',
        'docker_build_local --build-arg RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${APP_SOURCE_DIR}"',
        'docker_build_local --build-arg GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE}" --build-arg RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE}" -t "${SANDBOX_MANAGER_IMAGE}" -f "${SANDBOX_SOURCE_DIR}/Dockerfile" "${SANDBOX_SOURCE_DIR}"',
        'docker_build_local --build-arg RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" --build-arg RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" -t "${UNIVERSAL_PROXY_IMAGE}" -f "${UNIVERSAL_PROXY_SOURCE_DIR}/Dockerfile" "${UNIVERSAL_PROXY_SOURCE_DIR}"',
        '',
        'cat > "${RELEASE_ROOT}/VERSION" <<EOF',
        'release_id=${RELEASE_ID}',
        'agentsmith_app_image=${APP_IMAGE}',
        'agentsmith_runner_image=${RUNNER_IMAGE}',
        'agentsmith_runner_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/agentsmith-codex-runner:${RELEASE_ID}',
        'sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}',
        'sandbox_manager_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/sandbox-manager:${RELEASE_ID}',
        'llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}',
        'juicefs_csi_version=${JUICEFS_CSI_VERSION}',
        'ingress_nginx_version=${INGRESS_NGINX_VERSION}',
        'registry_host=${REGISTRY_HOST}',
        'k8s_registry_host=${K8S_REGISTRY_HOST}',
        'registry_project=${REGISTRY_PROJECT}',
        'EOF',
        '',
        'log "build-images ok"',
        '',
      ].join('\n'),
    );
    run('chmod', ['+x', clusterBuildImagesPath]);
  }

  const demoBundlePath = join(OSS_TARGET_DIR, 'scripts', 'demo-deploy', 'build-offline-bundle.sh');
  if (existsSync(demoBundlePath)) {
    let content = readFileSync(demoBundlePath, 'utf8');
    content = content.replace(/^.*VERIFY_RUNNER_BASE_HASH.*$/gm, '');
    content = content.replace(/^.*VERIFY_RUNNER_BASE_IMAGE.*$/gm, '');
    content = content.replace(/^.*VERIFY_RUNNER_IMAGE.*$/gm, '');
    content = content.replace(/^.*Dockerfile\.agentsmith-verify-runner-base.*$/gm, '');
    content = content.replace(/^.*Dockerfile\.agentsmith-verify-runner.*$/gm, '');
    content = content.replace(/^.*agentsmith-verify-runner.*$/gm, '');
    writeFileSync(demoBundlePath, content);
  }
}

function rewriteInternalLabels(): void {
  const governanceRunnerPath = join(OSS_TARGET_DIR, 'packages', 'api-entry-node', 'src', 'governance-runner.ts');
  if (existsSync(governanceRunnerPath)) {
    let content = readFileSync(governanceRunnerPath, 'utf8');
    content = content.replace(/backend-real/g, 'runtime');
    writeFileSync(governanceRunnerPath, content);
  }

  const registryEnvPath = join(OSS_TARGET_DIR, 'infra', 'deploy', 'cluster', 'env', 'registry.env.example');
  if (existsSync(registryEnvPath)) {
    let content = readFileSync(registryEnvPath, 'utf8');
    content = content.replace(/^VERIFY_PLAYWRIGHT_BASE_IMAGE=.*$/gm, '');
    writeFileSync(registryEnvPath, content);
  }
}

function rewriteRuntimeProviders(): void {
  const mswProviderPath = join(OSS_TARGET_DIR, 'src', 'components', 'providers', 'MSWProvider.tsx');
  if (existsSync(mswProviderPath)) {
    writeFileSync(mswProviderPath, [
      "'use client';",
      '',
      'export function MSWProvider({ children }: { children: React.ReactNode }) {',
      '  return <>{children}</>;',
      '}',
      '',
    ].join('\n'));
  }
}

function rewriteDocs(): void {
  rmSync(join(OSS_TARGET_DIR, 'docs'), { recursive: true, force: true });
  mkdirSync(join(OSS_TARGET_DIR, 'docs'), { recursive: true });

  writeFileSync(join(OSS_TARGET_DIR, 'README.md'), `# AgentSmith OSS\n\nAgentSmith OSS is the public application and runner distribution for AgentSmith. This repository keeps the runtime code, build assets, and public deployment path, while leaving out the private validation and internal operations suites from the source repository.\n\n## Included\n\n- Next.js application and API entry packages\n- Codex runner package and runner images\n- Docker build assets\n- Public demo and cluster deployment scripts\n- Runtime documentation for deployment and runner paths\n\n## Quick Start\n\n\`\`\`bash\nnpm install\nnpm run build\n\`\`\`\n\n## Packaging\n\n\`\`\`bash\nnpm run docker:app\nnpm run docker:runner\n\`\`\`\n\n## Deployment\n\nSee [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) and [docs/RUNNER_RUNTIME.md](./docs/RUNNER_RUNTIME.md).\n\n## Provenance\n\nThis OSS repository is generated from the private source repo. See [OSS_SYNC_SOURCE.json](./OSS_SYNC_SOURCE.json) for the source commit used for this export.\n`);

  writeFileSync(join(OSS_TARGET_DIR, 'Makefile'), `.PHONY: help dev build start lint ws-typecheck ws-build docker-app docker-runner\n\nhelp:\n\t@echo "make dev"\n\t@echo "make build"\n\t@echo "make start"\n\t@echo "make lint"\n\t@echo "make ws-typecheck"\n\t@echo "make ws-build"\n\t@echo "make docker-app"\n\t@echo "make docker-runner"\n\ndev:\n\tnpm run dev\n\nbuild:\n\tnpm run build\n\nstart:\n\tnpm run start\n\nlint:\n\tnpm run lint\n\nws-typecheck:\n\tnpm run ws:typecheck\n\nws-build:\n\tnpm run ws:build\n\ndocker-app:\n\tnpm run docker:app\n\ndocker-runner:\n\tnpm run docker:runner\n`);

  writeFileSync(join(OSS_TARGET_DIR, 'docs', 'README.md'), `# OSS Docs\n\n- [Deployment](./DEPLOYMENT.md)\n- [Runner Runtime Paths](./RUNNER_RUNTIME.md)\n`);

  writeFileSync(join(OSS_TARGET_DIR, 'docs', 'DEPLOYMENT.md'), `# Deployment\n\nThis OSS repository keeps the public build and deployment path for the application and runner images.\n\n## Available commands\n\n- \`npm run demo:bundle\`\n- \`npm run demo:prepare\`\n- \`npm run demo:deploy\`\n- \`npm run demo:bootstrap\`\n- \`npm run cluster:bundle\`\n- \`npm run cluster:prepare\`\n- \`npm run cluster:publish-images\`\n- \`npm run cluster:deploy-substrate\`\n- \`npm run cluster:deploy-app\`\n- \`npm run cluster:apply-cluster-prereqs\`\n- \`npm run cluster:deploy-sandbox\`\n- \`npm run cluster:deploy\`\n- \`npm run cluster:bootstrap\`\n\n## Notes\n\nThis public distribution focuses on packaging and deployment. Private validation suites and internal operations wrappers are intentionally left out.\n`);

  writeFileSync(join(OSS_TARGET_DIR, 'docs', 'RUNNER_RUNTIME.md'), `# Runner Runtime Paths\n\n## Modes\n\n| Mode | Workspace root (cwd) | CODEX_HOME | HOME | Artifacts | Credentials | Builtin skills visible to Codex by default |\n| --- | --- | --- | --- | --- | --- | --- |\n| External bare | \`${'${MBOS_AGENT_WORKSPACE_ROOT:-$HOST_HOME/ags-workspaces}/<workspace_dir_name>/'}\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/'}\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/home/'}\` | \`<cwd>/.artifacts/\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/credentials/<task_id>/'}\` | host-dependent Codex-visible roots |\n| External docker | \`${'${MBOS_AGENT_WORKSPACE_ROOT:-/workspace/ags-workspaces}/<workspace_dir_name>/'}\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/'}\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/home/'}\` | \`<cwd>/.artifacts/\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/credentials/<task_id>/'}\` | \`/etc/codex/skills\` |\n| Internal | \`/workspace/\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/'}\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/tasks/<task_id>/home/'}\` | \`/workspace/.artifacts/\` | \`${'${MBOS_AGENT_CODEX_STATE_ROOT:-/var/tmp/agentsmith-codex}/<workspace-key>/credentials/<task_id>/'}\` | \`/etc/codex/skills\` |\n\n## How Codex uses these paths\n\n| Path | Purpose | How Codex consumes it |\n| --- | --- | --- |\n| \`cwd\` | Active project files | Command execution, file reads, edits, and repo discovery all happen relative to this root. |\n| \`CODEX_HOME\` | Task-scoped Codex state | Session state, sqlite state, snapshots, and generated task config live here. Notebook resume stays within the current task scope because \`resume --last\` resolves inside this directory. |\n| \`HOME\` | Task-scoped runner home | Codex user-scoped discovery roots such as \`$HOME/.agents/skills\` resolve from here when the runner is not relying on container-level admin skills. |\n| Artifacts directory | Final outputs | The runner writes notebook outputs here so the application can surface them in the task UI. |\n| Credentials directory | Task credential material | The runner writes credential files here and helper scripts consume them without polluting the workspace tree. |\n| \`/etc/codex/skills\` | Container-level builtin skills | In containerized runs, Codex discovers admin-scoped builtin skills from this location. |\n\n## Skill discovery note\n\nThe runner can validate that builtin skills exist in repository-managed source paths, but Codex only exposes skills that are visible inside its runtime discovery roots, such as \`/etc/codex/skills\`, \`$HOME/.agents/skills\`, \`$CODEX_HOME/skills\`, and repo \`.agents/skills\`. This is why containerized runs and host-level bare runs can report different visible skill sets even when the runner configuration is otherwise correct.\n`);


}


function generateLockfile(): void {
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--fund=false'], OSS_TARGET_DIR);
}

function writeProvenance(): void {
  const payload = {
    source_repo: ROOT,
    source_sha: SOURCE_SHA,
    exported_at: new Date().toISOString(),
    export_repo: OSS_GITHUB_REPO,
    export_format_version: 2,
  };
  writeFileSync(join(OSS_TARGET_DIR, 'OSS_SYNC_SOURCE.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

ensureCleanTarget();
copySelectedRoots();
removeAlwaysRemoved();
pruneTestFiles();
pruneScripts();
rewriteRootPackageJson();
rewriteWorkspacePackageScripts();
rewriteLintAndTsConfig();
rewriteDeployScripts();
rewriteInternalLabels();
rewriteRuntimeProviders();
rewriteDocs();
writeProvenance();
generateLockfile();
console.log(`OSS tree generated at ${OSS_TARGET_DIR} from ${relative(ROOT, OSS_TARGET_DIR) || '.'} @ ${SOURCE_SHA}`);
