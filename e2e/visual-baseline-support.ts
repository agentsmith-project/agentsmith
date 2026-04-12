import path from 'node:path';
import { themedScreenshotName, VISUAL_THEMES, type VisualTheme } from './utils/visual-theme';

const LOCALE = 'en-US';
const WS_ID = 'ws_default';
const ALT_WS_ID = 'ws_test';
const PROJECT_ID = 'proj_001';

function projectPath(section: string) {
  return `/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/${section}`;
}

export type VisualRecipeFamily =
  | 'public_auth_single'
  | 'public_auth_split'
  | 'work_surface_standard'
  | 'work_surface_immersive'
  | 'settings_sheet'
  | 'governance_table_detail'
  | 'system_admin_detail'
  | 'overlay_dialog'
  | 'overlay_sheet';

export type VisualBaselineTheme = VisualTheme | 'default';
export type VisualBaselineScenarioGroup =
  | 'public_pages'
  | 'workspace_pages'
  | 'project_pages'
  | 'system_pages'
  | 'user_pages'
  | 'governance_pages'
  | 'overlay_cases'
  | 'overlay_drawers';

export type VisualBaselineAuthLane =
  | 'public'
  | 'authed'
  | 'guest'
  | 'system_admin'
  | 'mock_auth'
  | 'mixed';

export type VisualBaselineCaptureMode = 'full_page' | 'viewport';
export type VisualBaselineBuildLane = 'mock-lane' | 'backend-real';

export type VisualBaselineBuildRecord = {
  lane: VisualBaselineBuildLane;
  runId: string;
  gitSha: string;
  fingerprint: string;
  startedAt: string;
};

type VisualBaselineScenarioSeed = {
  id: string;
  group: VisualBaselineScenarioGroup;
  route: string;
  recipeFamily: VisualRecipeFamily;
  storyId: string;
  scenario: string;
  codeRefs: readonly string[];
  capture: VisualBaselineCaptureMode;
  authLane: VisualBaselineAuthLane;
  screenshotBaseName?: string;
  themes?: readonly VisualTheme[];
  viewport?: 'default' | 'ultrawide';
  setupNotes?: readonly string[];
  stableMarkers?: readonly string[];
};

export type VisualBaselineCatalogEntry = {
  id: string;
  scenarioId: string;
  screenshot: string;
  route: string;
  theme: VisualBaselineTheme;
  group: VisualBaselineScenarioGroup;
  recipeFamily: VisualRecipeFamily;
  storyId: string;
  scenario: string;
  codeRefs: readonly string[];
  capture: VisualBaselineCaptureMode;
  authLane: VisualBaselineAuthLane;
  viewport: 'default' | 'ultrawide';
  setupNotes: readonly string[];
  stableMarkers: readonly string[];
  sourceSpec: 'e2e/visual.spec.ts';
};

export type VisualBaselineScenarioRecord = {
  scenarioId: string;
  group: VisualBaselineScenarioGroup;
  route: string;
  recipeFamily: VisualRecipeFamily;
  storyId: string;
  scenario: string;
  codeRefs: readonly string[];
  capture: VisualBaselineCaptureMode;
  authLane: VisualBaselineAuthLane;
  viewport: 'default' | 'ultrawide';
  setupNotes: readonly string[];
  stableMarkers: readonly string[];
  entries: VisualBaselineCatalogEntry[];
};

export type VisualBaselineReviewVerdict = 'pending' | 'aligned' | 'needs_work' | 'blocked';

export type VisualBaselineReviewRecord = {
  reviewer: string;
  reviewedAt: string;
  verdict: VisualBaselineReviewVerdict;
  cursorFit: 'aligned' | 'partial' | 'drifting';
  uxFit: 'low_mindload' | 'mixed' | 'friction';
  notes: string[];
  blockingFindings?: string[];
};

