import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MBOS - Intelligent Agent Platform",
  description: "Microservices-based platform for intelligent agent management and deployment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
