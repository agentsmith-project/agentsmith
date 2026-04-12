import { notFound } from "next/navigation";
import { getMessages, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { MSWProvider } from "@/components/providers/MSWProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { SessionRecoveryProvider } from "@/components/providers/SessionRecoveryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ToastContainer } from "@/components/ui/toast";
import { type Locale } from "@/lib/i18n/config";
import { routing } from "@/lib/i18n/routing";

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

  setRequestLocale(locale);

  let messages;
  try {
    messages = await getMessages();
  } catch {
    messages = {};
  }

  return (
    <AuthProvider>
      <MSWProvider>
        <RealtimeProvider mode="disabled">
          <QueryProvider>
            <SessionRecoveryProvider>
              <NextIntlClientProvider locale={locale} messages={messages}>
                <ThemeProvider>
                  <div data-testid="page-layout" className="h-full">
                    {children}
                  </div>
                  <ToastContainer />
                </ThemeProvider>
              </NextIntlClientProvider>
            </SessionRecoveryProvider>
          </QueryProvider>
        </RealtimeProvider>
      </MSWProvider>
    </AuthProvider>
  );
}
