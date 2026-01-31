/**
 * next-intl configuration
 *
 * This file is required by next-intl for server-side message loading.
 * See: https://next-intl.dev/docs/getting-started/app-router
 */

import { getRequestConfig } from 'next-intl/server';
import { routing } from './src/lib/i18n/routing';

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  let locale = await requestLocale;

  // Ensure that a valid locale is used
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
