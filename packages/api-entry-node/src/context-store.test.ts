import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  deleteContextEntry,
  getContextEntry,
  listContextEntries,
  normalizeContextKey,
  putContextEntry,
} from './context-store.js';

describe('context-store', () => {
  it('stores, retrieves, lists, and deletes encrypted context entries', async () => {
    const docStore = new InMemoryJsonDocStore();

    const saved = await putContextEntry(docStore, {
      scope: 'user',
      key: 'credentials.github_token',
      user_id: 'user_1',
      content: 'ghp_secret_123',
      content_type: 'text',
      updated_by: 'user_1',
    });

    expect(saved.content).toBe('ghp_secret_123');

    const raw = await docStore.get<{ content: string }>('context_store_entries', saved.id);
    expect(raw?.content).toBeTruthy();
    expect(raw?.content).not.toContain('ghp_secret_123');

    const loaded = await getContextEntry(docStore, {
      scope: 'user',
      key: 'credentials.github_token',
      user_id: 'user_1',
    });
    expect(loaded?.content).toBe('ghp_secret_123');

    const listed = await listContextEntries(docStore, {
      scope: 'user',
      user_id: 'user_1',
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe('credentials.github_token');

    const deleted = await deleteContextEntry(docStore, {
      scope: 'user',
      key: 'credentials.github_token',
      user_id: 'user_1',
    });
    expect(deleted).toBe(true);
    expect(
      await getContextEntry(docStore, {
        scope: 'user',
        key: 'credentials.github_token',
        user_id: 'user_1',
      }),
    ).toBeNull();
  });

  it('normalizes and trims context keys', () => {
    expect(normalizeContextKey('  prefs.editor  ')).toBe('prefs.editor');
    expect(normalizeContextKey('   ')).toBeNull();
    expect(normalizeContextKey(null)).toBeNull();
  });
});
