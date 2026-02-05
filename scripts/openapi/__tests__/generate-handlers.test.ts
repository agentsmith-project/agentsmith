import { describe, it, expect } from 'vitest';
import { generateHandlers } from '../generate-msw-handlers';

describe('generateHandlers', () => {
  it('generates handlers for all paths', async () => {
    const result = await generateHandlers({ input: 'openapi.yaml' });
    expect(result.outputPath).toBe('src/mocks/handlers.generated.ts');
    expect(result.content).toContain('http.get');
  });
});
