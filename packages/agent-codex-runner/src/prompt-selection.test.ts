import { describe, expect, it } from 'vitest';
import { selectLatestInstruction } from './prompt-selection.js';

describe('selectLatestInstruction', () => {
  it('uses only the latest user message instead of concatenating history', () => {
    expect(selectLatestInstruction([
      { role: 'user', content: 'first request' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'latest request' },
    ])).toBe('latest request');
  });

  it('extracts text content from structured message parts', () => {
    expect(selectLatestInstruction([
      { role: 'user', content: [{ type: 'text', text: 'latest request' }] },
    ])).toBe('latest request');
  });

  it('falls back to the latest non-empty message when no user message exists', () => {
    expect(selectLatestInstruction([
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'latest visible content' },
    ])).toBe('latest visible content');
  });
});
