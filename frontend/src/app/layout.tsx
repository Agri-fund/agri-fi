import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { PWAInstallBanner } from "@/components/PWAInstallBanner";

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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
            <PWAInstallBanner />
            <div className="pointer-events-none fixed right-4 top-4 z-[90] sm:right-6 sm:top-6">
              <div className="pointer-events-auto">
                <ThemeToggle />
              </div>
            </div>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
