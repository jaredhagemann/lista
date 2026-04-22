import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import { AppNameContext } from "@/context/app-name-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const tenant = getTenantFromHeaders(await headers());
  const appName = tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? "Lista") : "Lista";
  return {
    title: { template: `%s | ${appName}`, default: appName },
    description: "Zero-cost, ad-free team management. Scheduling, notifications, and roster management.",
    manifest: "/manifest.json",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = getTenantFromHeaders(await headers());

  const appName = tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? "Lista") : "Lista";

  const brandVars = tenant?.isWhiteLabel
    ? ({
        "--brand-primary": tenant.brandColor ?? "#000000",
        "--brand-secondary": tenant.brandColorSecondary ?? "#666666",
      } as React.CSSProperties)
    : {};

  return (
    <html lang="en" style={brandVars}>
      <head>
        {tenant?.isWhiteLabel && tenant.faviconUrl && (
          <link rel="icon" href={tenant.faviconUrl} />
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppNameContext value={appName}>
          {children}
        </AppNameContext>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js');
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
