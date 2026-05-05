/**
 * Next.js Middleware
 *
 * Runs next-intl middleware for locale-from-URL (so /zh-CN/ shows Chinese),
 * plus custom route validation (e.g. invalid Agent task ID redirect).
 */

import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { routing } from '@/lib/i18n/routing';
import { validateTaskId } from '@/lib/utils/validation';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Keep technical OAuth/callback routes locale-neutral so external providers
  // can whitelist a single stable redirect URI without being rewritten by i18n.
  if (/^\/workspaces\/[^/]+\/(?:login|feishu)\/callback$/.test(pathname)) {
    return NextResponse.next();
  }

  // Custom: invalid task ID -> redirect to Agent tasks list
  // Pattern: /[locale]/workspaces/[workspace]/projects/[project]/agent-tasks/[taskId]
  const taskMatch = pathname.match(
    /\/([^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/agent-tasks\/([^/]+)/,
  );

  if (taskMatch) {
    const [, locale, workspace, project, taskId] = taskMatch;
    const validation = validateTaskId(taskId);
    if (!validation.valid) {
      const redirectUrl = new URL(
        `/${locale}/workspaces/${workspace}/projects/${project}/agent-tasks`,
        request.url,
      );
      return NextResponse.redirect(redirectUrl);
    }
  }

  // next-intl: sets request locale from URL so getRequestConfig receives it (e.g. zh-CN)
  return intlMiddleware(request);
}

// Configure which routes this middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - mockServiceWorker.js (MSW must be served without redirect)
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|mockServiceWorker\\.js|app-shell|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
