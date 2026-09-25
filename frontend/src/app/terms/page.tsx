import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — AgriFi',
  description:
    'Read the Terms of Service governing use of the AgriFi tokenised agricultural finance platform.',
};

export default function TermsOfServicePage() {
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
            href="/privacy"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        {/* Page heading */}
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
            Terms of Service
          </h1>
          <p className="text-sm text-gray-500">Last updated: {lastUpdated}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 sm:p-12 space-y-10 text-gray-700 leading-relaxed">

          {/* 1. Acceptance */}
          <section aria-labelledby="tos-acceptance">
            <h2 id="tos-acceptance" className="text-xl font-bold text-gray-900 mb-3">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using the AgriFi platform (&ldquo;Platform&rdquo;), you agree to be
              bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to all
              of these Terms, you may not access or use the Platform. AgriFi reserves the right
              to update these Terms at any time; continued use of the Platform after changes
              constitutes acceptance.
            </p>
          </section>

          {/* 2. Definitions */}
          <section aria-labelledby="tos-definitions">
            <h2 id="tos-definitions" className="text-xl font-bold text-gray-900 mb-3">
              2. Definitions
            </h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Platform</strong> — the AgriFi web application and associated APIs for
                tokenised agricultural trade finance.
              </li>
              <li>
                <strong>Trade Token</strong> — a Stellar-issued digital asset representing
                fractional ownership of a trade deal (1 token = USD 100).
              </li>
              <li>
                <strong>Farmer</strong> — a user who creates and lists agricultural produce
                deals on the Platform.
              </li>
              <li>
                <strong>Trader</strong> — a user who creates trade deals and manages shipment
                milestones on behalf of a supply chain.
              </li>
              <li>
                <strong>Investor</strong> — a user who purchases Trade Tokens to fund deals and
                earn proportional returns.
              </li>
              <li>
                <strong>Escrow Account</strong> — a Stellar account holding investor funds until
                deal completion conditions are met.
              </li>
            </ul>
          </section>

          {/* 3. Eligibility */}
          <section aria-labelledby="tos-eligibility">
            <h2 id="tos-eligibility" className="text-xl font-bold text-gray-900 mb-3">
              3. Eligibility and KYC
            </h2>
            <p className="mb-4">
              You must be at least 18 years of age and have full legal capacity to enter into
              binding agreements in your jurisdiction to use the Platform.
            </p>
            <p>
              All users must complete the Know Your Customer (KYC) process before participating
              in trade deals or investments. AgriFi may refuse or revoke access if KYC
              requirements are not met or if prohibited activities are detected.
            </p>
          </section>

          {/* 4. Tokenised Trade Deals */}
          <section aria-labelledby="tos-tokens">
            <h2 id="tos-tokens" className="text-xl font-bold text-gray-900 mb-3">
              4. Tokenised Agricultural Trade Deals
            </h2>
            <p className="mb-4">
              Trade Tokens represent fractional interests in specific agricultural trade
              deals. They are not securities or investment contracts regulated under any
              national securities law unless explicitly stated for your jurisdiction. Users are
              solely responsible for determining the regulatory status of participation in their
              country of residence.
            </p>
            <p className="mb-4">
              Escrow funds are held in Stellar escrow accounts. Upon confirmation of the
              Importer milestone, escrow is automatically released: the Farmer receives 98% of
              the deal value, Investors receive proportional returns, and AgriFi retains a 2%
              platform fee.
            </p>
            <p>
              AgriFi does not guarantee returns. Investment in agricultural trade deals
              involves risks including, but not limited to, crop failure, logistics disruption,
              regulatory changes, and Stellar network outages.
            </p>
          </section>

          {/* 5. User Obligations */}
          <section aria-labelledby="tos-obligations">
            <h2 id="tos-obligations" className="text-xl font-bold text-gray-900 mb-3">
              5. User Obligations
            </h2>
            <p className="mb-3">You agree not to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Provide false or misleading information during registration or KYC.</li>
              <li>
                Use the Platform for money laundering, terrorist financing, or any other
                illegal activity.
              </li>
              <li>
                Interfere with or disrupt the Platform, including its underlying Stellar
                blockchain infrastructure.
              </li>
              <li>Attempt to gain unauthorised access to other users&apos; accounts or data.</li>
              <li>
                Transmit viruses, malware, or any code intended to damage or disrupt the
                Platform.
              </li>
              <li>
                Create fictitious deals, milestones, or shipment records to manipulate the
                escrow release process.
              </li>
            </ul>
          </section>

          {/* 6. Stellar Blockchain */}
          <section aria-labelledby="tos-stellar">
            <h2 id="tos-stellar" className="text-xl font-bold text-gray-900 mb-3">
              6. Stellar Blockchain Operations
            </h2>
            <p className="mb-4">
              All on-chain operations (token issuance, escrow funding, milestone anchoring,
              and escrow release) are processed on the Stellar network. Transactions are
              irreversible once confirmed. AgriFi is not liable for losses caused by Stellar
              network downtime, incorrect wallet addresses supplied by users, or private key
              compromise.
            </p>
            <p>
              Users must connect a compatible Stellar wallet (such as Freighter) and are
              responsible for safeguarding their secret keys. AgriFi never stores or has
              access to users&apos; private keys.
            </p>
          </section>

          {/* 7. Fees */}
          <section aria-labelledby="tos-fees">
            <h2 id="tos-fees" className="text-xl font-bold text-gray-900 mb-3">
              7. Fees
            </h2>
            <p>
              AgriFi charges a 2% platform fee deducted from each deal&apos;s escrow at
              completion. Additional fees may apply for document storage, IPFS pinning, or
              third-party KYC verification services. All applicable fees are displayed before
              confirmation.
            </p>
          </section>

          {/* 8. Intellectual Property */}
          <section aria-labelledby="tos-ip">
            <h2 id="tos-ip" className="text-xl font-bold text-gray-900 mb-3">
              8. Intellectual Property
            </h2>
            <p>
              All content, trademarks, logos, and software comprising the Platform are the
              exclusive property of AgriFi or its licensors. You are granted a limited,
              non-exclusive, non-transferable licence to use the Platform solely for its
              intended purpose. You may not reproduce, distribute, or create derivative works
              without prior written consent.
            </p>
          </section>

          {/* 9. Privacy */}
          <section aria-labelledby="tos-privacy">
            <h2 id="tos-privacy" className="text-xl font-bold text-gray-900 mb-3">
              9. Privacy
            </h2>
            <p>
              Your use of the Platform is also governed by our{' '}
              <Link
                href="/privacy"
                className="text-brand-600 hover:text-brand-700 underline font-medium"
              >
                Privacy Policy
              </Link>
              , which is incorporated into these Terms by reference. By using the Platform, you
              consent to the collection and use of your information as described therein.
            </p>
          </section>

          {/* 10. Limitation of Liability */}
          <section aria-labelledby="tos-liability">
            <h2 id="tos-liability" className="text-xl font-bold text-gray-900 mb-3">
              10. Limitation of Liability
            </h2>
            <p className="mb-4">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, AGRIFI AND ITS AFFILIATES,
              OFFICERS, EMPLOYEES, AGENTS, AND LICENSORS SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF
              PROFITS, DATA, OR GOODWILL.
            </p>
            <p>
              AgriFi&apos;s total aggregate liability to you for any claim arising under these
              Terms shall not exceed the platform fees paid by you in the twelve (12) months
              preceding the claim.
            </p>
          </section>

          {/* 11. Indemnification */}
          <section aria-labelledby="tos-indemnification">
            <h2 id="tos-indemnification" className="text-xl font-bold text-gray-900 mb-3">
              11. Indemnification
            </h2>
            <p>
              You agree to defend, indemnify, and hold harmless AgriFi and its affiliates from
              and against any claims, damages, obligations, losses, liabilities, costs, or
              debt, and expenses (including legal fees) arising from your use of the Platform,
              your violation of these Terms, or your violation of any third-party rights.
            </p>
          </section>

          {/* 12. Governing Law */}
          <section aria-labelledby="tos-law">
            <h2 id="tos-law" className="text-xl font-bold text-gray-900 mb-3">
              12. Governing Law and Dispute Resolution
            </h2>
            <p>
              These Terms are governed by and construed in accordance with applicable
              international commercial law. Any dispute arising from or in connection with
              these Terms shall be resolved through binding arbitration before a mutually
              agreed arbitrator. Nothing in this clause prevents either party from seeking
              injunctive or other equitable relief in a competent court.
            </p>
          </section>

          {/* 13. Contact */}
          <section aria-labelledby="tos-contact">
            <h2 id="tos-contact" className="text-xl font-bold text-gray-900 mb-3">
              13. Contact
            </h2>
            <p>
              For questions about these Terms, please contact us at{' '}
              <a
                href="mailto:legal@agric-onchain.com"
                className="text-brand-600 hover:text-brand-700 underline font-medium"
              >
                legal@agric-onchain.com
              </a>
              .
            </p>
          </section>

        </div>

        {/* Footer nav */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4 items-center justify-between text-sm text-gray-500">
          <p>© {new Date().getFullYear()} AgriFi. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-700 transition-colors">
              Privacy Policy
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
