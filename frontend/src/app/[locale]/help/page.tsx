'use client';

/**
 * Help Center
 *
 * Public educational page for farmers and investors who are new to
 * blockchain / tokenized trade finance. No authentication required.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqCategory {
  key: string;
  label: string;
  icon: string;
  items: FaqItem[];
}

const CATEGORIES: FaqCategory[] = [
  {
    key: 'stellar',
    label: 'Stellar',
    icon: '⭐',
    items: [
      {
        q: 'What is Stellar and why does AgriFi use it?',
        a: 'Stellar is a public blockchain built for fast, low-cost payments. AgriFi uses it to move USDC between investors and farmers in seconds, for a fraction of a cent in fees, and to record every transaction on a public ledger anyone can verify.',
      },
      {
        q: 'What is Soroban?',
        a: "Soroban is Stellar's smart contract platform. AgriFi's \"FarmCampaign\" contracts automatically hold investor funds in escrow, release payment milestones as a shipment progresses, and split revenue among investors — no manual bank transfers involved.",
      },
      {
        q: 'What is a Stellar wallet and how do I get one?',
        a: 'A wallet is where you hold your Stellar assets (USDC and trade tokens) and sign transactions. We support Freighter, a free browser extension wallet — install it, create an account, and click "Connect Wallet" from your dashboard.',
      },
      {
        q: 'What are trustlines?',
        a: 'A trustline is a Stellar account setting that says "I am willing to hold this specific asset." Before you can receive USDC or a deal\'s trade token, your wallet needs a trustline to it — AgriFi prompts you to add one automatically the first time you need it.',
      },
    ],
  },
  {
    key: 'investing',
    label: 'Investing',
    icon: '💼',
    items: [
      {
        q: 'How do I invest in a deal?',
        a: 'Browse open deals in the Marketplace, choose how many tokens you want to buy, and confirm the investment. You\'ll sign a Stellar transaction in your wallet that sends USDC into the deal\'s escrow contract in exchange for trade tokens.',
      },
      {
        q: 'What is the minimum investment amount?',
        a: 'Each deal sets its own token price (fixed at $100 per token), so the minimum is the price of a single token. Some deals may set a higher minimum token purchase — check the deal page for details.',
      },
      {
        q: 'How are returns calculated and paid out?',
        a: 'Your expected return is based on the deal\'s annual ROI and term length, shown on every deal card. Once the commodity is delivered and sold, revenue is distributed on-chain to all token holders proportional to their holdings.',
      },
      {
        q: 'Can I sell my investment before maturity?',
        a: 'Yes — trade tokens can be listed on the Stellar DEX secondary market from your Investor Dashboard, letting other investors buy your position before the deal completes.',
      },
      {
        q: 'What happens if a deal fails to reach its funding target?',
        a: "If a deal doesn't reach its funding target by the deadline, the smart contract can be marked failed and invested funds are returned to investors' wallets.",
      },
    ],
  },
  {
    key: 'shipping',
    label: 'Shipping',
    icon: '🚚',
    items: [
      {
        q: "How is my commodity's shipment tracked?",
        a: 'Every deal moves through four recorded milestones — Farm, Warehouse, Port, and Importer — each logged on-chain with a timestamp and optional notes, so you can follow the shipment in real time from the deal page.',
      },
      {
        q: 'What documents are uploaded during shipping?',
        a: 'Farmers and traders upload supporting documents such as bills of lading, export certificates, quality certificates, and warehouse receipts. Each document is stored on IPFS and anchored with a Stellar transaction so it can never be silently altered.',
      },
      {
        q: 'What happens if a shipment is delayed?',
        a: "If a deal passes its delivery date without reaching the \"delivered\" milestone, it's flagged as delayed on your Investor Dashboard so you can monitor it closely and reach out to platform admins if needed.",
      },
      {
        q: 'Who records the milestones?',
        a: 'The farmer or trader responsible for the deal records each milestone as the shipment physically progresses. This creates an auditable, tamper-evident trail from farm gate to final delivery.',
      },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    icon: '🔒',
    items: [
      {
        q: 'How is my money protected?',
        a: "Investor funds are held in a Soroban escrow smart contract, not by AgriFi directly. Funds only move according to the contract's programmed rules — released to the farmer on verified milestones, or returned to investors if a deal fails.",
      },
      {
        q: 'Is my personal data safe?',
        a: 'Personal and KYC data is encrypted at rest and only accessible to platform admins for compliance review. Blockchain records only contain financial transactions and document hashes — never personal information.',
      },
      {
        q: 'What is KYC and why is it required?',
        a: "KYC (Know Your Customer) verifies your identity before you can invest or list a deal. It's a regulatory requirement that protects the platform and its users from fraud and money laundering.",
      },
      {
        q: 'How are documents verified on-chain?',
        a: "Every uploaded document is hashed and the hash is anchored in a Stellar transaction. Admins can also verify an attached cryptographic signature. This means a document's authenticity and upload time can be independently confirmed by anyone, at any time.",
      },
    ],
  },
];

const LIFECYCLE_STEPS = [
  { step: '1', label: 'Deal Listed', desc: 'A farmer or trader lists a commodity deal with quantity, price, and delivery date.', icon: '📝' },
  { step: '2', label: 'Investors Fund', desc: 'Investors buy trade tokens with USDC; funds are held in a Soroban escrow contract.', icon: '💰' },
  { step: '3', label: 'Shipment Tracked', desc: 'Milestones are recorded on-chain as the commodity moves: Farm → Warehouse → Port → Importer.', icon: '🚚' },
  { step: '4', label: 'Delivery Confirmed', desc: 'The buyer confirms receipt and the deal is marked delivered.', icon: '📦' },
  { step: '5', label: 'Revenue Distributed', desc: 'Sale proceeds are distributed on-chain to investors proportional to their token holdings.', icon: '🏆' },
];

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [search]);

  const totalMatches = filteredCategories.reduce((sum, c) => sum + c.items.length, 0);
  const isSearching = search.trim().length > 0;

  const toggle = (id: string) => setOpenKey((current) => (current === id ? null : id));

  return (
    <main className="min-h-screen bg-canvas py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="text-2xl group-hover:animate-bounce-sm transition-transform">🌾</span>
            <span className="font-black text-slate-900 text-lg tracking-tight">AgriFi</span>
          </Link>
          <Link href="/marketplace" className="btn-secondary text-sm">
            Browse Marketplace
          </Link>
        </div>

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="page-title text-3xl md:text-4xl">Help Center</h1>
          <p className="text-slate-500 max-w-xl mx-auto">
            New to blockchain or tokenized trade finance? Everything you need to know
            about investing, shipping, and staying secure on AgriFi.
          </p>
        </div>

        {/* Search */}
        <div className="relative max-w-lg mx-auto">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions… e.g. wallet, escrow, KYC"
            aria-label="Search help questions"
            className="input pl-10"
          />
          {isSearching && (
            <p className="text-xs text-slate-400 mt-2 text-center">
              {totalMatches} result{totalMatches === 1 ? '' : 's'} for &ldquo;{search}&rdquo;
            </p>
          )}
        </div>

        {/* Deal lifecycle diagram */}
        <div className="card p-6">
          <h2 className="section-title mb-6 text-center">How a Deal Works</h2>
          <div className="flex flex-col md:flex-row md:items-start gap-4">
            {LIFECYCLE_STEPS.map((s, i) => (
              <div key={s.step} className="flex md:flex-col flex-1 items-start md:items-center gap-4 md:gap-3 relative">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center text-xl shadow-sm">
                    {s.icon}
                  </div>
                  {i < LIFECYCLE_STEPS.length - 1 && (
                    <>
                      {/* connector: vertical on mobile, horizontal on desktop */}
                      <div className="w-0.5 flex-1 bg-border md:hidden mt-1" style={{ minHeight: '1.5rem' }} />
                    </>
                  )}
                </div>
                {i < LIFECYCLE_STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-[calc(50%+1.5rem)] right-[calc(-50%+1.5rem)] h-0.5 bg-border" />
                )}
                <div className="md:text-center">
                  <p className="text-sm font-bold text-slate-900">{s.label}</p>
                  <p className="text-xs text-slate-500 mt-1 md:px-1">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ categories */}
        <div className="space-y-8">
          {filteredCategories.length === 0 && (
            <div className="card p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-3">
                🔍
              </div>
              <p className="text-sm font-semibold text-slate-700">No questions match &ldquo;{search}&rdquo;</p>
              <p className="text-xs text-slate-400 mt-1">Try a different keyword, or browse all categories below.</p>
              <button onClick={() => setSearch('')} className="btn-secondary text-sm mt-4">
                Clear search
              </button>
            </div>
          )}

          {filteredCategories.map((cat) => (
            <section key={cat.key}>
              <h2 className="flex items-center gap-2 section-title mb-3">
                <span className="text-xl">{cat.icon}</span>
                {cat.label}
                <span className="text-xs font-normal text-slate-400">({cat.items.length})</span>
              </h2>

              <div className="card divide-y divide-border overflow-hidden">
                {cat.items.map((item, i) => {
                  const id = `${cat.key}-${i}`;
                  const isOpen = isSearching || openKey === id;
                  return (
                    <div key={id}>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-expanded={isOpen}
                        aria-controls={`${id}-panel`}
                        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-neutral-muted/50 transition-colors"
                      >
                        <span className="text-sm font-semibold text-slate-900">
                          {highlight(item.q, search)}
                        </span>
                        <svg
                          className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div id={`${id}-panel`} className="px-5 pb-4 -mt-1">
                          <p className="text-sm text-slate-600 leading-relaxed">
                            {highlight(item.a, search)}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Still need help */}
        <div className="card p-6 text-center bg-neutral-muted/40">
          <p className="text-sm font-semibold text-slate-900">Still have questions?</p>
          <p className="text-xs text-slate-500 mt-1">
            Reach out to your account admin, or check the{' '}
            <Link href="/transparency" className="text-primary hover:underline font-medium">
              transparency page
            </Link>{' '}
            to verify any deal on-chain.
          </p>
        </div>
      </div>
    </main>
  );
}
