import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBash(script: string): string {
  return execFileSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

describe('kind-cluster-bootstrap', () => {
  it('removes proxy env blocks from kubeadm control-plane manifests', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const manifestPath = path.join(tempRoot, 'kube-apiserver.yaml');

    runBash(`
      cat > "${manifestPath}" <<'EOF_MANIFEST'
apiVersion: v1
kind: Pod
spec:
  containers:
  - command:
    - kube-apiserver
    env:
    - name: HTTPS_PROXY
      value: http://192.168.0.210:8889
    - name: HTTP_PROXY
      value: http://192.168.0.210:8889
    - name: NO_PROXY
      value: localhost,127.0.0.1
    image: registry.k8s.io/kube-apiserver:v1.32.2
EOF_MANIFEST
      source "${helper}"
      kind_manifest_strip_proxy_env_file "${manifestPath}"
    `);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).not.toContain('HTTPS_PROXY');
    expect(manifest).not.toContain('HTTP_PROXY');
    expect(manifest).not.toContain('NO_PROXY');
    expect(manifest).toContain('image: registry.k8s.io/kube-apiserver:v1.32.2');
    expect(manifest).not.toContain('\n    env:\n');
  });

  it('preserves non-proxy env blocks', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-preserve-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const manifestPath = path.join(tempRoot, 'kube-apiserver.yaml');

    runBash(`
      cat > "${manifestPath}" <<'EOF_MANIFEST'
apiVersion: v1
kind: Pod
spec:
  containers:
  - command:
    - kube-apiserver
    env:
    - name: KUBE_CACHE_MUTATION_DETECTOR
      value: "true"
    image: registry.k8s.io/kube-apiserver:v1.32.2
EOF_MANIFEST
      source "${helper}"
      kind_manifest_strip_proxy_env_file "${manifestPath}"
    `);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('KUBE_CACHE_MUTATION_DETECTOR');
    expect(manifest).toContain('\n    env:\n');
  });

  it('removes only proxy entries from mixed env blocks', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-mixed-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const manifestPath = path.join(tempRoot, 'kube-apiserver.yaml');

    runBash(`
      cat > "${manifestPath}" <<'EOF_MANIFEST'
apiVersion: v1
kind: Pod
spec:
  containers:
  - command:
    - kube-apiserver
    env:
    - name: HTTPS_PROXY
      value: http://192.168.0.210:8889
    - name: KUBE_CACHE_MUTATION_DETECTOR
      value: "true"
    - name: NO_PROXY
      value: localhost,127.0.0.1
    image: registry.k8s.io/kube-apiserver:v1.32.2
EOF_MANIFEST
      source "${helper}"
      kind_manifest_strip_proxy_env_file "${manifestPath}"
    `);

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).not.toContain('HTTPS_PROXY');
    expect(manifest).not.toContain('NO_PROXY');
    expect(manifest).toContain('KUBE_CACHE_MUTATION_DETECTOR');
    expect(manifest).toContain('\n    env:\n');
  });

  it('writes a docker config copy without proxy defaults', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-docker-config-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const sourceConfigPath = path.join(tempRoot, 'source-config.json');
    const destinationConfigPath = path.join(tempRoot, 'dest-config.json');

    runBash(`
      cat > "${sourceConfigPath}" <<'EOF_CONFIG'
{
  "auths": {
    "localhost:5001": {
      "auth": "abc123"
    }
  },
  "proxies": {
    "default": {
      "httpProxy": "http://192.168.0.210:8889",
      "httpsProxy": "http://192.168.0.210:8889",
      "noProxy": "localhost,127.0.0.1"
    }
  }
}
EOF_CONFIG
      source "${helper}"
      kind_write_docker_config_without_proxies "${sourceConfigPath}" "${destinationConfigPath}"
    `);

    const config = JSON.parse(readFileSync(destinationConfigPath, 'utf8')) as {
      auths?: Record<string, unknown>;
      proxies?: Record<string, unknown>;
    };

    expect(config.auths).toEqual({
      'localhost:5001': {
        auth: 'abc123',
      },
    });
    expect(config.proxies).toBeUndefined();
  });
});
