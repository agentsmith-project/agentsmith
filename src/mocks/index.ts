import { authHandlers } from './handlers/auth';
import { workspaceHandlers } from './handlers/workspace';
import { projectHandlers } from './handlers/projects';
import { endpointHandlers } from './handlers/endpoints';
import { agentHandlers } from './handlers/agents';
import { sourceHandlers } from './handlers/sources';
import { userdataHandlers } from './handlers/userdata';
import { auditHandlers } from './handlers/audit';
import { usageHandlers } from './handlers/usage';
import { chatHandlers } from './handlers/chat';
import { workbenchHandlers } from './handlers/workbench';
import { recipeHandlers } from './handlers/recipes';
import { meHandlers } from './handlers/me';

export const handlers = [
  ...authHandlers,
  ...meHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...endpointHandlers,
  ...agentHandlers,
  ...sourceHandlers,
  ...userdataHandlers,
  ...auditHandlers,
  ...usageHandlers,
  ...chatHandlers,
  ...workbenchHandlers,
  ...recipeHandlers,
];
