import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findForbiddenBreakingAllowlistEntries,
  type BreakingAllowlist,
} from './check-openapi-breaking';

function readActiveAllowlist(): BreakingAllowlist {
  return JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'docs',
        'contracts',
        'specs',
        'openapi-breaking-allowlist.json',
      ),
      'utf8',
    ),
  ) as BreakingAllowlist;
}

function hashEntry(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('check-openapi-breaking allowlist guard', () => {
  it('flags retired provider-bound OpenAPI breaking allowlist entries', () => {
    const managedCredentialRefresh =
      'post /api/v1/context/managed-credentials/{provider}/refresh';
    const allowlist: BreakingAllowlist = {
      operations: [
        managedCredentialRefresh,
        'get /api/v1/workspaces/{workspaceId}/integrations/feishu',
        'post /api/v1/workspaces/{workspaceId}/feishu/oauth/complete',
      ],
      responses: [
        'post /api/v1/workspaces/{workspaceId}/me/feishu/auth/start -> 409',
      ],
      operation_hashes: [hashEntry(managedCredentialRefresh)],
    };

    expect(
      findForbiddenBreakingAllowlistEntries(allowlist).map((finding) => ({
        section: finding.section,
        value: finding.value,
      })),
    ).toEqual([
      {
        section: 'operations',
        value: managedCredentialRefresh,
      },
      {
        section: 'operations',
        value: 'get /api/v1/workspaces/{workspaceId}/integrations/feishu',
      },
      {
        section: 'operations',
        value: 'post /api/v1/workspaces/{workspaceId}/feishu/oauth/complete',
      },
      {
        section: 'responses',
        value:
          'post /api/v1/workspaces/{workspaceId}/me/feishu/auth/start -> 409',
      },
      {
        section: 'operation_hashes',
        value: hashEntry(managedCredentialRefresh),
      },
    ]);
  });

  it('keeps provider-bound Feishu and managed credential refresh paths out of the active allowlist', () => {
    expect(findForbiddenBreakingAllowlistEntries(readActiveAllowlist())).toEqual(
      [],
    );
  });
});
