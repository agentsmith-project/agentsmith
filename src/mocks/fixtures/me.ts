import type { UserProfile, UserNotification } from '@/lib/api/endpoints/me';

// Mutable for MSW handlers (PATCH updates in place)
export const userProfileFixture: UserProfile = {
  display_name: null,
  timezone: 'America/New_York',
  locale: 'en-US',
  bio: null,
  job_title: null,
  company: null,
  interests: null,
  greeting_preference: 'friendly',
  preferences_json: null,
};

export const userNotificationFixtures: UserNotification[] = [
  {
    id: 'release_escalation_runtime-evidence-gate-regression-20260227',
    type: 'release_escalation',
    title: 'Release gate blocked',
    body: 'Latest release gate is blocked by 4 issues.',
    link_url: null,
    read_at: null,
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'notif_001',
    type: 'system',
    title: 'Welcome to MBOS',
    body: 'Get started by creating your first project or exploring the Chat.',
    link_url: '/workspaces/ws_default/projects',
    read_at: null,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'notif_002',
    type: 'mention',
    title: 'New join request',
    body: 'Alice requested to join Project Alpha.',
    link_url: '/workspaces/ws_default/projects/proj_001/members',
    read_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 7200000).toISOString(),
  },
];
