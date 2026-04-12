import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { extractStoredAuthToken, readStoredAuthToken } from '../e2e/integration-workspace-access';

describe('integration-workspace-access', () => {
  it('extracts a valid token from stored auth JSON', () => {
    expect(extractStoredAuthToken(JSON.stringify({
      state: { token: 'mock_token_user_001_12345' },
    }))).toBe('mock_token_user_001_12345');
  });

  it('returns null for missing token payloads', () => {
    expect(extractStoredAuthToken(JSON.stringify({
      state: {},
    }))).toBeNull();
    expect(extractStoredAuthToken(null)).toBeNull();
  });

  it('returns null for malformed JSON payloads', () => {
    expect(extractStoredAuthToken('{not-json')).toBeNull();
    expect(extractStoredAuthToken('')).toBeNull();
  });

  it('reads a valid token from localStorage JSON when storage is available', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce(JSON.stringify({
        state: { token: 'mock_token_user_001_12345' },
      })),
    } as unknown as Page;

    await expect(readStoredAuthToken(page)).resolves.toBe('mock_token_user_001_12345');
  });

  it('returns null when localStorage is inaccessible from an opaque origin', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValueOnce(
        new DOMException('Failed to read the localStorage property from Window', 'SecurityError'),
      ),
    } as unknown as Page;

    await expect(readStoredAuthToken(page)).resolves.toBeNull();
  });
});
