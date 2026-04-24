import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import "./globals.css";
import { WalletButton } from "../components/WalletButton";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export const metadata: Metadata = {
  title: "Agric-onchain Finance",
  description: "Blockchain-backed agricultural trade finance platform",
};

export default async function RootLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // Ensure that the incoming `locale` is valid
  if (!["en", "sw", "fr", "pt"].includes(locale)) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <nav className="bg-white shadow-sm border-b">
            <div className="container mx-auto px-4">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center">
                  <h1 className="text-xl font-bold text-green-800">
                    Agric-onchain Finance
                  </h1>
                </div>
                <div className="flex items-center space-x-4">
                  <LanguageSwitcher />
                  <WalletButton />
                </div>
              </div>
            </div>
          </nav>
          <main>{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
