const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin();

// Validate BACKEND_URL in production
if (!process.env.BACKEND_URL && process.env.NODE_ENV === 'production') {
  throw new Error(
    'BACKEND_URL environment variable is required in production. ' +
    'Please set BACKEND_URL to your backend API endpoint.'
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  },
};

module.exports = withNextIntl(nextConfig);
