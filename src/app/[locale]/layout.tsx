import { notFound } from 'next/navigation';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { MSWProvider } from '@/components/providers/MSWProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';
import { ToastContainer } from '@/components/ui/toast';
import { type Locale } from '@/lib/i18n/config';
import { routing } from '@/lib/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  // Set request-scoped locale so getRequestConfig / getMessages() use it.
  // Required for correct language; works with middleware (header) and static rendering.
  setRequestLocale(locale);

  let messages;
  try {
    messages = await getMessages();
  } catch {
    messages = {};
  }

  // NOTE: No <html> or <body> tags here - they are in the root layout
  return (
    <AuthProvider>
      <MSWProvider>
        <RealtimeProvider mode="disabled">
          <QueryProvider>
            <NextIntlClientProvider locale={locale} messages={messages}>
              {children}
            </NextIntlClientProvider>
            <ToastContainer />
          </QueryProvider>
        </RealtimeProvider>
      </MSWProvider>
    </AuthProvider>
  );
}
