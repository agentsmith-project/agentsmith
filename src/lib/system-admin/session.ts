import 'server-only';

import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSystemAdminPassword, getSystemAdminUsername } from './config';

export const SYSTEM_ADMIN_SESSION_COOKIE = 'agentsmith-system-admin';

function getSessionSignature(): string {
  return createHash('sha256')
    .update(`${getSystemAdminUsername()}:${getSystemAdminPassword()}`)
    .digest('hex');
}

export function validateSystemAdminCredentials(username: string, password: string): boolean {
  return username === getSystemAdminUsername() && password === getSystemAdminPassword();
}

export async function isSystemAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SYSTEM_ADMIN_SESSION_COOKIE)?.value;
  return value === getSessionSignature();
}

export async function requireSystemAdmin(locale: string): Promise<void> {
  const authenticated = await isSystemAdminAuthenticated();
  if (!authenticated) {
    redirect(`/${locale}/system/login`);
  }
}

export async function createSystemAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SYSTEM_ADMIN_SESSION_COOKIE, getSessionSignature(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSystemAdminSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SYSTEM_ADMIN_SESSION_COOKIE);
}
