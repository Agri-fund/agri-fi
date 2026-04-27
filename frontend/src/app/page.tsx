"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center max-w-2xl mx-auto px-4">
        <h1 className="text-4xl font-bold text-green-800 mb-4">
          Invest in Agriculture
        </h1>
        <p className="text-lg text-green-600 mb-8">
          Buy and trade tokenized agricultural deals on Stellar.
        </p>

        <div className="space-y-4">
          <p className="text-gray-600">
            Connect your Stellar wallet to explore the marketplace and invest in
            available deals.
          </p>

          <div className="flex justify-center space-x-4">
            <Link
              href="/marketplace"
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-md font-medium transition-colors"
            >
              View Marketplace
            </Link>
          </div>

          <div className="mt-8 text-sm text-gray-500">
            <p>Getting started</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Install a Stellar wallet (Freighter or Albedo).</li>
              <li>Switch to Stellar testnet.</li>
              <li>Connect your wallet to invest.</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
