const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  trailingSlash: true,
  images: {
    // Issue #266 — serve trader-uploaded cover photos as optimized/cached
    // webp instead of shipping the original high-resolution upload.
    formats: ['image/webp'],
    remotePatterns: [
      // S3 bucket that document/photo uploads are stored in (any region).
      { protocol: 'https', hostname: '*.s3.*.amazonaws.com' },
      // IPFS gateways used for on-chain document/photo hashes (see
      // IPFS_GATEWAYS in backend/.env.example).
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'cloudflare-ipfs.com' },
      { protocol: 'https', hostname: 'gateway.pinata.cloud' },
      { protocol: 'https', hostname: 'dweb.link' },
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
  },
  // react-pdf (pdfjs-dist) ships a canvas dependency that is only needed in
  // Node.js environments; in the browser the browser's native Canvas API is
  // used instead. Mark both as external so Next.js doesn't try to bundle them.
  webpack: (config) => {
    config.externals = [
      ...(config.externals || []),
      { canvas: 'canvas' },
    ];
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

const withIntl = withNextIntl(nextConfig);

module.exports = withSentryConfig(withIntl, {
  // Sentry organisation and project (set in CI / Vercel env vars)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for source map uploads — set SENTRY_AUTH_TOKEN in CI
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps only during production builds
  silent: true,
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements in production
  disableLogger: true,

  // Widen the tunnel route to avoid ad-blocker interference
  tunnelRoute: '/monitoring',

  // Automatically instrument Next.js data fetching methods
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
  autoInstrumentAppDirectory: true,
});
