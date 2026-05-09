import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from './json-doc-store.js';

interface VersionedDoc {
  id: string;
  status: 'ready' | 'deleting';
  version: number;
  task_id?: string;
  binding_generation?: number;
}

describe('InMemoryJsonDocStore conditional writes', () => {
  it('rejects duplicate conditional creates without replacing the original document', async () => {
    const store = new InMemoryJsonDocStore();

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1',
      status: 'ready',
      version: 1,
    })).resolves.toEqual({ ok: true });

    await expect(store.createIfAbsent<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1_replacement',
      status: 'deleting',
      version: 2,
    })).resolves.toMatchObject({
      ok: false,
      reason: 'exists',
      current: {
        id: 'doc_1',
        status: 'ready',
        version: 1,
      },
    });

    await expect(store.get<VersionedDoc>('docs', 'doc_1')).resolves.toMatchObject({
      id: 'doc_1',
      status: 'ready',
      version: 1,
    });
  });

  it('updates only when the expected CAS fields still match', async () => {
    const store = new InMemoryJsonDocStore();
    await store.upsert<VersionedDoc>('docs', 'doc_1', {
      id: 'doc_1',
      status: 'ready',
      version: 7,
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 7,
      },
      patch: {
        status: 'deleting',
        version: 8,
      },
    })).resolves.toMatchObject({
      ok: true,
      doc: {
        id: 'doc_1',
        status: 'deleting',
        version: 8,
      },
    });

    await expect(store.updateIfMatch<VersionedDoc>('docs', 'doc_1', {
      expected: {
        status: 'ready',
        version: 7,
      },
      patch: {
        status: 'deleting',
        version: 9,
      },
    })).resolves.toMatchObject({
      ok: false,
      reason: 'condition_failed',
      current: {
        id: 'doc_1',
        status: 'deleting',
        version: 8,
      },
    });
  });

  it('deletes only when the expected task and binding generation match', async () => {
    const store = new InMemoryJsonDocStore();
    await store.upsert<VersionedDoc>('bindings', 'binding_1', {
      id: 'binding_1',
      status: 'ready',
      version: 1,
      task_id: 'task_1',
      binding_generation: 3,
    });

    await expect(store.deleteIfMatch<VersionedDoc>('bindings', 'binding_1', {
      expected: {
        task_id: 'task_1',
        binding_generation: 2,
      },
    })).resolves.toMatchObject({
      ok: false,
      reason: 'condition_failed',
      current: {
        task_id: 'task_1',
        binding_generation: 3,
      },
    });

    await expect(store.deleteIfMatch<VersionedDoc>('bindings', 'binding_1', {
      expected: {
        task_id: 'task_1',
        binding_generation: 3,
      },
    })).resolves.toEqual({ ok: true, deleted: true });
    await expect(store.get<VersionedDoc>('bindings', 'binding_1')).resolves.toBeNull();
  });
});
