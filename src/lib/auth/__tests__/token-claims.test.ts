import { describe, expect, it } from 'vitest';
import { readAccessTokenClaims } from '../token-claims';

function encode(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('readAccessTokenClaims', () => {
  it('returns decoded claims when sub exists', () => {
    const token = encode({
      sub: 'user-1',
      email: 'dev-admin@example.com',
      name: 'Dev Admin',
      preferred_username: 'dev-admin',
    });

    expect(readAccessTokenClaims(token)).toEqual({
      sub: 'user-1',
      email: 'dev-admin@example.com',
      name: 'Dev Admin',
      preferred_username: 'dev-admin',
    });
  });

  it('returns null when sub is missing', () => {
    const token = encode({ email: 'missing-sub@example.com' });
    expect(readAccessTokenClaims(token)).toBeNull();
  });

  it('returns null for invalid jwt content', () => {
    expect(readAccessTokenClaims('not-a-token')).toBeNull();
  });
});
