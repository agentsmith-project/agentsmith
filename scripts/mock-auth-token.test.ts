import { describe, expect, it } from 'vitest';
import {
  createMockAuthToken,
  parseMockAuthToken,
  readMockAuthActorFromRequest,
} from '../src/mocks/utils/mock-auth-token';

describe('mock auth token', () => {
  it('encodes the actor email so invite handoff can validate the current user', () => {
    const token = createMockAuthToken({
      userId: 'user_001',
      userEmail: 'User@example.com',
      issuedAt: 12345,
    });

    expect(token).toBe('mock_token_user_001__user%40example.com__12345');
    expect(parseMockAuthToken(token)).toEqual({
      userId: 'user_001',
      userEmail: 'user@example.com',
    });
  });

  it('keeps the legacy mock token format readable for older tests', () => {
    expect(parseMockAuthToken('mock_token_user_001_12345')).toEqual({
      userId: 'user_001',
      userEmail: null,
    });
  });

  it('reads the mock actor from the authorization header', () => {
    const request = new Request('http://localhost/api/v1/me', {
      headers: {
        authorization: 'Bearer mock_token_user_001__user%40example.com__12345',
      },
    });

    expect(readMockAuthActorFromRequest(request)).toEqual({
      userId: 'user_001',
      userEmail: 'user@example.com',
    });
  });
});
