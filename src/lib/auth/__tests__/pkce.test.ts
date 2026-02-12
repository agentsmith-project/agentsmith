import { describe, expect, it, vi } from 'vitest';
import { createPkceChallenge, randomBase64Url } from '@/lib/auth/pkce';

describe('pkce helpers', () => {
  it('generates url-safe random verifier', () => {
    const value = randomBase64Url(32);
    expect(value.length).toBeGreaterThan(10);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('falls back to plain challenge when subtle is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (arr: Uint8Array) => arr,
      },
    });

    const verifier = 'plain-verifier';
    const result = await createPkceChallenge(verifier);
    expect(result).toEqual({ challenge: verifier, method: 'plain' });

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  it('uses S256 when subtle.digest is available', async () => {
    const digestMock = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer);
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: {
          digest: digestMock,
        },
      },
    });

    const result = await createPkceChallenge('abc');
    expect(result.method).toBe('S256');
    expect(result.challenge).toBe('AQIDBA');
    expect(digestMock).toHaveBeenCalledTimes(1);
    const firstCall = digestMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall?.[1];
    expect(ArrayBuffer.isView(payload)).toBe(true);
    expect(Array.from(payload as ArrayLike<number>)).toEqual([97, 98, 99]);

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });
});
