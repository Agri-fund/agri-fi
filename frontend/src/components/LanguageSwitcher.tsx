"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

const languages = [
  { code: "en", name: "English" },
  { code: "sw", name: "Swahili" },
  { code: "fr", name: "Français" },
  { code: "pt", name: "Português" },
];

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("locale");
      if (stored) setLocale(stored);
    } catch {
      // ignore
    }
  }, []);

  const switchLocale = (newLocale: string) => {
    setLocale(newLocale);
    try {
      localStorage.setItem("locale", newLocale);
    } catch {
      // ignore
    }

    startTransition(() => {
      router.replace(pathname);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <select
        value={locale}
        onChange={(e) => switchLocale(e.target.value)}
        disabled={isPending}
        className="bg-white border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
        </div>
      )}
    </div>
  );
}
