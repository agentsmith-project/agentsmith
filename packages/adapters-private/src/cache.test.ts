import { describe, expect, it } from 'vitest';
import { InMemoryCache } from './cache.js';

describe('InMemoryCache compareAndSet', () => {
  it('updates only when the expected value still matches', async () => {
    const cache = new InMemoryCache();

    await cache.set('lease', 'old');

    await expect(cache.compareAndSet('lease', 'wrong', 'new')).resolves.toBe(false);
    await expect(cache.get('lease')).resolves.toBe('old');

    await expect(cache.compareAndSet('lease', 'old', 'new')).resolves.toBe(true);
    await expect(cache.get('lease')).resolves.toBe('new');
  });

  it('can atomically delete an expected value', async () => {
    const cache = new InMemoryCache();

    await cache.set('lease', 'old');

    await expect(cache.compareAndSet('lease', 'old', null)).resolves.toBe(true);
    await expect(cache.get('lease')).resolves.toBeNull();
  });
});
