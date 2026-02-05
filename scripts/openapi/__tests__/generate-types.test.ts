import { describe, it, expect } from 'vitest';
import { generateTypes } from '../generate-types';

describe('generateTypes', () => {
  it('returns output path and content', async () => {
    const result = await generateTypes({ input: 'openapi.yaml' });
    expect(result.outputPath).toBe('src/lib/api/types.generated.ts');
    expect(result.content).toContain('export interface');
  });
});
