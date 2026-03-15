import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

export const AUTH_USER_FIXTURE = {
  id: 'user_001',
  email: 'test@example.com',
  name: 'test',
};

export const authHandlers = [
  http.post('/api/v1/auth/login', () => HttpResponse.json({
    access_token: p0.auth.access_token,
    refresh_token: p0.auth.refresh_token,
    expires_in: p0.auth.expires_in,
    user: AUTH_USER_FIXTURE,
    workspaces: p0.workspaces,
  })),
  http.post('/api/v1/auth/refresh', () => HttpResponse.json({
    access_token: p0.auth.access_token,
    expires_in: p0.auth.expires_in,
  })),
];
