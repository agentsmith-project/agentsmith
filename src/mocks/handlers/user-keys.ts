import { http, HttpResponse } from 'msw';
import p0 from '../fixtures/p0.json';

const userKeys = [...((p0 as any).user_keys ?? [])];

export const userKeyHandlers = [
  http.get('/api/v1/user/keys', () =>
    HttpResponse.json({ items: userKeys, total: userKeys.length }),
  ),
  http.post('/api/v1/user/keys', async ({ request }) => {
    const body: any = await request.json().catch(() => ({}));
    const fullKey = `mbos_${Math.random().toString(36).slice(2, 34)}`;
    const created = {
      id: `ukey_${Date.now()}`,
      user_id: 'u_1',
      prefix: fullKey.slice(0, 10),
      note: body.note ?? 'New API Key',
      status: 'active',
      created_at: new Date().toISOString(),
      expires_at: body.expires_at,
      full_key: fullKey,
    };
    userKeys.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.delete('/api/v1/user/keys/:id', ({ params }) => {
    const idx = userKeys.findIndex((k) => k.id === params.id);
    if (idx >= 0) userKeys.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
];
