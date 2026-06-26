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

// Mock localStorage with jest.fn() so tests can call .mockReturnValue etc.
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Make window.location.reload mockable (jsdom marks it read-only)
try {
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: jest.fn() },
    writable: true,
  });
} catch {
  // Location property is already mocked in test environment
}

// Mock fetch
global.fetch = jest.fn();

// Mock Freighter API
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  signTransaction: jest.fn(),
}));
