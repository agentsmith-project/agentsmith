import { createProjectRoutePolicy } from './project-route-policy';

export const PROJECT_ROUTE_POLICY_MANIFEST = {
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agents/page.tsx': createProjectRoutePolicy({
    permissions: ['project:agent:use', 'project:agent:manage', 'project:agent:public'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx': createProjectRoutePolicy({
    permissions: ['project:audit:read'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/page.tsx': createProjectRoutePolicy({
    permissions: ['project:audit:read'],
    featureKey: 'audit',
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx': createProjectRoutePolicy({
    permissions: ['project:governance:update'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use', 'project:governance:update'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/files/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/members/page.tsx': createProjectRoutePolicy({
    permissions: ['project:membership:update'],
    featureKey: 'members',
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/tasks/[taskId]/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx': createProjectRoutePolicy({
    permissions: [
      'project:endpoint:use',
      'project:agent:use',
      'project:agent:manage',
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx': createProjectRoutePolicy({
    permissions: ['project:governance:update'],
    featureKey: 'resource_policy',
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx': createProjectRoutePolicy({
    permissions: [
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    featureKey: 'usage',
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
  }),
} as const;
