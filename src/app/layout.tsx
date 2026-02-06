import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "MBOS - Intelligent Agent Platform",
  description: "Microservices-based platform for intelligent agent management and deployment",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Derive locale from the Accept-Language header or URL path set by middleware
  const headersList = await headers();
  const locale = headersList.get('x-next-intl-locale') || 'en-US';

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
