"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

/* ── Data ─────────────────────────────────────────────────────────────────── */
const stats = [
  { value: "$2.4M+", label: "Total Funded",    icon: "💰" },
  { value: "340+",   label: "Active Projects", icon: "🌱" },
  { value: "1,200+", label: "Investors",        icon: "👥" },
  { value: "98%",    label: "Harvest Success",  icon: "✅" },
];

const features = [
  { icon: "🌱", title: "Fund Farming Projects",
    desc: "Farmers tokenize crops and raise capital. Investors get fractional ownership with transparent on-chain returns." },
  { icon: "📊", title: "Real-Time Tracking",
    desc: "Live harvest updates, GPS shipment milestones, and immutable proof of every transaction on Stellar." },
  { icon: "🛒", title: "Direct Marketplace",
    desc: "Companies buy verified agricultural products straight from farmers — zero middlemen, full traceability." },
  { icon: "🔐", title: "Stellar Escrow",
    desc: "Smart escrow accounts, tokenized assets, and cryptographic proof secure every deal end-to-end." },
];

const roles = [
  {
    emoji: "👨‍🌾", title: "Farmers", accent: "#16a34a",
    bg: "from-emerald-500 to-green-600",
    points: ["Launch funding campaigns", "Upload farm & harvest data", "Sell directly to buyers", "Withdraw earnings instantly"],
    cta: "Start as Farmer",
  },
  {
    emoji: "💼", title: "Investors", accent: "#2563eb",
    bg: "from-blue-500 to-indigo-600",
    points: ["Browse vetted projects", "Invest fractionally from $100", "Earn transparent ROI", "Track portfolio in real-time"],
    cta: "Start Investing",
  },
  {
    emoji: "🏢", title: "Companies", accent: "#7c3aed",
    bg: "from-violet-500 to-purple-600",
    points: ["Buy bulk produce direct", "Verified farmer network", "Track deliveries live", "Secure escrow payments"],
    cta: "Register as Buyer",
  },
];

const steps = [
  { n: "01", title: "Create Account", desc: "Sign up as a farmer, investor, or company in under 2 minutes." },
  { n: "02", title: "Complete KYC",   desc: "Verify your identity to unlock full platform access." },
  { n: "03", title: "Fund or List",   desc: "Farmers list crops; investors browse and fund projects." },
  { n: "04", title: "Earn Returns",   desc: "Track harvest, receive payouts, and reinvest profits." },
];

