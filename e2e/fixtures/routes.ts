export const ROUTES = {
  public: [
    { path: '/', title: /MBOS|Login|Sign in|登录/i },
    { path: '/app-shell', title: /App Shell/i },
    { path: '/zh-CN', title: /MBOS|Login|Sign in|登录/i },
    { path: '/zh-CN/login', title: /Login|Sign in|登录/i },
    { path: '/zh-CN/login/workspace', title: /Workspace|Select|工作区|工作空间/i },
    { path: '/zh-CN/join', title: /Invalid|Join|加入|邀请无效|加入项目/i },
  ],
  user: [
    { path: '/zh-CN/user/profile', testId: 'profile__form' },
    { path: '/zh-CN/user/api-keys', testId: 'api-keys__create-btn' },
  ],
  workspace: [
    { path: '/zh-CN/workspaces/ws_default/projects', testId: 'projects__create-btn' },
    { path: '/zh-CN/workspaces/ws_default/settings', testId: 'ws-settings__members' },
  ],
  project: [
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/overview', testId: 'overview__quick-access' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/chat', testId: 'chat__main-pane' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/notebook', testId: 'notebook__task-list' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/notebook/tasks/task_001', testId: 'notebook__task-header' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/agents', testId: 'agents__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/endpoints', testId: 'endpoints__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/resource-policy', testId: 'resource-policy__editor' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/members', testId: 'members__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/audit', testId: 'audit__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/usage', testId: 'usage__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/files', testId: 'files__library-list' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/credentials', testId: 'credentials__table' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/settings', testId: 'settings__tab--general' },
  ],
};
