/**
 * Next.js Middleware
 *
 * Runs next-intl middleware for locale-from-URL (so /zh-CN/ shows Chinese),
 * plus custom route validation (e.g. invalid task ID redirect).
 */

import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { routing } from '@/lib/i18n/routing';
import { validateTaskId } from '@/lib/utils/validation';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // WP-03: Legacy route redirects for navigation restructure
  // Pattern: /[locale]/workspaces/[workspace]/projects/[project]/{legacy-route}
  const legacyRouteMatch = pathname.match(
    /\/([^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/(runtime-control-plane|runtime-observability|release-ops|alerts)/,
  );

  if (legacyRouteMatch) {
    const [, locale, workspace, project, legacyRoute] = legacyRouteMatch;
    let redirectPath = `/${locale}/workspaces/${workspace}/projects/${project}/runtime-console`;

    // Map legacy routes to new routes with appropriate tab parameters
    const tabMapping: Record<string, string> = {
      'runtime-observability': 'monitoring',
      'release-ops': 'control',
      'alerts': 'alerts',
    };

    const tab = tabMapping[legacyRoute];
    if (tab) {
      const url = new URL(request.url);
      url.searchParams.set('tab', tab);
      redirectPath = `${redirectPath}?tab=${tab}`;
    }

    const redirectUrl = new URL(redirectPath, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // Custom: invalid task ID -> redirect to notebook list
  // Pattern: /[locale]/workspaces/[workspace]/projects/[project]/notebook/tasks/[taskId]
  const taskMatch = pathname.match(
    /\/([^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/notebook\/tasks\/([^/]+)/,
  );

  if (taskMatch) {
    const [, locale, workspace, project, taskId] = taskMatch;
    const validation = validateTaskId(taskId);
    if (!validation.valid) {
      const redirectUrl = new URL(
        `/${locale}/workspaces/${workspace}/projects/${project}/notebook`,
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
