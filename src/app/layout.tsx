import type { Metadata } from "next";
import { headers } from "next/headers";
import { appFontVariables } from "@/app/fonts";
import { getThemeBootstrapScript, DEFAULT_THEME } from "@/lib/theme";
import { readPublicRuntimeConfigFromEnv, serializePublicRuntimeConfigScript } from "@/lib/public-runtime-config";
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
  const headersList = await headers();
  const locale = headersList.get("x-next-intl-locale") || "en-US";
  const runtimeConfig = readPublicRuntimeConfigFromEnv();

  return (
    <html
      lang={locale}
      className={appFontVariables}
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <script
          id="mbos-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: getThemeBootstrapScript() }}
        />
        <script
          id="mbos-public-runtime-config"
          dangerouslySetInnerHTML={{ __html: serializePublicRuntimeConfigScript(runtimeConfig) }}
        />
        {children}
      </body>
    </html>
  );
}
