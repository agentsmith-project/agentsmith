import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkApiSingleReplica } from './check-api-single-replica';
import { renderUnifiedDeployFromFiles } from './render';

const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

describe('api single-replica producer', () => {
  it('accepts the repository rendered output for both profiles', async () => {
    for (const profile of ['local-kind', 'existing-cluster'] as const) {
      const rendered = await renderUnifiedDeployFromFiles({ profile });

      expect(checkApiSingleReplica(rendered.output)).toEqual({
        ok: true,
        failures: [],
      });
    }
  });

  it('rejects an api deployment rendered with more than one replica', () => {
    const rendered = readFileSync(join(fixturesDir, 'api-replicas-two.yaml'), 'utf8');
    const text = checkApiSingleReplica(rendered).failures.map((failure) => failure.message).join('\n');

    expect(text).toContain('api Deployment must render spec.replicas: 1');
  });

  it('rejects multiple api Deployments even when each keeps replicas at one', () => {
    const rendered = readFileSync(join(fixturesDir, 'api-duplicate-single-replicas.yaml'), 'utf8');
    const text = checkApiSingleReplica(rendered).failures.map((failure) => failure.message).join('\n');

    expect(text).toContain('exactly one api Deployment must be rendered');
  });

  it('rejects autoscalers, API_REPLICAS settings, and execution-gateway drift', () => {
    const rendered = readFileSync(join(fixturesDir, 'api-forbidden-drift.yaml'), 'utf8');
    const text = checkApiSingleReplica(rendered).failures.map((failure) => failure.message).join('\n');

    expect(text).toContain('autoscaler must not target api');
    expect(text).toContain('API_REPLICAS must not be rendered');
    expect(text).toContain('execution-gateway must not be rendered');
  });
});
