import type { Page } from '@playwright/test';
import { buildMockExternalConnectionId } from '../../src/mocks/state/me-external-connections';

export type VisualThirdPartyConnectionSeed = {
  provider: 'jira' | 'feishu' | 'github' | 'gitee' | 'custom';
  kind: 'oauth_account' | 'secret_bundle' | 'ssh_keypair';
  displayName: string;
  note?: string | null;
  customDomain?: string | null;
  status?: 'active' | 'expired' | 'reauth_required' | 'error';
  fields: Array<{
    key: string;
    value: string;
    secret?: boolean;
    description?: string | null;
  }>;
  scopes?: string[] | null;
};

export async function seedMockExternalConnectionForVisual(page: Page, seed: VisualThirdPartyConnectionSeed): Promise<string> {
  const headers = {
    'x-mock-connection-provider': seed.provider,
    'x-mock-connection-kind': seed.kind,
    'x-mock-connection-display-name': seed.displayName,
    'x-mock-connection-note': seed.note ?? '',
    'x-mock-connection-custom-domain': seed.customDomain ?? '',
    'x-mock-connection-status': seed.status ?? 'active',
    'x-mock-connection-fields': JSON.stringify(seed.fields),
    'x-mock-connection-scopes': JSON.stringify(seed.scopes ?? null),
  };

  await page.addInitScript((nextHeaders) => {
    (window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> }).__MBOS_MSW_TEST_HEADERS__ = nextHeaders;
  }, headers);
  await page.evaluate((nextHeaders) => {
    (window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> }).__MBOS_MSW_TEST_HEADERS__ = nextHeaders;
  }, headers).catch(() => {});

  return buildMockExternalConnectionId(seed.displayName, seed.provider);
}
