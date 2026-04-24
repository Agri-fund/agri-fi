"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("home");

  return (
    <main className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="text-4xl font-bold text-green-800 mb-4">{t("title")}</h1>
        <p className="text-lg text-green-600 mb-8">{t("subtitle")}</p>

        <div className="space-y-4">
          <p className="text-gray-600">{t("description")}</p>

          <div className="flex justify-center space-x-4">
            <Link
              href="/marketplace"
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-md font-medium transition-colors"
            >
              {t("viewMarketplace")}
            </Link>
          </div>

          <div className="mt-8 text-sm text-gray-500">
            <p>{t("instructions.title")}</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>{t("instructions.installWallet")}</li>
              <li>{t("instructions.switchTestnet")}</li>
              <li>{t("instructions.connectWallet")}</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