/* ── Animated counter ─────────────────────────────────────────────────────── */
function useCounter(target: string, duration = 1800) {
  const [display, setDisplay] = useState("0");
  useEffect(() => {
    const num = parseFloat(target.replace(/[^0-9.]/g, ""));
    const suffix = target.replace(/[0-9.,]/g, "");
    if (isNaN(num)) { setDisplay(target); return; }
    let start = 0;
    const step = num / (duration / 16);
    const timer = setInterval(() => {
      start = Math.min(start + step, num);
      setDisplay((start < 1000 ? start.toFixed(start < 10 ? 1 : 0) : Math.round(start).toLocaleString()) + suffix);
      if (start >= num) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return display;
}

function StatItem({ value, label, icon }: { value: string; label: string; icon: string }) {
  const display = useCounter(value);
  return (
    <div className="text-center group">
      <div className="text-2xl mb-1 group-hover:animate-bounce-sm transition-all">{icon}</div>
      <p className="text-3xl sm:text-4xl font-black text-brand-600 tabular-nums">{display}</p>
      <p className="text-sm text-slate-500 mt-1 font-medium">{label}</p>
    </div>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────────────── */
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
      scrolled ? "glass shadow-sm" : "bg-transparent"
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="text-2xl group-hover:animate-bounce-sm">🌾</span>
          <span className="font-black text-slate-900 text-lg tracking-tight">AgriFi</span>
        </Link>

        <div className="hidden sm:flex items-center gap-1">
          <Link href="/marketplace" className="btn-ghost text-sm px-4 py-2">Marketplace</Link>
          <Link href="/login"       className="btn-ghost text-sm px-4 py-2">Sign in</Link>
          <Link href="/register"    className="btn-primary ml-2 text-sm px-5 py-2">Get Started →</Link>
        </div>

        <div className="flex sm:hidden gap-2">
          <Link href="/login"    className="btn-secondary text-xs px-3 py-2">Sign in</Link>
          <Link href="/register" className="btn-primary  text-xs px-3 py-2">Join</Link>
        </div>
      </div>
    </nav>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-200/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-200/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3 pointer-events-none" />

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #16a34a 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center py-20">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-semibold mb-8 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
            Live on Stellar Testnet · Zero fees during beta
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-900 leading-[1.05] tracking-tight mb-6 animate-slide-up">
            Agriculture meets{" "}
            <span className="gradient-text">DeFi</span>
            <br className="hidden sm:block" />
            <span className="text-slate-400 font-light"> — transparently.</span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up" style={{ animationDelay: '0.1s' }}>
            Fund farming projects, earn real returns, and buy produce directly from verified farmers.
            Every transaction secured on the Stellar blockchain.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16 animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <Link href="/register" className="btn-lg bg-brand-600 text-white hover:bg-brand-700 shadow-lg hover:shadow-glow-lg transition-all">
              Start for free →
            </Link>
            <Link href="/marketplace" className="btn-lg btn-secondary">
              Browse projects
            </Link>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-3 text-sm text-slate-400 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex -space-x-2">
              {["🧑🏿", "👩🏽", "👨🏾", "👩🏻"].map((e, i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-emerald-500 border-2 border-white flex items-center justify-center text-sm">{e}</div>
              ))}
            </div>
            <span>Trusted by <strong className="text-slate-600">1,200+ investors</strong> across Africa</span>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-400 animate-bounce-sm">
          <span className="text-xs font-medium">Scroll</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <section className="py-16 bg-white border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 sm:grid-cols-4 gap-8">
          {stats.map(s => <StatItem key={s.label} {...s} />)}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="badge-green mb-4">Platform Features</span>
            <h2 className="text-4xl font-black text-slate-900 mt-3 mb-4 tracking-tight">
              Everything in one ecosystem
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto text-lg">
              From seed funding to harvest sales — AgriFi handles the full agricultural value chain.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <div key={f.title}
                className="card-hover p-6 group"
                style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center text-2xl mb-5 group-hover:scale-110 transition-transform duration-200">
                  {f.icon}
                </div>
                <h3 className="font-bold text-slate-900 mb-2 text-base">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="badge-blue mb-4">How It Works</span>
            <h2 className="text-4xl font-black text-slate-900 mt-3 mb-4 tracking-tight">
              Up and running in minutes
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s, i) => (
              <div key={s.n} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-6 left-full w-full h-px bg-gradient-to-r from-brand-200 to-transparent z-0" />
                )}
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-2xl bg-brand-600 text-white font-black text-sm flex items-center justify-center mb-4 shadow-md">
                    {s.n}
                  </div>
                  <h3 className="font-bold text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Roles ─────────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="badge-purple mb-4">Who It&apos;s For</span>
            <h2 className="text-4xl font-black text-slate-900 mt-3 mb-4 tracking-tight">
              Built for everyone in the chain
            </h2>
            <p className="text-slate-500 text-lg">Whether you grow it, fund it, or buy it — there&apos;s a place for you.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {roles.map(r => (
              <div key={r.title} className="card overflow-hidden group hover:shadow-card-lg transition-all duration-300 hover:-translate-y-1">
                {/* Header */}
                <div className={`bg-gradient-to-br ${r.bg} p-7 text-white relative overflow-hidden`}>
                  <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/10" />
                  <div className="absolute -right-2 -bottom-8 w-32 h-32 rounded-full bg-white/5" />
                  <div className="relative">
                    <div className="text-5xl mb-3 group-hover:animate-bounce-sm">{r.emoji}</div>
                    <h3 className="text-2xl font-black">{r.title}</h3>
                  </div>
                </div>

                {/* Body */}
                <div className="p-6">
                  <ul className="space-y-2.5 mb-6">
                    {r.points.map(p => (
                      <li key={p} className="flex items-center gap-2.5 text-sm text-slate-600">
                        <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                  <Link href="/register" className="btn-outline-primary w-full text-sm py-2.5">
                    {r.cta} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-brand-gradient" />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-black/5 rounded-full blur-3xl" />

        <div className="relative max-w-2xl mx-auto text-center text-white">
          <div className="text-5xl mb-6 animate-bounce-sm">🚀</div>
          <h2 className="text-4xl font-black mb-4 tracking-tight">Ready to grow your wealth?</h2>
          <p className="text-brand-100 mb-10 text-lg">
            Join thousands of farmers, investors, and buyers already building the future of agriculture.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-brand-700 font-bold rounded-2xl hover:bg-brand-50 transition-all shadow-lg hover:shadow-xl text-base active:scale-95">
              Create Free Account →
            </Link>
            <Link href="/marketplace"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 text-white font-semibold rounded-2xl hover:bg-white/20 transition-all border border-white/20 text-base active:scale-95">
              Browse Marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-8">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🌾</span>
              <span className="font-black text-white text-lg">AgriFi</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <Link href="/marketplace" className="hover:text-white transition-colors">Marketplace</Link>
              <Link href="/login"       className="hover:text-white transition-colors">Sign in</Link>
              <Link href="/register"    className="hover:text-white transition-colors">Register</Link>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <p>© {new Date().getFullYear()} AgriFi. All rights reserved.</p>
            <p className="flex items-center gap-1.5">
              Powered by <span className="text-brand-400 font-semibold">Stellar</span> blockchain
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
