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
  const userId = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__?.userId ?? null).catch(() => null);
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

  if ('waitForFunction' in page && typeof page.waitForFunction === 'function') {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
      timeout: 15_000,
    }).catch(() => {});
  }

  const response = await page.evaluate(async ({ nextUserId, nextSeed }) => {
    const token = (window as Window & { __MBOS_AUTH_E2E_CONTEXT__?: { token?: string | null } }).__MBOS_AUTH_E2E_CONTEXT__?.token ?? null;
    if (!token) {
      throw new Error('visual_auth_context_token_not_found');
    }

    const fetchResponse = await fetch('/api/test/me/external-connections/seed', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: nextUserId,
        replace_existing: true,
        connection: {
          provider: nextSeed.provider,
          kind: nextSeed.kind,
          display_name: nextSeed.displayName,
          note: nextSeed.note ?? null,
          custom_domain: nextSeed.customDomain ?? null,
          status: nextSeed.status ?? 'active',
          fields: nextSeed.fields,
          scopes: nextSeed.scopes ?? null,
        },
      }),
    });
    return {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      body: await fetchResponse.text(),
    };
  }, {
    nextUserId: typeof userId === 'string' && userId.trim().length > 0 ? userId : 'user_001',
    nextSeed: seed,
  }).catch((error: unknown) => {
    throw new Error(`seed_mock_external_connection_failed:${error instanceof Error ? error.message : String(error)}`);
  }) as { ok: boolean; status: number; body: string };

  if (!response.ok) {
    throw new Error(`seed_mock_external_connection_failed:${response.status}:${response.body}`);
  }

  const parsed = (response.body ? JSON.parse(response.body) : null) as { id?: string | null; items?: unknown[] | null } | null;
  const items = Array.isArray(parsed?.items) ? parsed.items : null;
  if (items) {
    const nextItems = items as unknown[];
    await page.addInitScript((seededItems) => {
      (window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = seededItems;
    }, nextItems);
    await page.evaluate((seededItems) => {
      (window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: unknown[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = seededItems;
    }, nextItems).catch(() => {});
  }

  const connectionId = parsed?.id?.trim();
  if (!connectionId) {
    throw new Error('seed_mock_external_connection_id_not_found');
  }

  return connectionId || buildMockExternalConnectionId(seed.displayName, seed.provider);
}
