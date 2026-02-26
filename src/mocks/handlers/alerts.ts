import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const alertsHandlers = [
  // Get alert rules
  http.get('/api/v1/workspaces/:ws/projects/:prj/alert-rules', () => {
    return HttpResponse.json({
      items: p0.alert_rules,
      total: p0.alert_rules?.length ?? 0,
      page: 1,
      page_size: 25,
      has_more: false,
    });
  }),

  // Get alert notifications
  http.get('/api/v1/workspaces/:ws/projects/:prj/alert-notifications', () => {
    return HttpResponse.json({
      items: p0.alert_notifications,
      total: p0.alert_notifications?.length ?? 0,
      unread_count: p0.alert_notifications?.filter((a: any) => a.status === 'unread').length ?? 0,
      page: 1,
      page_size: 25,
      has_more: false,
    });
  }),

  // Get dashboard KPI
  http.get('/api/v1/workspaces/:ws/projects/:prj/dashboard/kpi', () => {
    return HttpResponse.json(p0.dashboard_kpi);
  }),

  // Get dashboard trend
  http.get('/api/v1/workspaces/:ws/projects/:prj/dashboard/trend', () => {
    return HttpResponse.json({
      data: p0.dashboard_trend,
    });
  }),

  // Get top resources
  http.get('/api/v1/workspaces/:ws/projects/:prj/dashboard/top-resources', () => {
    return HttpResponse.json({
      items: p0.top_resources,
    });
  }),

  // Get top users
  http.get('/api/v1/workspaces/:ws/projects/:prj/dashboard/top-users', () => {
    return HttpResponse.json({
      items: p0.top_users,
    });
  }),

  // Get anomalies
  http.get('/api/v1/workspaces/:ws/projects/:prj/dashboard/anomalies', () => {
    return HttpResponse.json({
      items: p0.anomalies,
    });
  }),

  // Create alert rule (stub)
  http.post('/api/v1/workspaces/:ws/projects/:prj/alert-rules', async ({ request }) => {
    const data = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      ...data,
      id: `rule_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { status: 201 });
  }),

  // Update alert rule (stub)
  http.patch('/api/v1/workspaces/:ws/projects/:prj/alert-rules/:id', async ({ request }) => {
    const data = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      ...data,
      updated_at: new Date().toISOString(),
    });
  }),

  // Delete alert rule (stub)
  http.delete('/api/v1/workspaces/:ws/projects/:prj/alert-rules/:id', () => {
    return HttpResponse.json({ success: true });
  }),

  // Test alert rule (stub)
  http.post('/api/v1/workspaces/:ws/projects/:prj/alert-rules/:id/test', () => {
    return HttpResponse.json({
      would_trigger: false,
      actual_value: 500,
      details: 'Test completed successfully',
    });
  }),
];
