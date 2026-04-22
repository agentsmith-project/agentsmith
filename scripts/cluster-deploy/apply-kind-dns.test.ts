import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function stageApplyKindDnsFixture(tempRoot: string): void {
  const scriptPath = path.join(repoRoot, 'scripts', 'cluster-deploy', 'apply-kind-dns.sh');
  const stagedScriptPath = path.join(tempRoot, 'scripts', 'cluster-deploy', 'apply-kind-dns.sh');
  const helperScriptPath = path.join(repoRoot, 'scripts', 'lib', 'kind-cluster-bootstrap.sh');
  const stagedHelperScriptPath = path.join(tempRoot, 'scripts', 'lib', 'kind-cluster-bootstrap.sh');

  mkdirSync(path.dirname(stagedScriptPath), { recursive: true });
  copyFileSync(scriptPath, stagedScriptPath);
  mkdirSync(path.dirname(stagedHelperScriptPath), { recursive: true });
  copyFileSync(helperScriptPath, stagedHelperScriptPath);

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(
    path.join(binDir, 'kubectl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${path.join(tempRoot, 'kubectl.log')}"
if [[ "$#" -ge 2 && "$1" == "config" && "$2" == "current-context" ]]; then
  printf '%s\\n' "\${KUBECTL_CURRENT_CONTEXT:-kind-agentsmith}"
  exit 0
fi
if [[ "$#" -ge 5 && "$1" == "-n" && "$2" == "kube-system" && "$3" == "get" && "$4" == "configmap" && "$5" == "coredns" ]]; then
  cat <<'EOF_COREFILE'
.:53 {
    errors
    health
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
      ttl 30
    }
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
EOF_COREFILE
  exit 0
fi
if [[ "$#" -ge 5 && "$1" == "-n" && "$2" == "kube-system" && "$3" == "get" && "$4" == "deployment" && "$5" == "coredns" ]]; then
  exit 0
fi
if [[ "$#" -ge 8 && "$1" == "-n" && "$2" == "kube-system" && "$3" == "patch" && "$4" == "configmap" && "$5" == "coredns" ]]; then
  patch_file=""
  prev=""
  for arg in "$@"; do
    case "$arg" in
      --patch-file=*)
        patch_file="\${arg#--patch-file=}"
        ;;
      *)
        if [[ "$prev" == "--patch-file" ]]; then
          patch_file="$arg"
        fi
        ;;
    esac
    prev="$arg"
  done
  if [[ -n "$patch_file" ]]; then
    cat "$patch_file" > "${path.join(tempRoot, 'applied-config.json')}"
  fi
  exit 0
fi
if [[ "$#" -ge 3 && "$1" == "-n" && "$2" == "kube-system" && "$3" == "rollout" ]]; then
  exit 0
fi
exit 0
`,
  );
}

function runApplyKindDns(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync('bash', [path.join(tempRoot, 'scripts', 'cluster-deploy', 'apply-kind-dns.sh')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOME: tempRoot,
      PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
      KUBECONFIG: path.join(tempRoot, 'kubeconfig'),
      KIND_CLUSTER_DNS_UPSTREAMS: '1.1.1.1 8.8.8.8',
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('cluster kind DNS apply helper', () => {
  it('applies the desired CoreDNS forwarders and restarts coredns for kind contexts', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-kind-dns-apply-'));

    try {
      stageApplyKindDnsFixture(tempRoot);

      const output = runApplyKindDns(tempRoot);
      const appliedConfig = readFileSync(path.join(tempRoot, 'applied-config.json'), 'utf8');
      const kubectlLog = readFileSync(path.join(tempRoot, 'kubectl.log'), 'utf8');

      expect(output).toContain('kind cluster DNS');
      expect(appliedConfig).toContain('forward . 1.1.1.1 8.8.8.8');
      expect(kubectlLog).toContain('-n kube-system patch configmap coredns --type merge');
      expect(kubectlLog).toContain('-n kube-system rollout restart deployment/coredns');
      expect(kubectlLog).toContain('-n kube-system rollout status deployment/coredns --timeout=180s');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips non-kind kube contexts without mutating coredns', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-kind-dns-skip-'));

    try {
      stageApplyKindDnsFixture(tempRoot);

      const output = runApplyKindDns(tempRoot, {
        KUBECTL_CURRENT_CONTEXT: 'prod-cluster',
      });
      const kubectlLog = readFileSync(path.join(tempRoot, 'kubectl.log'), 'utf8');

      expect(output).toContain('skipping kind cluster DNS apply');
      expect(existsSync(path.join(tempRoot, 'applied-config.json'))).toBe(false);
      expect(kubectlLog).not.toContain('get configmap coredns');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
