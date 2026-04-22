import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('kind DNS flow contract', () => {
  it('runs the kind DNS apply step during demo full-mode deploy before kubernetes addons roll out', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'demo-deploy', 'deploy.sh');
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('scripts/cluster-deploy/apply-kind-dns.sh');
    expect(script.indexOf('scripts/cluster-deploy/apply-kind-dns.sh')).toBeLessThan(
      script.indexOf('kubectl apply -f "${RELEASE_ROOT}/k8s/juicefs-csi.yaml"'),
    );
  });

  it('loads site.env into the environment before cluster sandbox applies kind DNS and rewrites runtime kubeconfig', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'cluster-deploy', 'deploy-sandbox.sh');
    const script = readFileSync(scriptPath, 'utf8');

    const exportStart = script.indexOf('set -a');
    const siteEnvSource = script.indexOf('source "${RELEASE_ROOT}/env/site.env"');
    const applyKindDns = script.indexOf('scripts/cluster-deploy/apply-kind-dns.sh');
    const exportStop = script.indexOf('set +a');

    expect(script).toContain('scripts/cluster-deploy/apply-kind-dns.sh');
    expect(exportStart).toBeLessThan(siteEnvSource);
    expect(siteEnvSource).toBeLessThan(applyKindDns);
    expect(siteEnvSource).toBeLessThan(exportStop);
    expect(exportStop).toBeLessThan(applyKindDns);
    expect(applyKindDns).toBeLessThan(
      script.indexOf('RUNTIME_MANAGER_KUBECONFIG="${STATE_DIR}/manager-kubeconfig.runtime"'),
    );
  });
});
