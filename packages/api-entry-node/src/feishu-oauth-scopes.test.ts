import { describe, expect, it } from 'vitest';
import {
  buildFeishuMissingScopesError,
  findMissingFeishuDocsScopes,
  getCanonicalFeishuOAuthScopes,
  getFeishuOAuthScopePolicy,
} from './feishu-oauth-scopes.js';

describe('feishu-oauth-scopes', () => {
  it('uses the full default Feishu OAuth scope set when env is not configured', () => {
    const original = process.env.FEISHU_OAUTH_SCOPES;
    const originalPolicy = process.env.FEISHU_OAUTH_SCOPE_POLICY;
    delete process.env.FEISHU_OAUTH_SCOPES;
    delete process.env.FEISHU_OAUTH_SCOPE_POLICY;
    try {
      const scopes = getCanonicalFeishuOAuthScopes();
      expect(getFeishuOAuthScopePolicy()).toBe('full');
      expect(scopes).toContain('offline_access');
      expect(scopes).toContain('search:docs:read');
      expect(scopes).toContain('wiki:wiki');
      expect(scopes).toContain('wiki:wiki:readonly');
      expect(scopes).toContain('wiki:node:retrieve');
    } finally {
      if (original === undefined) {
        delete process.env.FEISHU_OAUTH_SCOPES;
      } else {
        process.env.FEISHU_OAUTH_SCOPES = original;
      }
      if (originalPolicy === undefined) {
        delete process.env.FEISHU_OAUTH_SCOPE_POLICY;
      } else {
        process.env.FEISHU_OAUTH_SCOPE_POLICY = originalPolicy;
      }
    }
  });

  it('treats FEISHU_OAUTH_SCOPES as a backward-compatible custom scope policy when policy is unset', () => {
    const original = process.env.FEISHU_OAUTH_SCOPES;
    const originalPolicy = process.env.FEISHU_OAUTH_SCOPE_POLICY;
    process.env.FEISHU_OAUTH_SCOPES = 'offline_access search:docs:read';
    delete process.env.FEISHU_OAUTH_SCOPE_POLICY;
    try {
      expect(getFeishuOAuthScopePolicy()).toBe('custom');
      expect(getCanonicalFeishuOAuthScopes()).toEqual(['offline_access', 'search:docs:read']);
    } finally {
      if (original === undefined) {
        delete process.env.FEISHU_OAUTH_SCOPES;
      } else {
        process.env.FEISHU_OAUTH_SCOPES = original;
      }
      if (originalPolicy === undefined) {
        delete process.env.FEISHU_OAUTH_SCOPE_POLICY;
      } else {
        process.env.FEISHU_OAUTH_SCOPE_POLICY = originalPolicy;
      }
    }
  });

  it('detects missing Feishu docs scopes and formats the diagnostic error', () => {
    const missing = findMissingFeishuDocsScopes(['offline_access', 'auth:user.id:read']);
    expect(missing).toEqual([
      'search:docs:read',
      'wiki:wiki',
      'wiki:wiki:readonly',
      'wiki:node:retrieve',
    ]);
    expect(buildFeishuMissingScopesError(missing)).toBe(
      'feishu_missing_required_scopes:search:docs:read,wiki:wiki,wiki:wiki:readonly,wiki:node:retrieve',
    );
  });
});
