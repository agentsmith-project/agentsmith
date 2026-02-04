import { handlers } from '@/mocks';

describe('msw handlers', () => {
  it('exports handlers array', () => {
    expect(Array.isArray(handlers)).toBe(true);
    expect(handlers.length).toBeGreaterThan(0);
  });
});
