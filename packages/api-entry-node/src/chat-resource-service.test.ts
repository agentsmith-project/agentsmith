import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { ChatResourceService } from './chat-resource-service.js';

describe('ChatResourceService', () => {
  it('creates user revisions instead of in-place update', async () => {
    const service = new ChatResourceService(new InMemoryJsonDocStore());
    const workspaceId = 'ws_default';
    const projectId = 'proj_1';
    const session = await service.createSession({
      workspaceId,
      projectId,
      model: 'deepseek-chat',
      endpointId: 'ep_1',
    });

    const original = await service.createMessage({
      workspaceId,
      projectId,
      sessionId: session.id,
      role: 'user',
      content: 'original question',
    });
    const rev1 = await service.updateMessage(
      workspaceId,
      projectId,
      session.id,
      original.id,
      'edited question v1',
    );
    expect(rev1).not.toBeNull();
    expect(rev1?.id).not.toBe(original.id);
    expect(rev1?.revision_of).toBe(original.id);
    expect(rev1?.revision_index).toBe(1);
    expect(rev1?.logical_id).toBe(original.logical_id);

    const rev2 = await service.updateMessage(
      workspaceId,
      projectId,
      session.id,
      rev1!.id,
      'edited question v2',
    );
    expect(rev2).not.toBeNull();
    expect(rev2?.revision_of).toBe(original.id);
    expect(rev2?.revision_index).toBe(2);
    expect(rev2?.logical_id).toBe(original.logical_id);

    const allMessages = await service.listMessages(workspaceId, projectId, session.id);
    expect(allMessages).toHaveLength(3);
    expect(allMessages.map((message) => message.content)).toEqual([
      'original question',
      'edited question v1',
      'edited question v2',
    ]);
  });

  it('computes assistant variant indexes in same variant group', async () => {
    const service = new ChatResourceService(new InMemoryJsonDocStore());
    const workspaceId = 'ws_default';
    const projectId = 'proj_1';
    const session = await service.createSession({
      workspaceId,
      projectId,
      model: 'deepseek-chat',
      endpointId: 'ep_1',
    });

    const user = await service.createMessage({
      workspaceId,
      projectId,
      sessionId: session.id,
      role: 'user',
      content: 'question',
    });
    const firstAssistant = await service.createMessage({
      workspaceId,
      projectId,
      sessionId: session.id,
      role: 'assistant',
      content: 'answer v0',
      parentId: user.id,
      variantGroupId: `asst_${user.id}`,
      variantIndex: 0,
    });

    const next = await service.buildNextAssistantVariant(
      workspaceId,
      projectId,
      session.id,
      user.id,
      firstAssistant,
    );
    expect(next).toEqual({
      variantGroupId: `asst_${user.id}`,
      variantIndex: 1,
    });

    const bootstrap = await service.buildNextAssistantVariant(
      workspaceId,
      projectId,
      session.id,
      user.id,
      null,
    );
    expect(bootstrap.variantGroupId).toBe(`asst_${user.id}`);
    expect(bootstrap.variantIndex).toBe(1);
  });
});
