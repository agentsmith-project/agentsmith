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
});
