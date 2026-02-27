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
    const notifications = [
      {
        id: 'notif_dup_1',
        rule_id: 'rule_requests',
        rule_name: 'High Requests',
        status: 'firing',
        triggered_at: '2026-02-27T10:00:00.000Z',
        metric: 'requests_per_hour',
        operator: 'gte',
        threshold: 1000,
        actual_value: 1400,
        context: {
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          resource_name: 'OpenAI Main',
        },
        delivery: {
          in_app_sent: true,
          webhook_sent: true,
          webhook_status: 200,
        },
      },
      {
        id: 'notif_dup_2',
        rule_id: 'rule_requests',
        rule_name: 'High Requests',
        status: 'firing',
        triggered_at: '2026-02-27T10:02:00.000Z',
        metric: 'requests_per_hour',
        operator: 'gte',
        threshold: 1000,
        actual_value: 1450,
        context: {
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          resource_name: 'OpenAI Main',
        },
        delivery: {
          in_app_sent: true,
          webhook_sent: true,
          webhook_status: 200,
        },
      },
      {
        id: 'notif_resolved_1',
        rule_id: 'rule_errors',
        rule_name: 'Error Rate',
        status: 'resolved',
        triggered_at: '2026-02-27T09:00:00.000Z',
        resolved_at: '2026-02-27T09:10:00.000Z',
        metric: 'error_rate',
        operator: 'gte',
        threshold: 5,
        actual_value: 2,
        context: {
          resource_type: 'endpoint',
          resource_id: 'ep_1',
          resource_name: 'OpenAI Main',
        },
        delivery: {
          in_app_sent: true,
          webhook_sent: false,
          webhook_status: 500,
          webhook_error: 'timeout',
        },
      },
    ];
    return HttpResponse.json({
      items: notifications,
      total: notifications.length,
      unread_count: notifications.filter((a) => a.status === 'firing').length,
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
  http.put('/api/v1/workspaces/:ws/projects/:prj/alert-rules/:ruleId', async ({ request, params }) => {
    const data = await request.json() as Record<string, unknown>;
    return HttpResponse.json({
      id: params.ruleId,
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
