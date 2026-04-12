import type { Page } from '@playwright/test';
import type { UserExternalConnection } from '../../src/lib/api';
import { buildMockExternalConnectionId } from '../../src/mocks/state/me-external-connections';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '../../src/lib/mock-time';

const VISUAL_SEED_STORAGE_KEY = '__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__';

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

function buildVisualThirdPartyAccountRecord(seed: VisualThirdPartyConnectionSeed, userId: string): UserExternalConnection {
  const id = buildMockExternalConnectionId(seed.displayName, seed.provider);
  return {
    id,
    user_id: userId,
    provider: seed.provider,
    kind: seed.kind,
    display_name: seed.displayName,
    note: seed.note ?? null,
    custom_domain: seed.customDomain ?? null,
    status: seed.status ?? 'active',
    fields: seed.fields.map((field) => ({
      key: field.key,
      description: field.description ?? null,
      secret: field.secret !== false,
      masked_value: field.secret === false ? field.value : '••••••••',
    })),
    account_identity: null,
    scopes: seed.scopes ?? null,
    expires_at: null,
    last_refreshed_at: null,
    last_used_at: null,
    last_error: null,
    reauth_reason: null,
    missing_scopes: null,
    workspace_id: null,
    created_at: VISUAL_TEST_REFERENCE_NOW_ISO,
    updated_at: VISUAL_TEST_REFERENCE_NOW_ISO,
  };
}

function setVisualThirdPartyAccountsBootstrap(record: UserExternalConnection) {
  try {
    window.localStorage.setItem(VISUAL_SEED_STORAGE_KEY, JSON.stringify([record]));
  } catch {
    // If storage is unavailable, the in-memory bootstrap channel below still covers first paint.
  }
  (window as Window & { __MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__?: UserExternalConnection[] }).__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [record];
}

export async function seedMockExternalConnectionForVisual(page: Page, seed: VisualThirdPartyConnectionSeed): Promise<string> {
  const authContext = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__ ?? null).catch(() => null) as {
    userId?: string | null;
  } | null;
  const userId = typeof authContext?.userId === 'string' && authContext.userId.trim().length > 0
    ? authContext.userId
    : 'user_001';
  const visualRecord = buildVisualThirdPartyAccountRecord(seed, userId);
  await page.addInitScript(setVisualThirdPartyAccountsBootstrap, visualRecord);
  await page.evaluate(setVisualThirdPartyAccountsBootstrap, visualRecord).catch(() => {});

  return visualRecord.id;
}
