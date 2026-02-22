import { describe, expect, it } from 'vitest';
import { mapTraceHasMoreByMessageId, pruneTaskTraceMeta, upsertTaskTraceMeta } from '../task-trace-meta';

describe('task-trace-meta utils', () => {
  it('upserts message trace meta and returns same object when unchanged', () => {
    const first = upsertTaskTraceMeta({}, 'msg_1', { has_more: true, next_after_id: 'trace_1' });
    expect(first).toEqual({
      msg_1: { hasMore: true, nextAfterId: 'trace_1' },
    });

    const same = upsertTaskTraceMeta(first, 'msg_1', { has_more: true, next_after_id: 'trace_1' });
    expect(same).toBe(first);
  });

  it('prunes stale message keys', () => {
    const prev = {
      msg_1: { hasMore: true, nextAfterId: 'trace_1' },
      msg_2: { hasMore: false, nextAfterId: null },
    };
    const next = pruneTaskTraceMeta(prev, new Set(['msg_2']));
    expect(next).toEqual({
      msg_2: { hasMore: false, nextAfterId: null },
    });
  });

  it('maps hasMore flags by message id', () => {
    expect(
      mapTraceHasMoreByMessageId({
        msg_1: { hasMore: true, nextAfterId: 't1' },
        msg_2: { hasMore: false, nextAfterId: null },
      }),
    ).toEqual({
      msg_1: true,
      msg_2: false,
    });
  });
});
