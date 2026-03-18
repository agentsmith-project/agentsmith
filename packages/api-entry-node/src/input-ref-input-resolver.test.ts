import { describe, expect, it, vi } from 'vitest';
import {
  resolveInputRef,
  resolveArtifactInputMeta,
  resolveLibraryObjectInputMeta,
  resolveUrlInputMeta,
} from './input-ref-input-resolver.js';

describe('input-ref-input-resolver', () => {
  it('resolves library object metadata and falls back on lookup failure', async () => {
    const deps = {
      getFileLibraryObjectMetaUseCase: {
        execute: vi.fn()
          .mockResolvedValueOnce({ key: 'folder/a.txt', content_type: 'text/plain', size_bytes: 12 })
          .mockRejectedValueOnce(new Error('boom')),
      },
    };
    await expect(resolveLibraryObjectInputMeta({
      deps,
      workspaceId: 'ws',
      projectId: 'prj',
      input: { library_id: 'lib', key: 'folder/a.txt' },
    })).resolves.toEqual({
      found_meta: true,
      filename: 'a.txt',
      file_type: 'text/plain',
      file_size: 12,
    });

    await expect(resolveLibraryObjectInputMeta({
      deps,
      workspaceId: 'ws',
      projectId: 'prj',
      input: { library_id: 'lib', key: 'folder/b.txt', name: 'B.txt', content_type: 'text/csv', size_bytes: 3 },
    })).resolves.toEqual({
      found_meta: false,
      filename: 'B.txt',
      file_type: 'text/csv',
      file_size: 3,
    });
  });

  it('resolves url metadata via imported object and falls back to url defaults', async () => {
    const deps = {
      getFileLibraryObjectMetaUseCase: {
        execute: vi.fn().mockResolvedValue({ key: 'chat/s1/url-inputs/example.url.txt', content_type: 'text/plain', size_bytes: 44 }),
      },
    };
    await expect(resolveUrlInputMeta({
      deps,
      workspaceId: 'ws',
      projectId: 'prj',
      input: {
        url: 'https://example.com',
        imported_library_id: 'lib',
        imported_key: 'chat/s1/url-inputs/example.url.txt',
      },
    })).resolves.toEqual({
      filename: 'example.url.txt',
      file_type: 'text/plain',
      file_size: 44,
      imported_library_id: 'lib',
      imported_key: 'chat/s1/url-inputs/example.url.txt',
    });

    await expect(resolveUrlInputMeta({
      deps: { getFileLibraryObjectMetaUseCase: { execute: vi.fn().mockRejectedValue(new Error('nope')) } },
      workspaceId: 'ws',
      projectId: 'prj',
      input: { url: 'https://x.test' },
    })).resolves.toEqual({
      filename: 'url_input.url.txt',
      file_type: 'text/plain',
      file_size: 0,
    });
  });

  it('resolves artifact metadata with artifact lookup fallback and overrides', () => {
    expect(resolveArtifactInputMeta({
      input: { artifact_id: 'a1', task_relative_path: '.artifacts/out.png' },
      artifact: { id: 'a1', title: 'plot.png', mime_type: 'image/png', file_size: 100 },
    })).toEqual({
      filename: 'plot.png',
      file_type: 'image/png',
      file_size: 100,
      task_relative_path: '.artifacts/out.png',
    });

    expect(resolveArtifactInputMeta({
      input: { artifact_id: 'a2', name: 'custom.txt', content_type: 'text/plain', size_bytes: 9 },
    })).toEqual({
      filename: 'custom.txt',
      file_type: 'text/plain',
      file_size: 9,
    });
  });

  it('provides a unified resolveInputRef entry point', async () => {
    const deps = {
      getFileLibraryObjectMetaUseCase: {
        execute: vi.fn().mockResolvedValue({ key: 'k/doc.txt', content_type: 'text/plain', size_bytes: 12 }),
      },
    };
    const lib = await resolveInputRef({
      kind: 'library_object',
      deps,
      workspaceId: 'ws',
      projectId: 'prj',
      input: { library_id: 'lib_1', key: 'k/doc.txt' },
    });
    expect(lib.kind).toBe('library_object');
    expect(lib.meta.filename).toBe('doc.txt');

    const url = await resolveInputRef({
      kind: 'url',
      deps,
      workspaceId: 'ws',
      projectId: 'prj',
      input: { url: 'https://example.com', imported_library_id: 'lib_1', imported_key: 'k/doc.txt' },
    });
    expect(url.kind).toBe('url');
    expect(url.meta.imported_key).toBe('k/doc.txt');

    const art = await resolveInputRef({
      kind: 'artifact',
      input: { artifact_id: 'art_1' },
    });
    expect(art.kind).toBe('artifact');
    expect(art.meta.filename).toBe('art_1');
  });
});
