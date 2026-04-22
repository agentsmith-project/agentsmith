import { describe, expect, it } from 'vitest';

import {
  createInternalChatIsolationProbe,
  matchesInternalChatIsolationReply,
  sessionHasInternalChatIsolationReply,
} from './internal-chat-isolation-probe';

describe('internal chat isolation probe', () => {
  it('builds harmless arithmetic probes with distinct expected answers', () => {
    const sessionOneProbe = createInternalChatIsolationProbe('session-one');
    const sessionTwoProbe = createInternalChatIsolationProbe('session-two');

    expect(sessionOneProbe.prompt.trim()).not.toBe('');
    expect(sessionTwoProbe.prompt.trim()).not.toBe('');
    expect(sessionOneProbe.expectedAnswer).not.toBe(sessionTwoProbe.expectedAnswer);
    expect(sessionOneProbe.prompt).toMatch(/17\s*\+\s*26/);
    expect(sessionTwoProbe.prompt).toMatch(/31\s*\+\s*18/);
    expect(sessionOneProbe.prompt).not.toMatch(/token|secret/i);
    expect(sessionTwoProbe.prompt).not.toMatch(/token|secret/i);
  });

  it('matches only the intended probe answer and ignores other session replies', () => {
    const sessionOneProbe = createInternalChatIsolationProbe('session-one');
    const sessionTwoProbe = createInternalChatIsolationProbe('session-two');

    expect(matchesInternalChatIsolationReply('43', sessionOneProbe)).toBe(true);
    expect(matchesInternalChatIsolationReply('43.', sessionOneProbe)).toBe(true);
    expect(matchesInternalChatIsolationReply('The answer is 43.', sessionOneProbe)).toBe(true);
    expect(matchesInternalChatIsolationReply('49', sessionOneProbe)).toBe(false);
    expect(matchesInternalChatIsolationReply('43 and 49', sessionOneProbe)).toBe(false);
    expect(matchesInternalChatIsolationReply("I'm sorry, but I can't help with that.", sessionOneProbe)).toBe(false);
    expect(matchesInternalChatIsolationReply('49', sessionTwoProbe)).toBe(true);
    expect(matchesInternalChatIsolationReply('43', sessionTwoProbe)).toBe(false);
  });

  it('finds matching assistant replies in one session without cross-session confusion', () => {
    const sessionOneProbe = createInternalChatIsolationProbe('session-one');
    const sessionTwoProbe = createInternalChatIsolationProbe('session-two');

    const sessionOneMessages = [
      { role: 'user', content: sessionOneProbe.prompt },
      { role: 'assistant', content: 'The answer is 43.' },
    ];
    const sessionTwoMessages = [
      { role: 'user', content: sessionTwoProbe.prompt },
      { role: 'assistant', content: '49' },
    ];

    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionOneProbe)).toBe(true);
    expect(sessionHasInternalChatIsolationReply(sessionOneMessages, sessionTwoProbe)).toBe(false);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionOneProbe)).toBe(false);
    expect(sessionHasInternalChatIsolationReply(sessionTwoMessages, sessionTwoProbe)).toBe(true);
  });
});
