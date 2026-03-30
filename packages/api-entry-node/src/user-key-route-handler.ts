import type http from 'node:http';
import type { JsonDocStorePort } from '@mbos/ports';
import type { AuthenticatedUser } from './auth.js';
import { readBody } from './http-utils.js';
import {
  createUserApiKey,
  listUserApiKeys,
  revokeUserApiKey,
  type UserApiKeyRecord,
} from './user-api-key-store.js';

type JsonFn = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

type HandlerArgs = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  requestUrl: URL;
  user: AuthenticatedUser;
  docStore: JsonDocStorePort;
  json: JsonFn;
};

function presentUserApiKey(record: UserApiKeyRecord): Omit<UserApiKeyRecord, 'key_hash' | 'user_email' | 'user_name'> {
  const { key_hash: _keyHash, user_email: _email, user_name: _name, ...rest } = record;
  return rest;
}

export async function handleUserKeyRoute({
  req,
  res,
  method,
  requestUrl,
  user,
  docStore,
  json,
}: HandlerArgs): Promise<boolean> {
  if (requestUrl.pathname === '/api/v1/user/keys') {
    if (method === 'GET') {
      const items = (await listUserApiKeys(docStore, user.id)).map(presentUserApiKey);
      json(res, 200, { items, total: items.length });
      return true;
    }

    if (method === 'POST') {
      const body = (await readBody(req)) as { note?: unknown; expires_in?: unknown } | null;
      const note = typeof body?.note === 'string' ? body.note.trim() : undefined;
      const expiresIn = typeof body?.expires_in === 'number' ? body.expires_in : undefined;
      const created = await createUserApiKey({
        docStore,
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        note,
        expiresInDays: expiresIn,
      });
      json(res, 201, {
        ...presentUserApiKey(created.record),
        key: created.key,
      });
      return true;
    }

    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  const itemMatch = requestUrl.pathname.match(/^\/api\/v1\/user\/keys\/([^/]+)\/?$/);
  if (!itemMatch) {
    return false;
  }

  if (method === 'DELETE') {
    const deleted = await revokeUserApiKey({
      docStore,
      userId: user.id,
      keyId: decodeURIComponent(itemMatch[1] ?? ''),
    });
    if (!deleted) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'user_key_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
  return true;
}
