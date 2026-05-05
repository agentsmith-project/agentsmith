import { describe, expect, it } from 'vitest';
import { readTerminalProtocolSessionId } from '../task-terminal-protocol';

describe('Agent task terminal protocol', () => {
  it('uses terminal_session_id as the only public event session selector', () => {
    expect(
      readTerminalProtocolSessionId({
        terminal_session_id: 'term_current',
        session_id: 'legacy_session',
      }),
    ).toBe('term_current');

    expect(
      readTerminalProtocolSessionId({
        session_id: 'legacy_session',
      }),
    ).toBeNull();
  });
});
