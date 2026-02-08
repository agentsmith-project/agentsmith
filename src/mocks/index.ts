import { authHandlers } from './handlers/auth';
import { workspaceHandlers } from './handlers/workspace';
import { projectHandlers } from './handlers/projects';
import { endpointHandlers } from './handlers/endpoints';
import { agentHandlers } from './handlers/agents';
import { credentialHandlers } from './handlers/credentials';
import { memberHandlers } from './handlers/members';
import { sourceHandlers } from './handlers/sources';
import { auditHandlers } from './handlers/audit';
import { usageHandlers } from './handlers/usage';
import { chatHandlers } from './handlers/chat';
import { studioHandlers } from './handlers/studio';
import { recipeHandlers } from './handlers/recipes';
import { meHandlers } from './handlers/me';
import { userKeyHandlers } from './handlers/user-keys';

export const handlers = [
  ...authHandlers,
  ...meHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...endpointHandlers,
  ...agentHandlers,
  ...credentialHandlers,
  ...memberHandlers,
  ...sourceHandlers,
  ...auditHandlers,
  ...usageHandlers,
  ...chatHandlers,
  ...studioHandlers,
  ...recipeHandlers,
  ...userKeyHandlers,
];
