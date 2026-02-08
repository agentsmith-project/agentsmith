/**
 * Next.js Middleware
 *
 * Runs next-intl middleware for locale-from-URL (so /zh-CN/ shows Chinese),
 * plus custom route validation (e.g. invalid recipe ID redirect).
 */

import createMiddleware from 'next-intl/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { routing } from '@/lib/i18n/routing';
import { validateRecipeId } from '@/lib/utils/validation';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Custom: invalid recipe ID -> redirect to studio list
  // Pattern: /[locale]/workspaces/[workspace]/projects/[project]/studio/recipes/[recipeId]
  const recipeMatch = pathname.match(
    /\/([^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/studio\/recipes\/([^/]+)/,
  );

  if (recipeMatch) {
    const [, locale, workspace, project, recipeId] = recipeMatch;
    const validation = validateRecipeId(recipeId);
    if (!validation.valid) {
      const redirectUrl = new URL(
        `/${locale}/workspaces/${workspace}/projects/${project}/studio`,
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
