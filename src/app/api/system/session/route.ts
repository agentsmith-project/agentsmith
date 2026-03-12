import { NextResponse } from 'next/server';
import {
  clearSystemAdminSessionCookie,
  createSystemAdminSessionCookie,
  isSystemAdminAuthenticated,
  validateSystemAdminCredentials,
} from '@/lib/system-admin/session';

export async function GET() {
  const authenticated = await isSystemAdminAuthenticated();
  return NextResponse.json({ authenticated });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { username?: string; password?: string }
    | null;

  const username = body?.username?.trim() || '';
  const password = body?.password || '';

  if (!validateSystemAdminCredentials(username, password)) {
    return NextResponse.json(
      {
        error_code: 'INVALID_SYSTEM_ADMIN_CREDENTIALS',
        error_message: 'invalid_system_admin_credentials',
      },
      { status: 401 },
    );
  }

  await createSystemAdminSessionCookie();
  return NextResponse.json({ authenticated: true });
}

export async function DELETE() {
  await clearSystemAdminSessionCookie();
  return NextResponse.json({ authenticated: false });
}
