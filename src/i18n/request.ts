/**
 * next-intl request configuration (App Router)
 *
 * Single source of truth for locale and messages per request.
 * Used by the next-intl plugin; locale is set by middleware (header) or
 * setRequestLocale(locale) in [locale] layout.
 *
 * @see https://next-intl.dev/docs/getting-started/app-router
 * @see https://next-intl.dev/docs/usage/configuration
 */

import { getRequestConfig } from 'next-intl/server';
import { routing } from '@/lib/i18n/routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
