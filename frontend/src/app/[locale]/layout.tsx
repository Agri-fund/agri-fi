import type { Metadata } from "next";
import "../globals.css";
import * as Sentry from "@sentry/nextjs";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

export const metadata: Metadata = {
  title: "AgriFi — Agricultural Finance Platform",
  description: "Fund farming projects, earn returns, and buy produce on-chain.",
};

export default async function RootLayout({
  children,
  params: { locale }
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Sentry.ErrorBoundary
            fallback={({ error, resetError }) => (
              <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-gray-100">
                  <div className="bg-red-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-5">
                    <svg
                      className="w-8 h-8 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-3">
                    Something went wrong
                  </h2>
                  <p className="text-gray-600 mb-8 text-sm">
                    We encountered an unexpected error. Our team has been notified.
                  </p>
                  <button
                    onClick={resetError}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors w-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    autoFocus
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
            showDialog
          >
            <ToastProvider>
              {children}
            </ToastProvider>
          </Sentry.ErrorBoundary>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
