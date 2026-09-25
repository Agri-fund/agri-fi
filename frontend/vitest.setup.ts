import "@testing-library/jest-dom";
import { vi } from "vitest";

// Keep the existing test suite source-compatible while it moves to Vitest.
Object.assign(globalThis, { jest: vi });

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
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
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({
    number: (value: number) => String(value),
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

const localStorageValues = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageValues.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => localStorageValues.set(key, value)),
  removeItem: vi.fn((key: string) => localStorageValues.delete(key)),
  clear: vi.fn(() => localStorageValues.clear()),
};
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

try {
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: vi.fn() },
    writable: true,
  });
} catch {
  // Location property is already mocked in test environment
}

global.fetch = vi.fn();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
}));