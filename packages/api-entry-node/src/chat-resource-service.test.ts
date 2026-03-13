import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatResourceService } from './chat-resource-service.js';

describe('ChatResourceService', () => {
  afterEach(() => {
    delete process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
  });

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

  it('uses tenant-prefixed collections for sessions, messages, and attachments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-chat-tenant-registry-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          workspace_admin: 'owner@example.com',
          tenant: {
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
            key_prefix: 'ws_default:',
          },
        },
      ]),
      'utf-8',
    );

    const docStore = new InMemoryJsonDocStore();
    const service = new ChatResourceService(docStore);
    const workspaceId = 'ws_default';
    const projectId = 'proj_1';

    const session = await service.createSession({
      workspaceId,
      projectId,
      model: 'deepseek-chat',
      endpointId: 'ep_1',
    });
    await service.createMessage({
      workspaceId,
      projectId,
      sessionId: session.id,
      role: 'user',
      content: 'tenant message',
    });
    await service.initAttachment({
      workspaceId,
      projectId,
      sessionId: session.id,
      fileName: 'tenant.txt',
      fileType: 'text/plain',
      fileSize: 12,
    });

    expect(await docStore.list('chat_sessions', {})).toHaveLength(0);
    expect(await docStore.list('chat_messages', {})).toHaveLength(0);
    expect(await docStore.list('chat_attachments', {})).toHaveLength(0);
    expect(await docStore.list('ws_default_chat_sessions', {})).toHaveLength(1);
    expect(await docStore.list('ws_default_chat_messages', {})).toHaveLength(1);
    expect(await docStore.list('ws_default_chat_attachments', {})).toHaveLength(1);
    expect(await service.listSessions(workspaceId, projectId)).toHaveLength(1);
    expect(await service.listMessages(workspaceId, projectId, session.id)).toHaveLength(1);
    expect(await service.listAttachments(workspaceId, projectId, session.id)).toHaveLength(1);

    rmSync(dir, { recursive: true, force: true });
  });
});
