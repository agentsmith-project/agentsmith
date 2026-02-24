import { describe, expect, it } from 'vitest';
import {
  appendUniqueByKey,
  artifactRefKey,
  getImportedLibraryObjectRef,
  libraryObjectRefKey,
  urlRefKey,
} from './input-ref-resolver.js';

describe('input-ref-resolver', () => {
  it('builds stable keys for library object, url and artifact refs', () => {
    expect(libraryObjectRefKey({ library_id: 'lib_1', key: 'a/b.txt' })).toBe('lib_1:a/b.txt');
    expect(urlRefKey({ url: 'https://example.com/a' })).toBe('url:https://example.com/a');
    expect(artifactRefKey({ task_id: 'task_1', artifact_id: 'art_1' })).toBe('task_1:art_1');
  });

  it('extracts imported library object refs from url refs', () => {
    expect(getImportedLibraryObjectRef({
      imported_library_id: 'lib_1',
      imported_key: 'urls/a.txt',
    })).toEqual({ library_id: 'lib_1', key: 'urls/a.txt' });

    expect(getImportedLibraryObjectRef({
    })).toBeNull();
  });

  it('appends unique values by key', () => {
    const items: string[] = [];
    const seen = new Set<string>();
    expect(appendUniqueByKey({ items, seen, key: 'a', value: 'A' })).toBe(true);
    expect(appendUniqueByKey({ items, seen, key: 'a', value: 'A2' })).toBe(false);
    expect(appendUniqueByKey({ items, seen, key: 'b', value: 'B' })).toBe(true);
    expect(items).toEqual(['A', 'B']);
  });
});
