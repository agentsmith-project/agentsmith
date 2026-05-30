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
  it('stores, retrieves, lists, and deletes encrypted member context entries', async () => {
    const docStore = new InMemoryJsonDocStore();

    const saved = await putContextEntry(docStore, {
      scope: 'member',
      key: 'credentials.sample_token',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      content: 'sample_secret_123',
      content_type: 'text',
      updated_by: 'user_1',
    });

    expect(saved.content).toBe('sample_secret_123');

    const raw = await docStore.get<{ content: string }>('context_store_entries', saved.id);
    expect(raw?.content).toBeTruthy();
    expect(raw?.content).not.toContain('sample_secret_123');

    const loaded = await getContextEntry(docStore, {
      scope: 'member',
      key: 'credentials.sample_token',
      user_id: 'user_1',
      workspace_id: 'ws_default',
    });
    expect(loaded?.content).toBe('sample_secret_123');

    const listed = await listContextEntries(docStore, {
      scope: 'member',
      user_id: 'user_1',
      workspace_id: 'ws_default',
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe('credentials.sample_token');

    const deleted = await deleteContextEntry(docStore, {
      scope: 'member',
      key: 'credentials.sample_token',
      user_id: 'user_1',
      workspace_id: 'ws_default',
    });
    expect(deleted).toBe(true);
    expect(
      await getContextEntry(docStore, {
        scope: 'member',
        key: 'credentials.sample_token',
        user_id: 'user_1',
        workspace_id: 'ws_default',
      }),
    ).toBeNull();
  });

  it('stores, retrieves, lists, and deletes encrypted project_member context entries', async () => {
    const docStore = new InMemoryJsonDocStore();

    const saved = await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'bindings.sample.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      content: 'uec_project_1',
      content_type: 'text',
      updated_by: 'user_1',
    });

    expect(saved.content).toBe('uec_project_1');

    const loaded = await getContextEntry(docStore, {
      scope: 'project_member',
      key: 'bindings.sample.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    expect(loaded?.content).toBe('uec_project_1');
    expect(loaded?.task_id).toBeNull();

    const listed = await listContextEntries(docStore, {
      scope: 'project_member',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.key).toBe('bindings.sample.connection_id');

    const deleted = await deleteContextEntry(docStore, {
      scope: 'project_member',
      key: 'bindings.sample.connection_id',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
    });
    expect(deleted).toBe(true);
    expect(
      await getContextEntry(docStore, {
        scope: 'project_member',
        key: 'bindings.sample.connection_id',
        user_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      }),
    ).toBeNull();
  });

  it('keeps task context keyed by workspace, project, task, and owner user', async () => {
    const docStore = new InMemoryJsonDocStore();

    await putContextEntry(docStore, {
      scope: 'task',
      key: 'notes.current',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
      content: 'remember this',
      content_type: 'text',
      updated_by: 'user_1',
    });

    const matching = await getContextEntry(docStore, {
      scope: 'task',
      key: 'notes.current',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
    });
    const mismatchedUser = await getContextEntry(docStore, {
      scope: 'task',
      key: 'notes.current',
      user_id: 'user_2',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
    });

    expect(matching?.content).toBe('remember this');
    expect(mismatchedUser).toBeNull();
  });

  it('normalizes and trims context keys', () => {
    expect(normalizeContextKey('  prefs.editor  ')).toBe('prefs.editor');
    expect(normalizeContextKey('   ')).toBeNull();
    expect(normalizeContextKey(null)).toBeNull();
  });
});
