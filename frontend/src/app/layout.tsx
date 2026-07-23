import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/ui/ToastProvider";

export const metadata: Metadata = {
  title: "AgriFi — Agricultural Finance Platform",
  description: "Fund farming projects, earn returns, and buy produce on-chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ToastProvider>
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
