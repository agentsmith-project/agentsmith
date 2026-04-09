import { describe, expect, it } from 'vitest';
import { selectLatestUserText } from './message-selection.js';

describe('selectLatestUserText', () => {
  it('returns the latest user text content', () => {
    expect(
      selectLatestUserText([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
        { role: 'user', content: 'second turn' },
      ]),
    ).toBe('second turn');
  });

  it('extracts text parts from multimodal-style arrays', () => {
    expect(
      selectLatestUserText([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'question' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } },
          ],
        },
      ]),
    ).toBe('question');
  });
});
