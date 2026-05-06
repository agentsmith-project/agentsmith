import type { ChatRoute } from '../chat-route-match.js';
import type { ProjectsRoute } from '../projects-route-match.js';

export function isChatRoute(route: { kind: string }): route is ChatRoute {
  return route.kind.startsWith('chat');
}

export function isAgentRoute(route: { kind: string }): boolean {
  return route.kind === 'agents'
    || route.kind === 'agentItem'
    || route.kind === 'agentDiagnostics'
    || route.kind === 'agentExecutionConfig'
    || route.kind === 'agentConnectionInfo'
    || route.kind === 'agentTestConnection'
    || route.kind === 'agentTestTaskRuns'
    || route.kind === 'agentKeys'
    || route.kind === 'agentKeyItem';
}

export function isTaskRoute(route: { kind: string }): boolean {
  return route.kind === 'tasks'
    || route.kind === 'taskItem'
    || route.kind === 'taskWorkspaceAccess'
    || route.kind === 'taskInputs'
    || route.kind === 'taskInputItem'
    || route.kind === 'taskMessages'
    || route.kind === 'taskActivity'
    || route.kind === 'taskRunnerBindingOptions'
    || route.kind === 'taskRuns'
    || route.kind === 'taskCancelRun'
    || route.kind === 'taskTraces'
    || route.kind === 'taskArtifacts'
    || route.kind === 'taskArtifactDownload'
    || route.kind === 'taskEvents'
    || route.kind === 'taskTerminalSessions'
    || route.kind === 'taskTerminalSession';
}

export function routeHasProjectScope(route: ProjectsRoute): route is ProjectsRoute & { workspaceId: string; projectId: string } {
  return 'workspaceId' in route
    && typeof route.workspaceId === 'string'
    && 'projectId' in route
    && typeof route.projectId === 'string';
}