function paired(
  seed: Omit<VisualBaselineScenarioSeed, 'themes' | 'screenshotBaseName'> & {
    screenshotBaseName?: string;
  },
): VisualBaselineScenarioSeed {
  return {
    ...seed,
    screenshotBaseName: seed.screenshotBaseName ?? seed.id,
    themes: VISUAL_THEMES,
  };
}

function single(seed: Omit<VisualBaselineScenarioSeed, 'themes'>): VisualBaselineScenarioSeed {
  return seed;
}

function stableMarkers(...markers: string[]): readonly string[] {
  return markers;
}

const SCENARIOS: readonly VisualBaselineScenarioSeed[] = [
  single({
    id: 'workspace-home-project-creator',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_entry_project_creator',
    scenario: 'Workspace home for a project creator with create-project affordance visible.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'projects-list',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/projects`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_projects_browse',
    scenario: 'Workspace projects list for an authenticated member.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'projects-list-public-discovery',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/projects`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_projects_guest_discovery',
    scenario: 'Guest discovery view that exposes join/request actions without private projects.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'guest',
  }),
  single({
    id: 'dialog-project-join-request',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/projects`,
    recipeFamily: 'overlay_dialog',
    storyId: 'workspace_projects_join_request',
    scenario: 'Join-request dialog for a protected project.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'guest',
  }),
  single({
    id: 'dialog-project-join-now',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/projects`,
    recipeFamily: 'overlay_dialog',
    storyId: 'workspace_projects_join_now',
    scenario: 'Immediate join confirmation dialog for an open project.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'guest',
  }),
  single({
    id: 'notification-center-join-request',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/projects`,
    recipeFamily: 'overlay_sheet',
    storyId: 'workspace_notifications_join_outcome',
    scenario: 'Notification center open with join-request outcome messages.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/app-shell/Topbar.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'projects-empty',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${ALT_WS_ID}/projects`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_projects_empty_state',
    scenario: 'Empty projects state in a workspace with no projects yet.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-settings-create-project',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/settings`,
    recipeFamily: 'overlay_sheet',
    storyId: 'workspace_settings_create_project',
    scenario: 'Create-project flow opened from workspace settings.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-settings-feishu-enabled',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/settings`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_connections_feishu_enabled',
    scenario: 'Workspace settings with Feishu integration already enabled.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-feishu-setup-credentials',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/settings/feishu?step=credentials`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_connections_feishu_setup',
    scenario: 'Feishu setup flow at the credentials draft step.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-feishu-locked',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/settings/feishu`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_connections_feishu_locked',
    scenario: 'Feishu integration locked after enablement.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-connections-feishu-disabled',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/connections`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_connections_index_disabled',
    scenario: 'Workspace connections index with Feishu disabled.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/connections/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'workspace-connections-feishu-connected',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/connections`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_connections_index_connected',
    scenario: 'Workspace connections index with Feishu connected.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/connections/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'system-workspaces-edit-mode',
    group: 'system_pages',
    route: `/${LOCALE}/system/workspaces`,
    recipeFamily: 'system_admin_detail',
    storyId: 'system_workspaces_edit_mode',
    scenario: 'System workspaces page in editor mode.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemWorkspacesPage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers(
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__basics',
    ),
  }),
  single({
    id: 'system-workspaces-create-wizard',
    group: 'system_pages',
    route: `/${LOCALE}/system/workspaces/new`,
    recipeFamily: 'system_admin_detail',
    storyId: 'system_workspace_create_wizard',
    scenario: 'System workspace creation wizard.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemWorkspaceCreatePage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers(
      'system-workspace-create__shell',
      'system-workspace-create__step-tracker',
      'system-workspace-create__next',
    ),
  }),
  single({
    id: 'system-workspaces-failed-state',
    group: 'system_pages',
    route: `/${LOCALE}/system/workspaces`,
    recipeFamily: 'system_admin_detail',
    storyId: 'system_workspaces_failed_state',
    scenario: 'System workspaces list with failed provisioning state.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemWorkspacesPage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers(
      'system-workspaces__list',
      'system-workspaces__editor',
      'system-workspaces__card--ws_seeded',
      'system-workspaces__read-only-notice',
    ),
  }),
  single({
    id: 'system-workspaces-delete-confirmation',
    group: 'system_pages',
    route: `/${LOCALE}/system/workspaces`,
    recipeFamily: 'overlay_dialog',
    storyId: 'system_workspaces_delete_confirmation',
    scenario: 'Delete confirmation dialog from system workspaces.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemWorkspacesPage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers(
      'system-workspaces__delete-dialog',
      'system-workspaces__delete-cancel',
      'system-workspaces__delete-confirm',
    ),
  }),
  single({
    id: 'chat-ultrawide',
    group: 'project_pages',
    route: projectPath('chat'),
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_chat_ultrawide',
    scenario: 'Chat work surface in ultrawide layout.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    viewport: 'ultrawide',
  }),
  single({
    id: 'notebook-create-task-dialog',
    group: 'project_pages',
    route: projectPath('notebook'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_notebook_create_task',
    scenario: 'Create task dialog opened from notebook.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'notebook-task-detail',
    group: 'project_pages',
    route: `${projectPath('notebook')}/tasks/task_001`,
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_notebook_task_detail',
    scenario: 'Notebook task detail surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'notebook-task-detail-artifact-hover',
    group: 'project_pages',
    route: `${projectPath('notebook')}/tasks/task_001`,
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_notebook_task_detail_artifact_hover',
    scenario: 'Notebook task detail with artifact hover state visible.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'overview',
    group: 'project_pages',
    route: projectPath('overview'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_overview',
    scenario: 'Project overview work surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'chat-standard',
    group: 'project_pages',
    route: projectPath('chat'),
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_chat_standard',
    scenario: 'Standard chat work surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('chat__surface', 'chat__threads-pane', 'chat__main-pane', 'chat__header', 'chat__composer'),
  }),
  paired({
    id: 'notebook',
    group: 'project_pages',
    route: projectPath('notebook'),
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_notebook_list',
    scenario: 'Notebook list work surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'files',
    group: 'project_pages',
    route: projectPath('files'),
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_files_browse',
    scenario: 'Files workbench with library browser.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/FilesPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers(
      'files__workspace-surface',
      'files__workspace-grid',
      'files__libraries-shell',
      'files__browser-shell',
      'files__library-list',
      'files__objects-table',
    ),
  }),
  paired({
    id: 'alerts',
    group: 'project_pages',
    route: projectPath('alerts'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_alerts',
    scenario: 'Project alerts surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('alerts__main-surface', 'alert-center-page', 'alert-center__summary-meta', 'alerts__open-audit', 'alerts__open-usage'),
  }),
  paired({
    id: 'join',
    group: 'public_pages',
    route: `/${LOCALE}/join`,
    recipeFamily: 'public_auth_single',
    storyId: 'public_join_entry',
    scenario: 'Public join flow entry state.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/join/page.tsx'],
    capture: 'full_page',
    authLane: 'public',
    stableMarkers: stableMarkers(),
  }),
  paired({
    id: 'system-login',
    group: 'public_pages',
    route: `/${LOCALE}/system/login`,
    recipeFamily: 'public_auth_split',
    storyId: 'system_login',
    scenario: 'System 管理侧 sign-in page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/system/login/page.tsx'],
    capture: 'full_page',
    authLane: 'public',
    stableMarkers: stableMarkers('system-login__heading', 'system-login__submit'),
  }),
  paired({
    id: 'workspace-select',
    group: 'public_pages',
    route: `/${LOCALE}/login/workspace`,
    recipeFamily: 'public_auth_single',
    storyId: 'workspace_select',
    scenario: 'Workspace selection entry page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/auth/WorkspaceSelectView.tsx'],
    capture: 'full_page',
    authLane: 'public',
    stableMarkers: stableMarkers('workspace-select__heading', 'workspace-select__list', 'workspace-select__system-link'),
  }),
  paired({
    id: 'workspace-login',
    group: 'public_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/login`,
    recipeFamily: 'public_auth_single',
    storyId: 'workspace_login',
    scenario: 'Workspace login page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/login/page.tsx'],
    capture: 'full_page',
    authLane: 'public',
    stableMarkers: stableMarkers(
      'public-auth__shell',
      'workspace-login__heading',
      'workspace-login__keycloak-btn',
    ),
  }),
  paired({
    id: 'desktop-auth-request',
    group: 'public_pages',
    route: `/${LOCALE}/desktop/auth/request?desktop_auth_request_id=req_visual_001`,
    recipeFamily: 'public_auth_split',
    storyId: 'desktop_auth_request',
    scenario: 'Desktop handoff request page with guidance and retry path.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/desktop/auth/request/page.tsx'],
    capture: 'full_page',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('desktop-auth-request__title'),
  }),
  paired({
    id: 'desktop-auth-complete',
    group: 'public_pages',
    route: `/${LOCALE}/desktop/auth/complete?desktop_auth_request_id=req_visual_001`,
    recipeFamily: 'public_auth_single',
    storyId: 'desktop_auth_complete',
    scenario: 'Desktop handoff completion page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/desktop/auth/complete/page.tsx'],
    capture: 'full_page',
    authLane: 'public',
    stableMarkers: stableMarkers('desktop-auth-complete__title', 'desktop-auth-complete__workspace-entry-link'),
  }),
  paired({
    id: 'workspace-overview',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/overview`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_overview',
    scenario: 'Workspace overview page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/overview/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'workspace-home',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_home',
    scenario: 'Workspace home with project entry surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/workspaces/WorkspaceProjectsEntryPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'workspace-settings',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/settings`,
    recipeFamily: 'settings_sheet',
    storyId: 'workspace_settings',
    scenario: 'Workspace settings page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('ws-settings__summary-line', 'ws-settings__workspace', 'ws-settings__integrations', 'ws-settings__projects'),
  }),
  paired({
    id: 'workspace-personal-context',
    group: 'workspace_pages',
    route: `/${LOCALE}/workspaces/${WS_ID}/context`,
    recipeFamily: 'work_surface_standard',
    storyId: 'workspace_personal_context',
    scenario: 'Workspace personal context page for the current member.',
    codeRefs: [
      'e2e/visual.spec.ts',
      'src/app/[locale]/workspaces/[workspace]/context/page.tsx',
      'src/components/context/ContextManager.tsx',
    ],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('context-store__list-card', 'context-store__editor-card'),
  }),
  paired({
    id: 'system-workspaces',
    group: 'system_pages',
    route: `/${LOCALE}/system/workspaces`,
    recipeFamily: 'system_admin_detail',
    storyId: 'system_workspaces_index',
    scenario: 'System workspaces list and detail surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemWorkspacesPage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers('system-workspaces__list', 'system-workspaces__editor-empty'),
  }),
  paired({
    id: 'system-info',
    group: 'system_pages',
    route: `/${LOCALE}/system/info`,
    recipeFamily: 'system_admin_detail',
    storyId: 'system_info',
    scenario: 'System information page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/system/SystemInfoPage.tsx'],
    capture: 'full_page',
    authLane: 'system_admin',
    stableMarkers: stableMarkers('system-info__shell', 'system-info__health', 'system-info__next-steps'),
  }),
  paired({
    id: 'profile',
    group: 'user_pages',
    route: `/${LOCALE}/user/profile?workspace=${WS_ID}&project=${PROJECT_ID}`,
    recipeFamily: 'settings_sheet',
    storyId: 'user_profile',
    scenario: 'User profile settings page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/profile/page.tsx'],
    capture: 'full_page',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('profile__form', 'profile__save-btn'),
  }),
  paired({
    id: 'api-keys',
    group: 'user_pages',
    route: `/${LOCALE}/user/api-keys`,
    recipeFamily: 'settings_sheet',
    storyId: 'user_api_keys',
    scenario: 'API keys self-service page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/api-keys/page.tsx'],
    capture: 'full_page',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('api-keys__list-section', 'api-keys__create-btn'),
  }),
  paired({
    id: 'api-keys-create-dialog',
    group: 'overlay_cases',
    route: `/${LOCALE}/user/api-keys`,
    recipeFamily: 'overlay_dialog',
    storyId: 'user_api_keys_create_dialog',
    scenario: 'API keys create dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/api-keys/_components/CreateApiKeyDialog.tsx'],
    capture: 'viewport',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('api-keys__create-dialog'),
  }),
  paired({
    id: 'api-keys-key-created-dialog',
    group: 'overlay_cases',
    route: `/${LOCALE}/user/api-keys`,
    recipeFamily: 'overlay_dialog',
    storyId: 'user_api_keys_created_dialog',
    scenario: 'API keys success dialog after creating a new key.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/api-keys/KeyCreatedDialog.tsx'],
    capture: 'viewport',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('api-keys__key-created-dialog'),
  }),
  paired({
    id: 'third-party-accounts',
    group: 'user_pages',
    route: `/${LOCALE}/user/third-party-accounts`,
    recipeFamily: 'settings_sheet',
    storyId: 'user_third_party_accounts',
    scenario: 'Third-party account connections page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/third-party-accounts/page.tsx'],
    capture: 'full_page',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('third-party-accounts__list-section', 'third-party-accounts__create-btn'),
  }),
  paired({
    id: 'third-party-accounts-create-sheet',
    group: 'overlay_cases',
    route: `/${LOCALE}/user/third-party-accounts`,
    recipeFamily: 'overlay_sheet',
    storyId: 'user_third_party_accounts_create_sheet',
    scenario: 'Third-party accounts create sheet.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/third-party-accounts/page.tsx'],
    capture: 'viewport',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('third-party-accounts__sheet'),
  }),
  paired({
    id: 'third-party-accounts-edit-sheet',
    group: 'overlay_cases',
    route: `/${LOCALE}/user/third-party-accounts`,
    recipeFamily: 'overlay_sheet',
    storyId: 'user_third_party_accounts_edit_sheet',
    scenario: 'Third-party accounts edit sheet with seeded custom connection.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/user/third-party-accounts/page.tsx'],
    capture: 'viewport',
    authLane: 'mock_auth',
    stableMarkers: stableMarkers('third-party-accounts__sheet'),
  }),
  paired({
    id: 'agents',
    group: 'governance_pages',
    route: projectPath('agents'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_agents',
    scenario: 'Agents index page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agents/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'endpoints',
    group: 'governance_pages',
    route: projectPath('endpoints'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_endpoints',
    scenario: 'Endpoints page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('endpoints__work-toolbar', 'endpoints__create-btn'),
  }),
  paired({
    id: 'credentials',
    group: 'governance_pages',
    route: projectPath('credentials'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_credentials',
    scenario: 'Project credentials page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'project-personal-context',
    group: 'governance_pages',
    route: projectPath('my-context'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_personal_context',
    scenario: 'Project personal context page for the current member.',
    codeRefs: [
      'e2e/visual.spec.ts',
      'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/my-context/page.tsx',
      'src/components/context/ContextManager.tsx',
    ],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('context-store__list-card', 'context-store__editor-card'),
  }),
  paired({
    id: 'members',
    group: 'governance_pages',
    route: projectPath('members'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_members',
    scenario: 'Members and access governance page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/MembersPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('members__work-surface', 'members__invite-btn'),
  }),
  paired({
    id: 'resource-policy',
    group: 'governance_pages',
    route: projectPath('resource-policy'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_resource_policy',
    scenario: 'Resource policy governance page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'access-guide',
    group: 'governance_pages',
    route: projectPath('use-guide'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_access_guide',
    scenario: 'Project access guide page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'audit',
    group: 'governance_pages',
    route: projectPath('audit'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_audit',
    scenario: 'Project audit page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/audit-usage/AuditPageContent.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('audit__page', 'audit__work-surface', 'audit__table'),
  }),
  paired({
    id: 'usage',
    group: 'governance_pages',
    route: projectPath('usage'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_usage',
    scenario: 'Project usage page with the resolved endpoint scope.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/audit-usage/UsagePage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('usage__work-surface', 'usage__summary-line', 'usage__selected-endpoint', 'usage__limits'),
  }),
  paired({
    id: 'settings',
    group: 'governance_pages',
    route: projectPath('settings'),
    recipeFamily: 'settings_sheet',
    storyId: 'project_settings',
    scenario: 'Project settings page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('settings__summary-line', 'settings__general-section', 'settings__ownership-section', 'settings__project-admins-section'),
  }),
  paired({
    id: 'audit-empty-state',
    group: 'overlay_cases',
    route: `${projectPath('audit')}?resource_id=__visual_empty__`,
    recipeFamily: 'governance_table_detail',
    storyId: 'project_audit_empty_state',
    scenario: 'Audit page empty-state variant.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/audit-usage/AuditPageContent.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'members-join-requests-tab',
    group: 'overlay_cases',
    route: projectPath('members'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_members_join_requests_tab',
    scenario: 'Members page with join-requests tab active.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/JoinRequestsTab.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'dialog-create-agent',
    group: 'overlay_cases',
    route: projectPath('agents'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_agents_create_dialog',
    scenario: 'Create-agent dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/agents/CreateAgentDialog.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  paired({
    id: 'dialog-files-create-folder',
    group: 'overlay_cases',
    route: projectPath('files'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_files_create_folder_dialog',
    scenario: 'Create-folder dialog in files.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'alerts-notifications-tab',
    group: 'overlay_drawers',
    route: projectPath('alerts'),
    recipeFamily: 'work_surface_standard',
    storyId: 'project_alerts_notifications_tab',
    scenario: 'Alerts page switched to notifications tab.',
    codeRefs: ['e2e/visual.spec.ts', 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('alerts__main-surface', 'alert-center-page', 'alert-center__summary-meta', 'alerts__tab__notifications'),
  }),
  single({
    id: 'alerts-rules-tab',
    group: 'overlay_drawers',
    route: projectPath('alerts'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_alerts_rules_tab',
    scenario: 'Alerts page switched to rules tab.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/alerts/AlertCenterPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('alerts__main-surface', 'alert-center-page', 'alert-center__summary-meta', 'alerts__tab__rules', 'alert-rules-list__surface'),
  }),
  single({
    id: 'alerts-rule-create-dialog',
    group: 'overlay_drawers',
    route: projectPath('alerts'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_alerts_rule_create_dialog',
    scenario: 'Alert rule create dialog opened from the rules surface.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/alerts/AlertCenterPage.tsx', 'src/components/alerts/AlertRuleFormDialog.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('alerts__main-surface', 'alert-center-page', 'alert-center__summary-meta', 'alerts__tab__rules', 'alert-center__create-button'),
  }),
  single({
    id: 'members-effective-access-drawer',
    group: 'overlay_drawers',
    route: `${projectPath('members')}?member_tab=people`,
    recipeFamily: 'overlay_sheet',
    storyId: 'project_members_effective_access',
    scenario: 'Effective access drawer from members page.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/MembersPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'drawer-audit-detail',
    group: 'overlay_drawers',
    route: projectPath('audit'),
    recipeFamily: 'overlay_sheet',
    storyId: 'project_audit_detail_drawer',
    scenario: 'Audit detail drawer.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/audit-usage/AuditPageContent.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-create-endpoint',
    group: 'overlay_drawers',
    route: projectPath('endpoints'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_endpoints_create_dialog',
    scenario: 'Create-endpoint dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/endpoints/CreateEndpointDialog.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-create-credential',
    group: 'overlay_drawers',
    route: projectPath('credentials'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_credentials_create_dialog',
    scenario: 'Create-credential dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/credentials/CreateCredentialDialog.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-invite-member',
    group: 'overlay_drawers',
    route: projectPath('members'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_members_invite_dialog',
    scenario: 'Invite-member dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/InviteMemberDialog.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-files-rename',
    group: 'overlay_drawers',
    route: projectPath('files'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_files_rename_dialog',
    scenario: 'Rename dialog in files.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'files-selection-details',
    group: 'overlay_drawers',
    route: projectPath('files'),
    recipeFamily: 'work_surface_immersive',
    storyId: 'project_files_selection_details',
    scenario: 'Files page with selection and details panel visible.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers('files__workspace-surface', 'files__details-shell', 'files__details-inspector'),
  }),
  single({
    id: 'dialog-files-mount-access',
    group: 'overlay_drawers',
    route: projectPath('files'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_files_mount_access_dialog',
    scenario: 'Desktop mount access dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-files-library-create',
    group: 'overlay_drawers',
    route: projectPath('files'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_files_library_create_dialog',
    scenario: 'Create library dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-files-library-delete',
    group: 'overlay_drawers',
    route: projectPath('files'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_files_library_delete_dialog',
    scenario: 'Delete non-empty library dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/files/files-page/FilesPageContent.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'members-project-groups',
    group: 'overlay_drawers',
    route: projectPath('members'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_members_groups_tab',
    scenario: 'Members page groups tab.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/MembersPage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
  }),
  single({
    id: 'members-change-history-dialog',
    group: 'overlay_drawers',
    route: projectPath('members'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_members_change_history_dialog',
    scenario: 'Change-history dialog from member detail.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/members/MembersPage.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'dialog-edit-endpoint',
    group: 'overlay_drawers',
    route: projectPath('endpoints'),
    recipeFamily: 'overlay_dialog',
    storyId: 'project_endpoints_edit_dialog',
    scenario: 'Edit-endpoint dialog.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/endpoints/endpoints-page/EndpointsToolbar.tsx'],
    capture: 'viewport',
    authLane: 'authed',
  }),
  single({
    id: 'usage-endpoint-switch',
    group: 'governance_pages',
    route: projectPath('usage'),
    recipeFamily: 'governance_table_detail',
    storyId: 'project_usage_endpoint_switch',
    scenario: 'Usage page focused on the resolved endpoint scope.',
    codeRefs: ['e2e/visual.spec.ts', 'src/components/audit-usage/UsagePage.tsx'],
    capture: 'full_page',
    authLane: 'authed',
    stableMarkers: stableMarkers(
      'usage__work-surface',
      'usage__summary-line',
      'usage__selected-endpoint',
      'usage__limits',
    ),
  }),
] as const;

function expandScenario(seed: VisualBaselineScenarioSeed): VisualBaselineCatalogEntry[] {
  const screenshotBaseName = seed.screenshotBaseName ?? seed.id;
  const base = {
    scenarioId: seed.id,
    route: seed.route,
    group: seed.group,
    recipeFamily: seed.recipeFamily,
    storyId: seed.storyId,
    scenario: seed.scenario,
    codeRefs: seed.codeRefs,
    capture: seed.capture,
    authLane: seed.authLane,
    viewport: seed.viewport ?? 'default',
    setupNotes: seed.setupNotes ?? [],
    stableMarkers: seed.stableMarkers ?? [],
    sourceSpec: 'e2e/visual.spec.ts' as const,
  };

  if (seed.themes?.length) {
    return seed.themes.map((theme) => ({
      ...base,
      id: `${seed.id}-${theme}`,
      screenshot: themedScreenshotName(screenshotBaseName, theme),
      theme,
    }));
  }

  return [{
    ...base,
    id: seed.id,
    screenshot: `${screenshotBaseName}.png`,
    theme: 'default',
  }];
}

export function listVisualBaselineCatalogEntries(): VisualBaselineCatalogEntry[] {
  return SCENARIOS.flatMap(expandScenario).sort((left, right) => left.screenshot.localeCompare(right.screenshot));
}

export function groupVisualBaselineCatalogByScenario(
  entries: readonly VisualBaselineCatalogEntry[] = listVisualBaselineCatalogEntries(),
): Map<string, VisualBaselineScenarioRecord> {
  const grouped = new Map<string, VisualBaselineScenarioRecord>();
  for (const entry of entries) {
    const existing = grouped.get(entry.scenarioId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    grouped.set(entry.scenarioId, {
      scenarioId: entry.scenarioId,
      group: entry.group,
      route: entry.route,
      recipeFamily: entry.recipeFamily,
      storyId: entry.storyId,
      scenario: entry.scenario,
      codeRefs: entry.codeRefs,
      capture: entry.capture,
      authLane: entry.authLane,
      viewport: entry.viewport,
      setupNotes: entry.setupNotes,
      stableMarkers: entry.stableMarkers,
      entries: [entry],
    });
  }
  for (const value of grouped.values()) {
    value.entries.sort((left, right) => left.screenshot.localeCompare(right.screenshot));
  }
  return grouped;
}

export function resolveVisualBaselineReviewDir(options: {
  outputRoot?: string;
  runId: string;
  scenarioId: string;
}): string {
  const root = path.resolve(options.outputRoot ?? process.env.VISUAL_BASELINE_REVIEW_ROOT ?? 'artifacts/visual-baseline-reviews');
  return path.join(root, options.runId, options.scenarioId);
}

export function renderVisualBaselineScenarioReviewMarkdown(args: {
  scenario: VisualBaselineScenarioRecord;
  build?: VisualBaselineBuildRecord;
  review: VisualBaselineReviewRecord;
}): string {
  const { scenario, build, review } = args;
  const lines = [
    `# ${scenario.scenarioId}`,
    '',
    `- route: ${scenario.route}`,
    `- recipe_family: ${scenario.recipeFamily}`,
    `- scenario_group: ${scenario.group}`,
    `- story_id: ${scenario.storyId}`,
    `- auth_lane: ${scenario.authLane}`,
    `- capture: ${scenario.capture}`,
    `- viewport: ${scenario.viewport}`,
    `- stable_markers: ${scenario.stableMarkers.length > 0 ? scenario.stableMarkers.join(', ') : '<none>'}`,
  ];
  if (build) {
    lines.push(
      `- build_lane: ${build.lane}`,
      `- build_run_id: ${build.runId}`,
      `- build_git_sha: ${build.gitSha}`,
      `- build_fingerprint: ${build.fingerprint}`,
      `- build_started_at: ${build.startedAt}`,
    );
  }
  lines.push(
    `- reviewer: ${review.reviewer}`,
    `- reviewed_at: ${review.reviewedAt}`,
    `- verdict: ${review.verdict}`,
    `- cursor_fit: ${review.cursorFit}`,
    `- ux_fit: ${review.uxFit}`,
    '',
    '## Scenario',
    '',
    scenario.scenario,
    '',
    '## Screenshots',
    '',
    ...scenario.entries.map((entry) => `- ${entry.screenshot} [${entry.theme}]`),
    '',
    '## Code References',
    '',
    ...scenario.codeRefs.map((ref) => `- ${ref}`),
    '',
    '## Notes',
    '',
    ...(review.notes.length ? review.notes.map((note) => `- ${note}`) : ['- <none>']),
  );
  if (review.blockingFindings?.length) {
    lines.push('', '## Blocking Findings', '', ...review.blockingFindings.map((item) => `- ${item}`));
  }
  return `${lines.join('\n')}\n`;
}

export function resolveVisualBaselineStableMarkers(scenarioId: string): readonly string[] {
  return SCENARIOS.find((scenario) => scenario.id === scenarioId)?.stableMarkers ?? stableMarkers();
}
