/**
 * MSW Handlers
 *
 * Comprehensive mock API handlers for development.
 * All handlers use fixtures from ./fixtures and support CRUD operations.
 */

import { http, HttpResponse } from 'msw';
import {
  workspaceFixtures,
  projectFixtures,
  projectMembershipFixtures,
  agentFixtures,
  agentServiceKeyFixtures,
  endpointFixtures,
  endpointACLFixtures,
  memberFixtures,
  joinRequestFixtures,
  auditEventFixtures,
  usageRecordFixtures,
  userAPIKeyFixtures,
  chatSessionFixtures,
  chatMessageFixtures,
  attachmentFixtures,
  sourceFileFixtures,
  agentThreadFixtures,
  turnFixtures,
  usageKPI,
} from './fixtures';

// ============================================================
// Utility Functions
// ============================================================

function getId(params: Record<string, string | readonly string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return (value as string | undefined) ?? '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function getPagination(url: URL) {
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '10');
  return { page, pageSize };
}

function paginated<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return {
    items: items.slice(start, end),
    total: items.length,
    page,
    page_size: pageSize,
    has_more: end < items.length,
  };
}

// ============================================================
// MSW Handlers
// ============================================================

export const handlers = [
  // ============================================================
  // Health Check
  // ============================================================

  http.get('/api/health', () => {
    return HttpResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }),

  // ============================================================
  // Workspaces
  // ============================================================

  http.get('/api/workspaces', () => {
    return HttpResponse.json({
      items: workspaceFixtures,
      total: workspaceFixtures.length,
    });
  }),

  // ============================================================
  // Projects
  // ============================================================

  http.get('/api/workspaces/:ws/projects', ({ request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    return HttpResponse.json(paginated(projectFixtures, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj', ({ params }) => {
    const projectId = getId(params, 'prj');
    const project = projectFixtures.find((p) => p.id === projectId);
    if (!project) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Project not found' }, { status: 404 });
    }
    return HttpResponse.json(project);
  }),

  http.post('/api/workspaces/:ws/projects', async ({ request }) => {
    const body: any = await request.json();

    if (!body || !body.name) {
      return HttpResponse.json({ error_code: 'INVALID_REQUEST', message: 'Request body is required' }, { status: 400 });
    }
    const newProject = {
      id: `proj_${Date.now()}`,
      workspace_id: body.workspace_id || '',
      name: body.name,
      description: body.description,
      visibility: body.visibility || 'private',
      join_policy: body.join_policy || 'approval_required',
      owner_id: 'user_001',
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    projectFixtures.push(newProject);
    return HttpResponse.json(newProject, { status: 201 });
  }),

  http.put('/api/workspaces/:ws/projects/:prj', async ({ params, request }) => {
    const projectId = getId(params, 'prj');
    const body: any = await request.json();
    const index = projectFixtures.findIndex((p) => p.id === projectId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Project not found' }, { status: 404 });
    }
    projectFixtures[index] = { ...projectFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(projectFixtures[index]);
  }),

  // ============================================================
  // Agents
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/agents', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const filtered = agentFixtures.filter((a) => a.project_id === projectId);
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/agents/:agent', ({ params }) => {
    const agentId = getId(params, 'agent');
    const agent = agentFixtures.find((a) => a.id === agentId);
    if (!agent) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    return HttpResponse.json(agent);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/agents', async ({ params, request }) => {
    const body: any = await request.json();
    const newAgent = {
      id: `agent_${Date.now()}`,
      project_id: getId(params, 'prj'),
      name: body.name,
      description: body.description,
      mode: body.mode || 'external',
      presence: 'offline' as const,
      status: 'enabled' as const,
      config: body.config,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentFixtures.push(newAgent);
    return HttpResponse.json(newAgent, { status: 201 });
  }),

  http.put('/api/workspaces/:ws/projects/:prj/agents/:agent', async ({ params, request }) => {
    const agentId = getId(params, 'agent');
    const body: any = await request.json();
    const index = agentFixtures.findIndex((a) => a.id === agentId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    agentFixtures[index] = { ...agentFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(agentFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/agents/:agent', ({ params }) => {
    const agentId = getId(params, 'agent');
    const index = agentFixtures.findIndex((a) => a.id === agentId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Agent not found' }, { status: 404 });
    }
    agentFixtures.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // Agent Service Keys
  http.get('/api/workspaces/:ws/projects/:prj/agents/:agent/keys', ({ params }) => {
    const agentId = getId(params, 'agent');
    const keys = agentServiceKeyFixtures.filter((k) => k.agent_id === agentId && k.status === 'active');
    return HttpResponse.json({ items: keys, total: keys.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/agents/:agent/keys', async ({ params }) => {
    const agentId = getId(params, 'agent');
    // This endpoint doesn't use request body
    const newKey = {
      id: `ask_${Date.now()}`,
      agent_id: agentId,
      key_prefix: `ask-***${Math.random().toString(36).substring(2, 9)}`,
      status: 'active' as const,
      created_at: new Date().toISOString(),
    };
    agentServiceKeyFixtures.push(newKey);
    return HttpResponse.json(newKey, { status: 201 });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/agents/:agent/keys/:key', ({ params }) => {
    const keyId = getId(params, 'key');
    const index = agentServiceKeyFixtures.findIndex((k) => k.id === keyId);
    if (index !== -1) {
      agentServiceKeyFixtures[index].status = 'revoked';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Endpoints
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/endpoints', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const filtered = endpointFixtures.filter((e) => e.project_id === projectId);
    return HttpResponse.json(paginated(filtered, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const endpoint = endpointFixtures.find((e) => e.id === endpointId);
    if (!endpoint) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    return HttpResponse.json(endpoint);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/endpoints', async ({ params, request }) => {
    const body: any = await request.json();
    const newEndpoint = {
      id: `endpoint_${Date.now()}`,
      project_id: getId(params, 'prj'),
      name: body.name,
      description: body.description,
      openai_model: body.openai_model,
      type: body.type || 'openai',
      base_url: body.base_url,
      status: 'active' as const,
      limits: body.limits,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    endpointFixtures.push(newEndpoint);
    return HttpResponse.json(newEndpoint, { status: 201 });
  }),

  http.put('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', async ({ params, request }) => {
    const endpointId = getId(params, 'endpoint');
    const body: any = await request.json();
    const index = endpointFixtures.findIndex((e) => e.id === endpointId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    endpointFixtures[index] = { ...endpointFixtures[index], ...body, updated_at: new Date().toISOString() };
    return HttpResponse.json(endpointFixtures[index]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const index = endpointFixtures.findIndex((e) => e.id === endpointId);
    if (index === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Endpoint not found' }, { status: 404 });
    }
    endpointFixtures.splice(index, 1);
    return HttpResponse.json({ success: true });
  }),

  // Endpoint ACL
  http.get('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (!acl) {
      return HttpResponse.json({ endpoint_id: endpointId, deny_list: [] });
    }
    return HttpResponse.json(acl);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl/deny', async ({ params, request }) => {
    const endpointId = getId(params, 'endpoint');
    const body: any = await request.json();
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (!acl) {
      const newAcl = { endpoint_id: endpointId, deny_list: [] };
      endpointACLFixtures.push(newAcl);
    }
    const aclEntry = {
      user_id: body.user_id,
      reason: body.reason,
      added_at: new Date().toISOString(),
      added_by: 'user_001',
    };
    const currentAcl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    currentAcl!.deny_list.push(aclEntry);
    return HttpResponse.json(aclEntry, { status: 201 });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/endpoints/:endpoint/acl/deny/:userId', ({ params }) => {
    const endpointId = getId(params, 'endpoint');
    const userId = getId(params, 'userId');
    const acl = endpointACLFixtures.find((a) => a.endpoint_id === endpointId);
    if (acl) {
      acl.deny_list = acl.deny_list.filter((d) => d.user_id !== userId);
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Members
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/members', ({ params }) => {
    const projectId = getId(params, 'prj');
    const memberships = projectMembershipFixtures.filter((m) => m.project_id === projectId);
    const members = memberships.map((m) => {
      const member = memberFixtures.find((mf) => mf.id === m.user_id);
      return {
        ...member,
        role: m.role,
        permissions: m.permissions,
        status: m.status,
        joined_at: m.joined_at,
      };
    });
    return HttpResponse.json({ items: members, total: members.length });
  }),

  http.put('/api/workspaces/:ws/projects/:prj/members/:member/role', async ({ params, request }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const body: any = await request.json();
    const index = projectMembershipFixtures.findIndex(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (index !== -1) {
      projectMembershipFixtures[index].role = body.role;
      projectMembershipFixtures[index].permissions = body.permissions;
    }
    return HttpResponse.json({ success: true });
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/members/:member', ({ params }) => {
    const memberId = getId(params, 'member');
    const projectId = getId(params, 'prj');
    const index = projectMembershipFixtures.findIndex(
      (m) => m.project_id === projectId && m.user_id === memberId
    );
    if (index !== -1) {
      projectMembershipFixtures[index].status = 'removed';
    }
    return HttpResponse.json({ success: true });
  }),

  // Join Requests
  http.get('/api/workspaces/:ws/projects/:prj/join-requests', () => {
    const pending = joinRequestFixtures.filter((j) => j.status === 'pending');
    return HttpResponse.json({ items: pending, total: pending.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/join-requests/:join/approve', ({ params }) => {
    const joinId = getId(params, 'join');
    const index = joinRequestFixtures.findIndex((j) => j.id === joinId);
    if (index !== -1) {
      joinRequestFixtures[index].status = 'approved';
      joinRequestFixtures[index].reviewed_at = new Date().toISOString();
      joinRequestFixtures[index].reviewed_by = 'user_001';
    }
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/join-requests/:join/reject', ({ params }) => {
    const joinId = getId(params, 'join');
    const index = joinRequestFixtures.findIndex((j) => j.id === joinId);
    if (index !== -1) {
      joinRequestFixtures[index].status = 'rejected';
      joinRequestFixtures[index].reviewed_at = new Date().toISOString();
      joinRequestFixtures[index].reviewed_by = 'user_001';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Audit & Usage
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/audit', ({ request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    return HttpResponse.json(paginated(auditEventFixtures, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/usage/kpi', () => {
    return HttpResponse.json(usageKPI);
  }),

  http.get('/api/workspaces/:ws/projects/:prj/usage/records', ({ request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    return HttpResponse.json(paginated(usageRecordFixtures, page, pageSize));
  }),

  // ============================================================
  // User API Keys
  // ============================================================

  http.get('/api/user/keys', () => {
    return HttpResponse.json({ items: userAPIKeyFixtures, total: userAPIKeyFixtures.length });
  }),

  http.post('/api/user/keys', async ({ request }) => {
    const body: any = await request.json();
    const newKey = {
      id: `key_${Date.now()}`,
      user_id: 'user_001',
      key_prefix: `usk-***${Math.random().toString(36).substring(2, 11)}`,
      status: 'active' as const,
      note: body.note,
      created_at: new Date().toISOString(),
      expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 24 * 60 * 60 * 1000).toISOString() : undefined,
    };
    userAPIKeyFixtures.unshift(newKey);
    return HttpResponse.json(newKey, { status: 201 });
  }),

  http.delete('/api/user/keys/:key', ({ params }) => {
    const keyId = getId(params, 'key');
    const index = userAPIKeyFixtures.findIndex((k) => k.id === keyId);
    if (index !== -1) {
      userAPIKeyFixtures[index].status = 'revoked';
    }
    return HttpResponse.json({ success: true });
  }),

  // ============================================================
  // Chat
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const projectId = getId(params, 'prj');
    const sessions = chatSessionFixtures.filter((s) => s.project_id === projectId);
    return HttpResponse.json(paginated(sessions, page, pageSize));
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', ({ params }) => {
    const sessionId = getId(params, 'session');
    const session = chatSessionFixtures.find((s) => s.id === sessionId);
    if (!session) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    return HttpResponse.json(session);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions', async ({ params, request }) => {
    const projectId = getId(params, 'prj');
    const body: any = await request.json().catch(() => ({}));
    const newSession = {
      id: `chat_${Date.now()}`,
      project_id: projectId,
      title: body?.title || 'New Chat',
      model: body?.model || 'gpt-4o',
      endpoint_id: body?.endpoint_id || 'endpoint_001',
      pinned: false,
      starred: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
      total_tokens: 0,
    };
    chatSessionFixtures.unshift(newSession);
    return HttpResponse.json(newSession, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));
    const idx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    chatSessionFixtures[idx] = {
      ...chatSessionFixtures[idx],
      ...body,
      updated_at: new Date().toISOString(),
    };
    return HttpResponse.json(chatSessionFixtures[idx]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/chat/sessions/:session', ({ params }) => {
    const sessionId = getId(params, 'session');
    const idx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (idx === -1) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Session not found' }, { status: 404 });
    }
    chatSessionFixtures.splice(idx, 1);
    for (let i = chatMessageFixtures.length - 1; i >= 0; i--) {
      if (chatMessageFixtures[i].session_id === sessionId) chatMessageFixtures.splice(i, 1);
    }
    for (let i = attachmentFixtures.length - 1; i >= 0; i--) {
      if (attachmentFixtures[i].session_id === sessionId) attachmentFixtures.splice(i, 1);
    }
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages', ({ params, request }) => {
    const url = new URL(request.url);
    const { page, pageSize } = getPagination(url);
    const sessionId = getId(params, 'session');
    const messages = chatMessageFixtures.filter((m) => m.session_id === sessionId);
    return HttpResponse.json(paginated(messages, page, pageSize));
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages', async ({ params, request }) => {
    const body: any = await request.json();
    const sessionId = getId(params, 'session');
    const prev = [...chatMessageFixtures].reverse().find((m) => m.session_id === sessionId);
    const newMessage: any = {
      id: `msg_${Date.now()}`,
      session_id: sessionId,
      role: body.role,
      content: body.content,
      created_at: new Date().toISOString(),
      parent_id: body.parent_id ?? prev?.id ?? null,
    };
    chatMessageFixtures.push(newMessage);
    const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (sidx !== -1) {
      chatSessionFixtures[sidx].updated_at = new Date().toISOString();
      chatSessionFixtures[sidx].message_count += 1;
    }
    return HttpResponse.json(newMessage, { status: 201 });
  }),

  http.patch('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages/:message', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const messageId = getId(params, 'message');
    const body: any = await request.json().catch(() => ({}));
    const original = chatMessageFixtures.find((m) => m.id === messageId && m.session_id === sessionId);
    if (!original) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Message not found' }, { status: 404 });
    }
    const logicalId = original.logical_id || `log_${messageId}`;
    const revisionIndex =
      Math.max(
        0,
        ...chatMessageFixtures
          .filter((m: any) => m.session_id === sessionId && m.logical_id === logicalId)
          .map((m: any) => m.revision_index ?? 0),
      ) + 1;
    const now = new Date().toISOString();

    const revision: any = {
      id: `msg_${Date.now()}`,
      session_id: sessionId,
      role: original.role,
      content: body.content,
      created_at: now,
      parent_id: original.parent_id ?? null,
      logical_id: logicalId,
      revision_of: original.id,
      revision_index: revisionIndex,
    };

    chatMessageFixtures.push(revision);
    const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
    if (sidx !== -1) chatSessionFixtures[sidx].updated_at = now;
    return HttpResponse.json(revision);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/messages/stream', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));

    const encoder = new TextEncoder();
    const streamId = `str_${Date.now()}`;

    const fromMessageId = body.from_message_id as string | undefined;
    const branchLeafMessageId = body.branch_leaf_message_id as string | undefined;
    const fromMessage = fromMessageId ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessageId) : null;
    const parentForFrom = fromMessage?.parent_id
      ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessage.parent_id)
      : null;
    const prompt =
      body?.input?.content ||
      (fromMessage?.role === 'assistant' ? parentForFrom?.content : fromMessage?.content) ||
      '';

    const answer = `**Echo** (mock)\n\n${prompt}\n\n- streaming: ok\n- gfm: ok\n`;

    const sourceMessage = fromMessageId ? (chatMessageFixtures as any[]).find((m) => m.id === fromMessageId) : null;
    const sourceParentId = sourceMessage?.parent_id || null;
    const baseGroupId = sourceMessage?.variant_group_id || (sourceParentId ? `vg_${sourceParentId}` : undefined);
    const vg = baseGroupId || `vg_${fromMessageId || branchLeafMessageId || sessionId}`;
    const existingVariants = (chatMessageFixtures as any[]).filter((m) => m.session_id === sessionId && m.variant_group_id === vg);
    const variantIndex = existingVariants.length;
    const assistantMessageId = `msg_${Date.now() + 1}`;

    const sse = new ReadableStream({
      start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        send('meta', { stream_id: streamId, session_id: sessionId, model: body.model, endpoint_id: body.endpoint_id });

        const chunkSize = 10;
        let idx = 0;

        const tick = () => {
          if (idx >= answer.length) {
            // Persist assistant message (final content)
            (chatMessageFixtures as any[]).push({
              id: assistantMessageId,
              session_id: sessionId,
              role: 'assistant',
              content: answer,
              created_at: new Date().toISOString(),
              parent_id: sourceMessage?.role === 'assistant' ? sourceParentId : (branchLeafMessageId || fromMessageId || null),
              variant_group_id: vg,
              variant_index: variantIndex,
              is_stale: false,
            });
            const sidx = chatSessionFixtures.findIndex((s) => s.id === sessionId);
            if (sidx !== -1) {
              chatSessionFixtures[sidx].updated_at = new Date().toISOString();
              chatSessionFixtures[sidx].message_count += 1;
            }
            send('done', { message_id: assistantMessageId, finish_reason: 'stop', tokens: 120 });
            controller.close();
            return;
          }
          const delta = answer.slice(idx, idx + chunkSize);
          idx += chunkSize;
          send('delta', { message_id: assistantMessageId, variant_group_id: vg, variant_index: variantIndex, delta });
          setTimeout(tick, 40);
        };

        tick();
      },
    });

    return new HttpResponse(sse, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/streams/:stream_id/cancel', () => {
    return HttpResponse.json({ success: true });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attachments = attachmentFixtures.filter((a) => a.session_id === sessionId);
    return HttpResponse.json({ items: attachments, total: attachments.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/init', async ({ params, request }) => {
    const sessionId = getId(params, 'session');
    const body: any = await request.json().catch(() => ({}));
    const attId = `att_${Date.now()}`;
    const att: any = {
      id: attId,
      session_id: sessionId,
      file_name: body.file_name,
      file_type: body.file_type,
      file_size: body.file_size,
      upload_status: 'uploading',
      created_at: new Date().toISOString(),
    };
    attachmentFixtures.push(att);
    return HttpResponse.json(
      {
        attachment: att,
        upload_url: `/api/workspaces/${getId(params, 'ws')}/projects/${getId(params, 'prj')}/chat/sessions/${sessionId}/attachments/${attId}/upload`,
      },
      { status: 201 },
    );
  }),

  http.put('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/upload', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'processing';
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/complete', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'ready';
    attachmentFixtures[idx].error_message = undefined;
    return HttpResponse.json(attachmentFixtures[idx]);
  }),

  http.delete('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures.splice(idx, 1);
    return HttpResponse.json({ success: true });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/chat/sessions/:session/attachments/:att/retry', ({ params }) => {
    const sessionId = getId(params, 'session');
    const attId = getId(params, 'att');
    const idx = attachmentFixtures.findIndex((a) => a.id === attId && a.session_id === sessionId);
    if (idx === -1) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Attachment not found' }, { status: 404 });
    attachmentFixtures[idx].upload_status = 'processing';
    attachmentFixtures[idx].error_message = undefined;
    setTimeout(() => {
      const again = attachmentFixtures.find((a) => a.id === attId && a.session_id === sessionId);
      if (again) again.upload_status = 'ready';
    }, 600);
    return HttpResponse.json(attachmentFixtures[idx]);
  }),

  // ============================================================
  // Workbench
  // ============================================================

  http.get('/api/workspaces/:ws/projects/:prj/sources', () => {
    return HttpResponse.json({ items: sourceFileFixtures, total: sourceFileFixtures.length });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads', () => {
    return HttpResponse.json({ items: agentThreadFixtures, total: agentThreadFixtures.length });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads/:thread', ({ params }) => {
    const threadId = getId(params, 'thread');
    const thread = agentThreadFixtures.find((t) => t.id === threadId);
    if (!thread) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'Thread not found' }, { status: 404 });
    }
    return HttpResponse.json(thread);
  }),

  http.post('/api/workspaces/:ws/projects/:prj/threads', async ({ params, request }) => {
    const body: any = await request.json();
    const newThread = {
      id: `thread_${Date.now()}`,
      project_id: getId(params, 'prj'),
      end_user_id: body.end_user_id,
      current_agent_id: body.agent_id,
      title: body.title,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentThreadFixtures.push(newThread);
    return HttpResponse.json(newThread, { status: 201 });
  }),

  http.get('/api/workspaces/:ws/projects/:prj/threads/:thread/turns', ({ params }) => {
    const threadId = getId(params, 'thread');
    const turns = turnFixtures.filter((t) => t.agent_thread_id === threadId);
    return HttpResponse.json({ items: turns, total: turns.length });
  }),

  http.post('/api/workspaces/:ws/projects/:prj/threads/:thread/turns', async ({ params, request }) => {
    const body: any = await request.json();
    const newTurn = {
      id: `turn_${Date.now()}`,
      agent_thread_id: getId(params, 'thread'),
      status: 'queued' as const,
      input_message: body.message,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    turnFixtures.push(newTurn);
    return HttpResponse.json(newTurn, { status: 201 });
  }),
];

// Export for MSW setup
export default handlers;
