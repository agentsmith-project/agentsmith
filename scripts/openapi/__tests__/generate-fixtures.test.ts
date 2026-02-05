import { describe, it, expect } from 'vitest';
import { generateFixtures } from '../generate-mock-fixtures';

describe('generateFixtures', () => {
  it('returns output path and content', async () => {
    const result = await generateFixtures({ input: 'openapi.yaml' });
    expect(result.outputPath).toBe('src/mocks/fixtures.generated.ts');
    expect(result.content).toContain('required');
  });
});
