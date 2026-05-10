import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '../src/lib/mock-time';
import { mockFileNowIso } from '../src/mocks/handlers/files';

describe('file mock handlers', () => {
  it('uses the visual reference clock for mock file timestamps instead of wall-clock time', () => {
    expect(mockFileNowIso()).toBe(VISUAL_TEST_REFERENCE_NOW_ISO);
  });

  it('keeps file object fixtures deterministic for visual screenshots', () => {
    const source = readFileSync('src/mocks/handlers/files.ts', 'utf8');

    expect(source).toContain('VISUAL_TEST_REFERENCE_NOW_ISO');
    expect(source).not.toContain('const nowIso = () => new Date().toISOString()');
  });

  it('does not seed browser-visible raw file-library storage or mount data', () => {
    const source = readFileSync('src/mocks/handlers/files.ts', 'utf8');

    expect(source).not.toContain('filesystem_name');
    expect(source).not.toContain('provider:');
    expect(source).not.toContain('bucket:');
    expect(source).not.toContain('metadata_url');
    expect(source).not.toContain('storage_bucket_url');
    expect(source).not.toContain('recommended_mount_commands');
    expect(source).not.toContain('juicefs mount');
    expect(source).not.toContain('jfs_lib_');
    expect(source).not.toContain('/backend');
    expect(source).not.toContain('/storage-credential-exchange');
    expect(source).not.toContain('/desktop-mount-access');
    expect(source).not.toContain('FILE_LIBRARY_CONNECTOR_UNSUPPORTED');
    expect(source).not.toContain('file_library_connector_unsupported');
  });
});
