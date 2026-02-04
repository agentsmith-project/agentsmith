import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const userdataHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/userdata/summary', () => HttpResponse.json(p0.userdata_summary)),
  http.get('/api/v1/workspaces/:ws/projects/:prj/userdata/end-users', () => HttpResponse.json({ items: p0.userdata_end_users })),
];
