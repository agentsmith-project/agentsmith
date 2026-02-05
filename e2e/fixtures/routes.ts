export const ROUTES = {
  public: [
    { path: '/', title: /MBOS|Login|Sign in/i },
    { path: '/app-shell', title: /App Shell/i },
    { path: '/en-US', title: /MBOS|Login|Sign in/i },
    { path: '/en-US/login', title: /Login|Sign in/i },
    { path: '/en-US/login/workspace', title: /Workspace|Select/i },
    { path: '/en-US/join', title: /Invalid|Join/i },
  ],
  user: [
    { path: '/en-US/user/profile', title: /Profile|Account/i },
    { path: '/en-US/user/api-keys', title: /API Keys|Keys/i },
  ],
  workspace: [
    { path: '/en-US/workspaces/ws_default/projects', title: /Projects/i },
    { path: '/en-US/workspaces/ws_default/settings', title: /Workspace Settings|Settings/i },
  ],
  project: [
    { path: '/en-US/workspaces/ws_default/projects/proj_001/overview', title: /Overview/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/chat', testId: 'chat-main-pane' },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/workbench', title: /Workbench/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/workbench/recipes/recipe_001', testId: 'workbench-recipe-header' },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/agents', title: /Agents/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/endpoints', title: /Endpoints/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/members', title: /Members/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/audit', title: /Audit/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/usage', title: /Usage/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/userdata', title: /UserData|User Data/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/sources', title: /Sources/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/credentials', title: /Credentials|Keys/i },
    { path: '/en-US/workspaces/ws_default/projects/proj_001/settings', title: /Settings|Project/i },
  ],
};
