import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('GA user guide cut', () => {
  it('routes Files release sign-off to product readiness', () => {
    const guide = read('docs/user-guides/file-library-access-model.md');

    expect(guide).toContain('npm run product:ready');
    expect(guide).not.toContain('npm run release:ready');
  });

  it('keeps the user guides index on current GA entrypoints instead of transition aliases', () => {
    const guide = read('docs/user-guides/README.md');

    expect(guide).toContain('online` / `airgap` × `use_existing` / `install_substrates');
    expect(guide).toContain('`kit_provided` is only a legacy/internal focused diagnostic alias');
    expect(guide).toContain('it is not a GA operator path or `deployment_path`');
    expect(guide).not.toMatch(/pre-GA\/local diagnostic|local-kind|existing-cluster/i);
    expect(guide).not.toMatch(/GA operator-facing release paths[\s\S]{0,160}`kit_provided`/i);
  });

  it('keeps local deploy diagnostics out of pre-GA phase wording', () => {
    const docs = [
      'docs/user-guides/local-runtime-flows.md',
      'docs/user-guides/runtime-lines-matrix.md',
      'docs/user-guides/unified-deploy-operations.md',
    ].map((path) => `${path}\n${read(path)}`).join('\n');

    expect(docs).toContain('transition-only focused diagnostic');
    expect(docs).not.toMatch(/pre-GA\/local deploy diagnostic|pre-GA\/local diagnostic entry|current pre-GA diagnostic|current pre-GA focused diagnostic|pre-GA diagnostic baseline/i);
  });

  it('removes MVP and pre-GA baseline wording from GA-scoped user guides', () => {
    const docs = [
      'docs/user-guides/identity-and-permission-model.md',
      'docs/user-guides/workspace-isolation-model.md',
      'docs/user-guides/personal-connections.md',
      'docs/user-guides/audit-usage-reports.md',
      'docs/user-guides/alert-center.md',
    ].map((path) => `${path}\n${read(path)}`).join('\n');

    expect(docs).not.toMatch(/current MVP|当前 MVP|pre-GA baseline/i);
  });

  it('does not overclaim audit retention, export, or tamper-proof guarantees', () => {
    const guide = read('docs/user-guides/audit-usage-reports.md');

    expect(guide).not.toMatch(/Retained for \d+ days|retained for \d+ year/i);
    expect(guide).not.toMatch(/write-once|tamper-proof storage/i);
    expect(guide).not.toMatch(/export up to \d+/i);
    expect(guide).toContain('does not claim cryptographic immutability');
  });

  it('keeps Alert Center scoped to in-app project signals', () => {
    const guide = read('docs/user-guides/alert-center.md');

    expect(guide).toContain('in-app project alert surface');
    expect(guide).not.toMatch(/Budget Alert|auto-dismiss|Quiet Hours|Send to registered email|POST to external URL/i);
    expect(guide).not.toMatch(/use webhooks to integrate|Slack|PagerDuty/i);
  });
});
