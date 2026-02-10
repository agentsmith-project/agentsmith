import { buildBranchBadgesForChain, buildVariantGroups, buildVisibleChain } from '@/lib/chat/branch';
import type { ChatMessage } from '@/lib/api/types';

describe('buildBranchBadgesForChain', () => {
  it('uses parent user branch for assistant messages (not assistant retry variants)', () => {
    const now = new Date().toISOString();
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        logical_id: undefined,
        revision_of: undefined,
        revision_index: undefined,
        variant_group_id: undefined,
        variant_index: undefined,
        role: 'user',
        session_id: 's1',
        content: 'hello',
        created_at: now,
        finish_reason: 'stop',
        parent_id: undefined,
        tokens: undefined,
        is_stale: false,
      },
      {
        id: 'u1r2',
        logical_id: undefined,
        revision_of: 'u1',
        revision_index: 1,
        variant_group_id: undefined,
        variant_index: undefined,
        role: 'user',
        session_id: 's1',
        content: 'hello (edited)',
        created_at: now,
        finish_reason: 'stop',
        parent_id: undefined,
        tokens: undefined,
        is_stale: false,
      },
      {
        id: 'a1v1',
        logical_id: undefined,
        revision_of: undefined,
        revision_index: undefined,
        variant_group_id: undefined,
        variant_index: 0,
        role: 'assistant',
        session_id: 's1',
        content: 'assistant v1',
        created_at: now,
        finish_reason: 'stop',
        parent_id: 'u1r2',
        tokens: undefined,
        is_stale: false,
      },
      {
        id: 'a1v2',
        logical_id: undefined,
        revision_of: undefined,
        revision_index: undefined,
        variant_group_id: undefined,
        variant_index: 1,
        role: 'assistant',
        session_id: 's1',
        content: 'assistant v2',
        created_at: now,
        finish_reason: 'stop',
        parent_id: 'u1r2',
        tokens: undefined,
        is_stale: false,
      },
    ];

    const groups = buildVariantGroups(messages);
    const activeVariantIndexByGroup: Record<string, number> = {
      // user branch: select edited user message u1r2
      log_u1: 1,
      // assistant variants: select a1v2
      asst_u1r2: 1,
    };
    const { chain } = buildVisibleChain(messages, groups, activeVariantIndexByGroup);
    const badges = buildBranchBadgesForChain(chain, groups, activeVariantIndexByGroup);

    const badge = badges.get('a1v2');
    expect(badge).toBeTruthy();
    expect(badge?.groupId).toBe('log_u1');
    expect(badge?.index).toBe(1);
    expect(badge?.total).toBe(2);
  });
});

