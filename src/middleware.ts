/**
 * Next.js Middleware
 *
 * Handles route validation, redirects, and request preprocessing.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateRecipeId } from '@/lib/utils/validation';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if this is a recipe detail route
  // Pattern: /[locale]/workspaces/[workspace]/projects/[project]/workbench/recipes/[recipeId]
  const recipeMatch = pathname.match(
    /\/(?:[^/]+)\/workspaces\/([^/]+)\/projects\/([^/]+)\/workbench\/recipes\/([^/]+)/,
  );

  if (recipeMatch) {
    const [, workspace, project, recipeId] = recipeMatch;

    // Validate recipe ID format
    const validation = validateRecipeId(recipeId);
    if (!validation.valid) {
      // Extract locale from pathname
      const localeMatch = pathname.match(/^\/([^/]+)/);
      const locale = localeMatch ? localeMatch[1] : 'en-US';

      // Redirect to workbench list if recipe ID is invalid
      const redirectUrl = new URL(
        `/${locale}/workspaces/${workspace}/projects/${project}/workbench`,
        request.url,
      );
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Continue with the request
  return NextResponse.next();
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
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
