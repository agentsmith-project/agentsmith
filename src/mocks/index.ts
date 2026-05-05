import { authHandlers } from './handlers/auth';
import { workspaceHandlers } from './handlers/workspace';
import { projectHandlers } from './handlers/projects';
import { endpointHandlers } from './handlers/endpoints';
import { agentRunnerHandlers } from './handlers/agent-runners';
import { credentialHandlers } from './handlers/credentials';
import { memberHandlers } from './handlers/members';
import { fileHandlers } from './handlers/files';
import { auditHandlers } from './handlers/audit';
import { usageHandlers } from './handlers/usage';
import { chatHandlers } from './handlers/chat';
import { taskHandlers } from './handlers/tasks';
import { meHandlers } from './handlers/me';
import { userKeyHandlers } from './handlers/user-keys';
import { alertsHandlers } from './handlers/alerts';
import { modelConfigHandlers } from './handlers/model-config';
import { contextHandlers } from './handlers/context';

export const handlers = [
  ...authHandlers,
  ...meHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...endpointHandlers,
  ...agentRunnerHandlers,
  ...credentialHandlers,
  ...memberHandlers,
  ...fileHandlers,
  ...auditHandlers,
  ...usageHandlers,
  ...chatHandlers,
  ...taskHandlers,
  ...userKeyHandlers,
  ...alertsHandlers,
  ...modelConfigHandlers,
  ...contextHandlers,
];
