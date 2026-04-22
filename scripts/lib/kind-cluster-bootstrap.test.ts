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
  it('derives a cluster name from a kind context when no override is provided', () => {
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');

    const output = runBash(`
      source "${helper}"
      kind_cluster_name_from_context_or_override "" "kind-agentsmith"
    `);

    expect(output).toBe('agentsmith');
  });

  it('prefers an explicit cluster name override over the current context', () => {
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');

    const output = runBash(`
      source "${helper}"
      kind_cluster_name_from_context_or_override "explicit-cluster" "kind-agentsmith"
    `);

    expect(output).toBe('explicit-cluster');
  });

  it('computes the control-plane node name from an explicit override', () => {
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');

    const output = runBash(`
      source "${helper}"
      kind_control_plane_node_name_from_context_or_override "kind-local" "explicit-node"
    `);

    expect(output).toBe('explicit-node');
  });

  it('computes the control-plane node name from a kind context when no explicit override is provided', () => {
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');

    const output = runBash(`
      source "${helper}"
      kind_control_plane_node_name_from_context_or_override "kind-agentsmith" ""
    `);

    expect(output).toBe('agentsmith-control-plane');
  });

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

  it('prefers an explicit CoreDNS upstream override over a resolver file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-dns-env-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const resolverFilePath = path.join(tempRoot, 'resolvers.txt');

    runBash(`
      cat > "${resolverFilePath}" <<'EOF_RESOLVERS'
10.96.0.10
10.96.0.11
EOF_RESOLVERS
    `);

    const output = runBash(`
      source "${helper}"
      LOCAL_KIND_COREDNS_UPSTREAMS="10.0.0.2, 10.0.0.3"
      LOCAL_KIND_COREDNS_UPSTREAMS_FILE="${resolverFilePath}"
      kind_resolve_coredns_upstream_resolvers
    `);

    expect(output).toBe('10.0.0.2 10.0.0.3');
  });

  it('uses filtered host resolvers before repo fallbacks when no explicit CoreDNS override is configured', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-dns-host-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const resolvConfPath = path.join(tempRoot, 'resolv.conf');

    runBash(`
      cat > "${resolvConfPath}" <<'EOF_RESOLV'
nameserver 127.0.0.11
nameserver 169.254.20.10
nameserver 172.19.0.1
nameserver 10.0.0.2
nameserver 8.8.8.8
EOF_RESOLV
    `);

    const output = runBash(`
      source "${helper}"
      LOCAL_KIND_COREDNS_BLOCKLIST="172.19.0.1"
      LOCAL_KIND_COREDNS_HOST_RESOLV_CONF="${resolvConfPath}"
      kind_resolve_coredns_upstream_resolvers
    `);

    expect(output).toBe('10.0.0.2 8.8.8.8 1.1.1.1');
  });

  it('falls back to repo defaults when configured CoreDNS upstreams and host resolvers are local-only', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-dns-local-only-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const resolvConfPath = path.join(tempRoot, 'resolv.conf');

    runBash(`
      cat > "${resolvConfPath}" <<'EOF_RESOLV'
nameserver 127.0.0.11
nameserver 127.0.0.1
nameserver 169.254.25.10
nameserver ::1
nameserver localhost
EOF_RESOLV
    `);

    const output = runBash(`
      source "${helper}"
      LOCAL_KIND_COREDNS_UPSTREAMS="127.0.0.11,127.0.0.1,::1,localhost"
      LOCAL_KIND_COREDNS_HOST_RESOLV_CONF="${resolvConfPath}"
      kind_resolve_coredns_upstream_resolvers
    `);

    expect(output).toBe('1.1.1.1 8.8.8.8');
  });

  it('rewrites the CoreDNS forward stanza to explicit upstream resolvers', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'kind-bootstrap-coredns-corefile-'));
    const helper = path.join(process.cwd(), 'scripts/lib/kind-cluster-bootstrap.sh');
    const corefilePath = path.join(tempRoot, 'Corefile');

    runBash(`
      cat > "${corefilePath}" <<'EOF_COREFILE'
.:53 {
    errors
    health {
      lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
      ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf {
      max_concurrent 1000
    }
    cache 30
    loop
    reload
    loadbalance
}
EOF_COREFILE
      source "${helper}"
      kind_rewrite_coredns_corefile_forward_targets "${corefilePath}" 10.0.0.2 10.0.0.3
    `);

    const corefile = readFileSync(corefilePath, 'utf8');
    expect(corefile).toContain('forward . 10.0.0.2 10.0.0.3 {');
    expect(corefile).toContain('max_concurrent 1000');
    expect(corefile).not.toContain('/etc/resolv.conf');
  });
});
