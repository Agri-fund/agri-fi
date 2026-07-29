import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — AgriFi',
  description:
    'Learn how AgriFi collects, uses, and protects your personal data on the tokenised agricultural finance platform.',
};

export default function PrivacyPolicyPage() {
  const lastUpdated = 'July 2026';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="text-brand-600 font-semibold text-sm hover:text-brand-700 transition-colors flex items-center gap-1"
          >
            ← Back to AgriFi
          </Link>
          <Link
            href="/terms"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Terms of Service
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        {/* Page heading */}
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
            Privacy Policy
          </h1>
          <p className="text-sm text-gray-500">Last updated: {lastUpdated}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-12 space-y-10 text-gray-700 leading-relaxed">

          {/* 1. Overview */}
          <section aria-labelledby="pp-overview">
            <h2 id="pp-overview" className="text-xl font-bold text-gray-900 mb-3">
              1. Overview
            </h2>
            <p>
              AgriFi (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is committed
              to protecting your personal information. This Privacy Policy explains how we
              collect, use, disclose, and safeguard your data when you use the AgriFi platform.
              Please read this policy carefully. By using the Platform, you consent to the
              practices described here.
            </p>
          </section>

          {/* 2. Information We Collect */}
          <section aria-labelledby="pp-collect">
            <h2 id="pp-collect" className="text-xl font-bold text-gray-900 mb-3">
              2. Information We Collect
            </h2>
            <p className="mb-4 font-semibold text-gray-800">2.1 Information You Provide</p>
            <ul className="list-disc list-inside space-y-2 mb-6">
              <li>
                <strong>Account information</strong> — name, email address, role (farmer,
                trader, or investor), and password hash.
              </li>
              <li>
                <strong>KYC documents</strong> — government-issued ID, proof of address, and
                (for corporate accounts) company registration documents. These are stored
                encrypted and uploaded to IPFS with a Stellar memo anchor.
              </li>
              <li>
                <strong>Wallet address</strong> — your Stellar public key, which you link
                voluntarily. We never have access to your private key.
              </li>
              <li>
                <strong>Trade deal data</strong> — commodity type, quantity, value, delivery
                date, and supporting documents you upload.
              </li>
              <li>
                <strong>Shipment milestones</strong> — checkpoint records (Farm, Warehouse,
                Port, Importer) including optional GPS coordinates.
              </li>
              <li>
                <strong>Push notification subscription</strong> — browser push endpoint and
                encryption keys, stored only if you grant notification permission.
              </li>
            </ul>
            <p className="mb-4 font-semibold text-gray-800">2.2 Information Collected Automatically</p>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Usage data</strong> — pages visited, features used, and interaction
                timestamps, collected via server logs and Sentry error monitoring.
              </li>
              <li>
                <strong>Device data</strong> — IP address, browser type, operating system, and
                approximate geolocation derived from IP.
              </li>
              <li>
                <strong>Blockchain data</strong> — all Stellar transactions linked to your
                wallet address are publicly visible on the Stellar network; we do not control
                the Stellar ledger.
              </li>
            </ul>
          </section>

          {/* 3. How We Use Your Information */}
          <section aria-labelledby="pp-use">
            <h2 id="pp-use" className="text-xl font-bold text-gray-900 mb-3">
              3. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside space-y-2">
              <li>To create and manage your account and verify your identity via KYC.</li>
              <li>
                To process trade deal creation, token issuance, investments, and escrow
                releases on the Stellar blockchain.
              </li>
              <li>
                To deliver push notifications about deal milestones, escrow status changes,
                and investment updates (only with your permission).
              </li>
              <li>
                To detect and prevent fraud, money laundering, and other prohibited
                activities.
              </li>
              <li>
                To improve the Platform, debug issues, and analyse usage patterns to optimise
                performance.
              </li>
              <li>To comply with applicable legal and regulatory requirements.</li>
              <li>To communicate service announcements and respond to support requests.</li>
            </ul>
          </section>

          {/* 4. Legal Bases */}
          <section aria-labelledby="pp-legal-basis">
            <h2 id="pp-legal-basis" className="text-xl font-bold text-gray-900 mb-3">
              4. Legal Bases for Processing
            </h2>
            <p className="mb-4">
              Where applicable privacy regulations require a legal basis, we rely on:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Contract performance</strong> — processing necessary to provide the
                Platform services you have signed up for.
              </li>
              <li>
                <strong>Legal obligation</strong> — KYC and AML compliance requirements.
              </li>
              <li>
                <strong>Legitimate interests</strong> — fraud prevention, platform security,
                and service improvement.
              </li>
              <li>
                <strong>Consent</strong> — push notification subscriptions and optional
                marketing communications (withdrawable at any time).
              </li>
            </ul>
          </section>

          {/* 5. Data Sharing */}
          <section aria-labelledby="pp-sharing">
            <h2 id="pp-sharing" className="text-xl font-bold text-gray-900 mb-3">
              5. Data Sharing and Disclosure
            </h2>
            <p className="mb-4">
              We do not sell your personal data. We may share your data with:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>KYC providers</strong> — third-party identity verification services
                used to comply with AML regulations.
              </li>
              <li>
                <strong>Infrastructure providers</strong> — cloud hosting, IPFS pinning
                (web3.storage), object storage, and monitoring services (Sentry) bound by
                data processing agreements.
              </li>
              <li>
                <strong>Regulatory authorities</strong> — where legally required by court
                order, subpoena, or applicable financial regulation.
              </li>
              <li>
                <strong>Business transfers</strong> — in the event of a merger, acquisition,
                or asset sale, your data may be transferred as part of that transaction.
              </li>
            </ul>
          </section>

          {/* 6. Data Retention */}
          <section aria-labelledby="pp-retention">
            <h2 id="pp-retention" className="text-xl font-bold text-gray-900 mb-3">
              6. Data Retention
            </h2>
            <p>
              We retain personal data for as long as necessary to provide the Platform services
              and to comply with legal obligations (typically 5–7 years for financial records).
              KYC documents are retained for the legally mandated period after account closure.
              Push notification subscriptions are deleted when you revoke permission or close
              your account.
            </p>
          </section>

          {/* 7. Security */}
          <section aria-labelledby="pp-security">
            <h2 id="pp-security" className="text-xl font-bold text-gray-900 mb-3">
              7. Security
            </h2>
            <p>
              We employ industry-standard measures to protect your data, including TLS
              encryption in transit, AES-256 encryption at rest for sensitive fields, JWT
              authentication with short-lived tokens, AWS KMS for key management, and regular
              security audits. However, no method of transmission over the internet is 100%
              secure. We cannot guarantee absolute security of your data.
            </p>
          </section>

          {/* 8. Your Rights */}
          <section aria-labelledby="pp-rights">
            <h2 id="pp-rights" className="text-xl font-bold text-gray-900 mb-3">
              8. Your Privacy Rights
            </h2>
            <p className="mb-4">
              Depending on your jurisdiction, you may have the right to:
            </p>
            <ul className="list-disc list-inside space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Correct inaccurate or incomplete data.</li>
              <li>Request deletion of your data (subject to legal retention requirements).</li>
              <li>Object to or restrict certain processing activities.</li>
              <li>Port your data to another service in a machine-readable format.</li>
              <li>Withdraw consent for push notifications or marketing communications.</li>
            </ul>
            <p className="mt-4">
              To exercise any of these rights, contact us at{' '}
              <a
                href="mailto:privacy@agric-onchain.com"
                className="text-brand-600 hover:text-brand-700 underline font-medium"
              >
                privacy@agric-onchain.com
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          {/* 9. Cookies */}
          <section aria-labelledby="pp-cookies">
            <h2 id="pp-cookies" className="text-xl font-bold text-gray-900 mb-3">
              9. Cookies and Local Storage
            </h2>
            <p>
              The Platform uses browser{' '}
              <code className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-sm font-mono">
                localStorage
              </code>{' '}
              to store your authentication token and cached user profile. We do not use
              third-party advertising cookies. Session management cookies are strictly
              necessary for the Platform to function and cannot be disabled.
            </p>
          </section>

          {/* 10. Children */}
          <section aria-labelledby="pp-children">
            <h2 id="pp-children" className="text-xl font-bold text-gray-900 mb-3">
              10. Children&apos;s Privacy
            </h2>
            <p>
              The Platform is not directed to individuals under 18 years of age. We do not
              knowingly collect personal information from children. If you believe a child has
              provided us with personal data, please contact us immediately.
            </p>
          </section>

          {/* 11. International Transfers */}
          <section aria-labelledby="pp-transfers">
            <h2 id="pp-transfers" className="text-xl font-bold text-gray-900 mb-3">
              11. International Data Transfers
            </h2>
            <p>
              Your data may be processed in countries other than your country of residence.
              Where such transfers occur, we ensure appropriate safeguards are in place,
              including standard contractual clauses or equivalent mechanisms recognised by
              applicable privacy law.
            </p>
          </section>

          {/* 12. Changes */}
          <section aria-labelledby="pp-changes">
            <h2 id="pp-changes" className="text-xl font-bold text-gray-900 mb-3">
              12. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. The updated version will be
              indicated by an updated &ldquo;Last updated&rdquo; date at the top of this page.
              We will notify you of material changes via email or a prominent in-app notice.
              Continued use of the Platform after changes constitutes acceptance.
            </p>
          </section>

          {/* 13. Contact */}
          <section aria-labelledby="pp-contact">
            <h2 id="pp-contact" className="text-xl font-bold text-gray-900 mb-3">
              13. Contact Us
            </h2>
            <p>
              For questions, complaints, or requests regarding your privacy, please contact our
              Data Protection Officer at{' '}
              <a
                href="mailto:privacy@agric-onchain.com"
                className="text-brand-600 hover:text-brand-700 underline font-medium"
              >
                privacy@agric-onchain.com
              </a>
              .
            </p>
          </section>

        </div>

        {/* Footer nav */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} AgriFi. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-gray-700 transition-colors">
              Terms of Service
            </Link>
            <Link href="/" className="hover:text-gray-700 transition-colors">
              Home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
