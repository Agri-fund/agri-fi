import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/**/__tests__/**/*.{js,jsx,ts,tsx}",
      "src/**/*.{test,spec}.{js,jsx,ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx,ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/app/layout.tsx", "src/app/globals.css"],
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});