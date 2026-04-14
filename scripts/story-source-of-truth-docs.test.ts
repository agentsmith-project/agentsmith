import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('story source-of-truth docs', () => {
  it('documents both canonical lane directories and generated cache derivation', async () => {
    const source = await readFile(path.resolve('docs/testing/story-source-of-truth-and-generated-specs.md'), 'utf-8');

    expect(source).toContain('`e2e/stories/backend-real/*.story.md`');
    expect(source).toContain('`e2e/stories/mock-lane/*.story.md`');
    expect(source).toContain('canonical lane directories');
    expect(source).toContain('Story family metadata');
    expect(source).toContain('family');
    expect(source).toContain('personas');
    expect(source).toContain('kind');
    expect(source).toContain('gatePolicy');
    expect(source).toContain('externalDependencies');
    expect(source).toContain('runtimeData.visualReview.scenes');
    expect(source).toContain('major product surface coverage guard');
    expect(source).toContain('scripts/story-product-surface-coverage.test.ts');
    expect(source).toContain('byte-for-byte projection');
  });
});
