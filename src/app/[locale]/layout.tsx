import { notFound } from "next/navigation";
import type { AbstractIntlMessages } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { AppRootProviders } from "@/components/providers/AppRootProviders";
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

  let messages: AbstractIntlMessages;
  try {
    messages = await getMessages();
  } catch {
    messages = {};
  }

  return (
    <AppRootProviders locale={locale} messages={messages}>
      {children}
    </AppRootProviders>
  );
}
