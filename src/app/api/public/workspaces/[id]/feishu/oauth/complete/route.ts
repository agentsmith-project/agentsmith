import { NextResponse } from 'next/server';
import { getPublicApiBaseUrl } from '@/lib/public-runtime-config';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.text();
  const backendBase = getPublicApiBaseUrl().replace(/\/api\/v1$/i, '');
  const response = await fetch(
    `${backendBase}/api/public/workspaces/${encodeURIComponent(id)}/feishu/oauth/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    },
  );
  const payload = await response.text();

  return new NextResponse(payload, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    },
  });
}
