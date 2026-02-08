export const ROUTES = {
  public: [
    { path: '/', title: /MBOS|Login|Sign in|登录/i },
    { path: '/app-shell', title: /App Shell/i },
    { path: '/zh-CN', title: /MBOS|Login|Sign in|登录/i },
    { path: '/zh-CN/login', title: /Login|Sign in|登录/i },
    { path: '/zh-CN/login/workspace', title: /Workspace|Select|工作区/i },
    { path: '/zh-CN/join', title: /Invalid|Join|加入|邀请无效|加入项目/i },
  ],
  user: [
    { path: '/zh-CN/user/profile', title: /Profile|Account|个人资料|账户/i },
    { path: '/zh-CN/user/api-keys', title: /API Keys|Keys|API/i },
  ],
  workspace: [
    { path: '/zh-CN/workspaces/ws_default/projects', title: /Projects|项目/i },
    { path: '/zh-CN/workspaces/ws_default/settings', title: /Workspace Settings|Settings|工作区|项目设置/i },
  ],
  project: [
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/overview', title: /Overview|概览/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/chat', testId: 'chat__main-pane' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/studio', testId: 'workbench__recipe-list' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/studio/recipes/recipe_001', testId: 'workbench__recipe-header' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/agents', title: /Agents|代理|智能体/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/endpoints', title: /Endpoints|端点/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/members', title: /Members|成员/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/audit', title: /Audit|审计/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/usage', title: /Usage|用量/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/sources', testId: 'sources__library-select' },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/credentials', title: /Credentials|Keys|凭据/i },
    { path: '/zh-CN/workspaces/ws_default/projects/proj_001/settings', title: /Settings|Project|设置/i },
  ],
};
