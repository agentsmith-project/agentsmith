import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { MSWProvider } from '@/components/providers/MSWProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { ToastContainer } from '@/components/ui/toast';
import { type Locale } from '@/lib/i18n/config';

const locales: Locale[] = ['zh-CN', 'en-US'];

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Using next-intl for messages
  let messages;
  try {
    messages = await getMessages();
  } catch {
    // Fallback for initial build
    messages = {};
  }

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <AuthProvider>
          <MSWProvider>
            <QueryProvider>
              <NextIntlClientProvider locale={locale} messages={messages}>
                {children}
              </NextIntlClientProvider>
              <ToastContainer />
            </QueryProvider>
          </MSWProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
