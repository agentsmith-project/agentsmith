/**
 * next-intl routing configuration
 *
 * Defines supported locales and default locale for the app.
 */

import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ['zh-CN', 'en-US'],

  // Used when no locale matches
  defaultLocale: 'en-US',
});

// Lightweight wrappers around Next.js' navigation APIs
// that will consider the routing configuration
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
