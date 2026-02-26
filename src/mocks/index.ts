import { authHandlers } from './handlers/auth';
import { workspaceHandlers } from './handlers/workspace';
import { projectHandlers } from './handlers/projects';
import { endpointHandlers } from './handlers/endpoints';
import { agentHandlers } from './handlers/agents';
import { credentialHandlers } from './handlers/credentials';
import { memberHandlers } from './handlers/members';
import { fileHandlers } from './handlers/files';
import { auditHandlers } from './handlers/audit';
import { usageHandlers } from './handlers/usage';
import { chatHandlers } from './handlers/chat';
import { notebookHandlers } from './handlers/notebook';
import { taskHandlers } from './handlers/tasks';
import { meHandlers } from './handlers/me';
import { userKeyHandlers } from './handlers/user-keys';
import { alertsHandlers } from './handlers/alerts';

export const handlers = [
  ...authHandlers,
  ...meHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...endpointHandlers,
  ...agentHandlers,
  ...credentialHandlers,
  ...memberHandlers,
  ...fileHandlers,
  ...auditHandlers,
  ...usageHandlers,
  ...chatHandlers,
  ...notebookHandlers,
  ...taskHandlers,
  ...userKeyHandlers,
  ...alertsHandlers,
];
