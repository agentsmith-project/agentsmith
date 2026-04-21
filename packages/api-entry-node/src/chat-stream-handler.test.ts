import { describe, expect, it } from 'vitest';
import { selectLatestCanonicalBranchLeaf } from './chat-stream-handler.js';
import type { ChatMessageRecord } from './resource-models.js';

function buildMessage(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: overrides.id ?? 'msg_default',
    workspace_id: overrides.workspace_id ?? 'ws_1',
    project_id: overrides.project_id ?? 'proj_1',
    session_id: overrides.session_id ?? 'session_1',
    role: overrides.role ?? 'user',
    content: overrides.content ?? 'message',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    tokens: overrides.tokens,
    finish_reason: overrides.finish_reason ?? null,
    message_status: overrides.message_status,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
    parent_id: overrides.parent_id ?? null,
    logical_id: overrides.logical_id,
    revision_of: overrides.revision_of ?? null,
    revision_index: overrides.revision_index,
    variant_group_id: overrides.variant_group_id,
    variant_index: overrides.variant_index,
    is_stale: overrides.is_stale ?? false,
    attachment_snapshots: overrides.attachment_snapshots,
  };
}

describe('selectLatestCanonicalBranchLeaf', () => {
  it('selects the newest non-stale branch leaf by created_at instead of relying on array order', () => {
    const root = buildMessage({
      id: 'msg_root',
      role: 'user',
      content: 'root',
      created_at: '2026-01-01T00:00:01.000Z',
    });
    const oldLeaf = buildMessage({
      id: 'msg_branch_old',
      role: 'assistant',
      content: 'old leaf',
      parent_id: root.id,
      created_at: '2026-01-01T00:00:03.000Z',
      variant_group_id: `asst_${root.id}`,
      variant_index: 0,
    });
    const newLeaf = buildMessage({
      id: 'msg_branch_new',
      role: 'assistant',
      content: 'new leaf',
      parent_id: root.id,
      created_at: '2026-01-01T00:00:05.000Z',
      variant_group_id: `asst_${root.id}`,
      variant_index: 1,
    });

    const selected = selectLatestCanonicalBranchLeaf([
      oldLeaf,
      newLeaf,
      root,
    ]);

    expect(selected?.id).toBe(newLeaf.id);
  });

  it('falls back to the newest non-stale non-system message when the graph has no leaf', () => {
    const older = buildMessage({
      id: 'msg_older',
      role: 'user',
      content: 'older',
      parent_id: 'msg_newer',
      created_at: '2026-01-01T00:00:02.000Z',
    });
    const newer = buildMessage({
      id: 'msg_newer',
      role: 'assistant',
      content: 'newer',
      parent_id: older.id,
      created_at: '2026-01-01T00:00:04.000Z',
    });

    const selected = selectLatestCanonicalBranchLeaf([
      older,
      newer,
    ]);

    expect(selected?.id).toBe(newer.id);
  });
});
