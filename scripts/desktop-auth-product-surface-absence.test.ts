import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { groupVisualBaselineCatalogByScenario } from '../e2e/visual-baseline-support';

describe('desktop auth product surface absence', () => {
  it('keeps desktop auth routes, stories, and visual scenarios out of the product surface', () => {
    const removedPaths = [
      'src/app/[locale]/desktop/auth',
      'src/app/api/public/desktop/auth',
      'src/lib/auth/desktop-auth-request.ts',
      'e2e/integration-desktop-auth-request-complete-and-work.spec.ts',
      'e2e/stories/backend-real/desktop-auth-request-complete-and-work.story.md',
      'scripts/desktop-auth-request-complete-and-work.story.test.ts',
    ];

    for (const removedPath of removedPaths) {
      expect(existsSync(path.resolve(process.cwd(), removedPath)), removedPath).toBe(false);
    }

    const visualScenarios = groupVisualBaselineCatalogByScenario();
    expect(visualScenarios.has('desktop-auth-request')).toBe(false);
    expect(visualScenarios.has('desktop-auth-complete')).toBe(false);

    const generatedStorySpecs = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'e2e/generated/story-specs.generated.json'), 'utf-8'),
    ) as Array<{ storyId: string }>;
    expect(generatedStorySpecs.map((story) => story.storyId)).not.toContain('desktop-auth-request-complete-and-work');

    const visualSpec = readFileSync(path.resolve(process.cwd(), 'e2e/visual.spec.ts'), 'utf-8');
    expect(visualSpec).not.toContain('desktop-auth-request');
    expect(visualSpec).not.toContain('desktop-auth-complete');
  });
});
