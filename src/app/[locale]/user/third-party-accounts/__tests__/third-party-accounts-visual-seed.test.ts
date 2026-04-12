import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearVisualThirdPartyAccountsSeed, readVisualThirdPartyAccountsSeed } from '../third-party-accounts-visual-seed';

const VISUAL_SEED_STORAGE_KEY = '__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__';
const originalLocalStorage = window.localStorage;

function installMemoryStorage(seedValue?: string | null, throwOnRead = false) {
  const data = new Map<string, string>();
  if (typeof seedValue === 'string') {
    data.set(VISUAL_SEED_STORAGE_KEY, seedValue);
  }
  const storage = {
    getItem: vi.fn((key: string) => {
      if (throwOnRead) {
        throw new DOMException('localStorage is inaccessible', 'SecurityError');
      }
      return data.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
    clear: vi.fn(() => {
      data.clear();
    }),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

describe('third-party-accounts visual seed bootstrap', () => {
  beforeEach(() => {
    window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = undefined;
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('reads visual seed from localStorage and consumes the bootstrap key immediately', () => {
    const storage = installMemoryStorage(JSON.stringify([
      {
        id: 'uec_visual_custom_integration',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Visual Custom Integration',
      },
    ]));

    const seed = readVisualThirdPartyAccountsSeed();

    expect(seed).toEqual([
      expect.objectContaining({
        id: 'uec_visual_custom_integration',
        display_name: 'Visual Custom Integration',
      }),
    ]);
    expect(storage.getItem).toHaveBeenCalledWith(VISUAL_SEED_STORAGE_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(VISUAL_SEED_STORAGE_KEY);
  });

  it('clears the visual bootstrap key on demand after first paint', () => {
    const storage = installMemoryStorage(JSON.stringify([
      {
        id: 'uec_visual_custom_integration',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Visual Custom Integration',
      },
    ]));
    window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [
      {
        id: 'uec_visual_custom_integration',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Visual Custom Integration',
      },
    ] as never;

    clearVisualThirdPartyAccountsSeed();

    expect(storage.removeItem).toHaveBeenCalledWith(VISUAL_SEED_STORAGE_KEY);
    expect(window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__).toBeUndefined();
  });

  it('falls back to the window bootstrap when localStorage is malformed or inaccessible', () => {
    const storage = installMemoryStorage('not-json');
    window.__MBOS_VISUAL_THIRD_PARTY_ACCOUNTS__ = [
      {
        id: 'uec_visual_custom_integration',
        provider: 'custom',
        kind: 'secret_bundle',
        display_name: 'Visual Custom Integration',
      },
    ] as never;

    const seed = readVisualThirdPartyAccountsSeed();

    expect(seed).toEqual([
      expect.objectContaining({
        id: 'uec_visual_custom_integration',
      }),
    ]);
    expect(storage.removeItem).toHaveBeenCalledWith(VISUAL_SEED_STORAGE_KEY);
  });

  it('returns null when localStorage is inaccessible and no window bootstrap is present', () => {
    installMemoryStorage(null, true);

    const seed = readVisualThirdPartyAccountsSeed();

    expect(seed).toBeNull();
  });
});
