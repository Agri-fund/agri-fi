import "@testing-library/jest-dom";

// Mock Next.js router
jest.mock("next/navigation", () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return "/";
  },
}));

// Mock next-intl so components using useTranslations/useLocale work without a provider
jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({
    number: (v: number) => String(v),
    dateTime: (v: Date) => v.toISOString(),
  }),
}));

// In-memory localStorage mock (supports setItem/getItem and jest overrides)
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((key: string) => localStorageStore[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: jest.fn(() => {
    Object.keys(localStorageStore).forEach((key) => delete localStorageStore[key]);
  }),
};
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Make window.location.reload mockable (jsdom marks it read-only)
try {
  Object.defineProperty(window.location, "reload", {
    configurable: true,
    value: jest.fn(),
  });
} catch {
  // Some jsdom versions expose location.reload as non-configurable
}

// Mock fetch
global.fetch = jest.fn();

// Mock Freighter API
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  signTransaction: jest.fn(),
}));
