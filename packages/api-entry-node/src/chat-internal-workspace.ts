import type { AgentRecord, ChatSessionRecord } from './resource-models.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import { createAndProvisionProjectFileLibrary } from './project-file-library-service.js';

function buildInternalChatWorkspaceName(session: ChatSessionRecord, agent: AgentRecord): string {
  const title = session.title.trim();
  if (title && title !== 'New Chat') {
    return title;
  }
  const agentName = agent.name.trim();
  if (agentName) {
    return `${agentName} Chat Workspace`;
  }
  return 'Chat Workspace';
}

async function persistSessionWorkspaceLibrary(input: {
  deps: NodeApiDeps;
  session: ChatSessionRecord;
  workspaceFileLibraryId: string;
  workspaceFileLibraryName: string;
}): Promise<ChatSessionRecord> {
  const updated = await input.deps.chatResourceService.updateSession(
    input.session.workspace_id,
    input.session.project_id,
    input.session.id,
    {
      workspace_file_library_id: input.workspaceFileLibraryId,
      workspace_file_library_name: input.workspaceFileLibraryName,
    },
  );
  return updated ?? {
    ...input.session,
    workspace_file_library_id: input.workspaceFileLibraryId,
    workspace_file_library_name: input.workspaceFileLibraryName,
  };
}

export async function ensureInternalChatSessionWorkspace(input: {
  deps: NodeApiDeps;
  session: ChatSessionRecord;
  agent: AgentRecord;
}): Promise<{
  session: ChatSessionRecord;
  workspaceFileLibraryId: string;
  workspaceFileLibraryName: string;
}> {
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);
  const existingId = input.session.workspace_file_library_id?.trim() ?? '';
  if (existingId) {
    const existingLibrary = await catalogRepo.getByIdForOwner(
      input.session.workspace_id,
      input.session.project_id,
      existingId,
      input.session.owner_user_id,
    );
    if (existingLibrary?.status === 'ready') {
      const session = input.session.workspace_file_library_name === existingLibrary.name
        ? input.session
        : await persistSessionWorkspaceLibrary({
          deps: input.deps,
          session: input.session,
          workspaceFileLibraryId: existingLibrary.id,
          workspaceFileLibraryName: existingLibrary.name,
        });
      return {
        session,
        workspaceFileLibraryId: existingLibrary.id,
        workspaceFileLibraryName: existingLibrary.name,
      };
    }
  }

  const workspaceLibrary = await createAndProvisionProjectFileLibrary({
    deps: input.deps,
    workspaceId: input.session.workspace_id,
    projectId: input.session.project_id,
    userId: input.session.owner_user_id,
    name: buildInternalChatWorkspaceName(input.session, input.agent),
    description: `Auto-initialized workspace for chat session "${input.session.id}".`,
  });
  if (!workspaceLibrary) {
    throw new Error('file_library_operation_failed');
  }
  const session = await persistSessionWorkspaceLibrary({
    deps: input.deps,
    session: input.session,
    workspaceFileLibraryId: workspaceLibrary.id,
    workspaceFileLibraryName: workspaceLibrary.name,
  });
  return {
    session,
    workspaceFileLibraryId: workspaceLibrary.id,
    workspaceFileLibraryName: workspaceLibrary.name,
  };
}
