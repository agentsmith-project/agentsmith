import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildWorkspaceTenantPreview,
  getSystemInfoSnapshot,
  slugifyWorkspaceId,
} from '../config';

describe('system admin config helpers', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it('slugifies workspace names into stable ids', () => {
    expect(slugifyWorkspaceId('My Workspace / East')).toBe('my_workspace_east');
    expect(slugifyWorkspaceId('   ')).toBe('workspace');
  });

  it('builds tenant preview from configured prefixes', () => {
    process.env.SYSTEM_SUBSTRATE_LABEL = 'atlas-primary';
    process.env.SYSTEM_TENANT_DATABASE_PREFIX = 'tenant_';
    process.env.SYSTEM_TENANT_COLLECTION_PREFIX = 'col_';
    process.env.SYSTEM_TENANT_KEY_PREFIX = 'k:';

    expect(buildWorkspaceTenantPreview('Platform Ops')).toEqual({
      workspace_id: 'platform_ops',
      workspace_name: 'Platform Ops',
      substrate_label: 'atlas-primary',
      database_name: 'tenant_platform_ops',
      collection_prefix: 'col_platform_ops_',
      key_prefix: 'k:platform_ops:',
    });
  });

  it('returns current system info snapshot', () => {
    process.env.SYSTEM_ADMIN_USERNAME = 'root-admin';
    process.env.SYSTEM_SUBSTRATE_LABEL = 'mongo-main';
    process.env.SYSTEM_SUBSTRATE_URL = 'mongodb://db.internal:27017';
    process.env.SYSTEM_TENANT_DATABASE_PREFIX = 'agentsmith_';
    process.env.SYSTEM_TENANT_COLLECTION_PREFIX = 'ws_';
    process.env.SYSTEM_TENANT_KEY_PREFIX = 'ws:';
    process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:20000';

    expect(getSystemInfoSnapshot()).toEqual({
      system_admin_username: 'root-admin',
      api_base_url: 'http://localhost:20000',
      substrate_label: 'mongo-main',
      substrate_url: 'mongodb://db.internal:27017',
      database_prefix: 'agentsmith_',
      collection_prefix: 'ws_',
      key_prefix: 'ws:',
    });
  });
});
