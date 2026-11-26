import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";
import { BehavioralBiometricsProvider } from "@/components/behavioral/BehavioralBiometricsProvider";
import { SupportChatWidget } from "@/components/support/SupportChatWidget";

export const metadata: Metadata = {
  title: "AgriFi — Agricultural Finance Platform",
  description: "Fund farming projects, earn returns, and buy produce on-chain.",
  manifest: "/manifest.json",
  viewport:
    "width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AgriFi",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon-192.png",
    apple: ["/icon-192.png", { url: "/icon-512.png", sizes: "512x512" }],
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "AgriFi",
    "mobile-web-app-capable": "yes",
    "theme-color": "#1f2937",
    "msapplication-TileColor": "#1f2937",
    "msapplication-config": "/browserconfig.xml",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supportChatEnabled =
    (
      process.env.SUPPORT_CHAT_ENABLED ??
      process.env.NEXT_PUBLIC_SUPPORT_CHAT_ENABLED ??
      "true"
    )
      .trim()
      .toLowerCase() !== "false";
  const supportChatProvider = (
    process.env.SUPPORT_CHAT_PROVIDER ??
    process.env.NEXT_PUBLIC_SUPPORT_CHAT_PROVIDER ??
    "crisp"
  )
    .trim()
    .toLowerCase();
  const supportChatWebsiteId =
    process.env.SUPPORT_CHAT_WEBSITE_ID ??
    process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ??
    process.env.NEXT_PUBLIC_INTERCOM_APP_ID ??
    "";

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* #1170 — restores the persisted appearance preferences (accent
            palette, font scale, contrast) before the first paint. */}
        <Script src="/theme-bootstrap.js" strategy="beforeInteractive" />
        {/* PWA: Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js', { scope: '/' })
                  .then(reg => console.log('Service Worker registered:', reg))
                  .catch(err => console.error('Service Worker registration failed:', err));
              }
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>
            <BehavioralBiometricsProvider>
              <PWAInstallBanner />
              <div className="pointer-events-none fixed right-4 top-4 z-[90] sm:right-6 sm:top-6">
                <div className="pointer-events-auto">
                  <ThemeToggle />
                </div>
              </div>
              {children}
              <SupportChatWidget
                enabled={supportChatEnabled}
                provider={supportChatProvider}
                websiteId={supportChatWebsiteId}
              />
            </BehavioralBiometricsProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
