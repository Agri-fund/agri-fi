'use client';

import React, { Suspense } from 'react';
import { SocialTradingDashboard } from '@/components/social-trading/SocialTradingDashboard';

export default function SocialTradingPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6">
      <Suspense
        fallback={
          <div className="max-w-7xl mx-auto px-4 py-12 text-sm text-slate-500 dark:text-slate-400">
            Loading social trading...
          </div>
        }
      >
        <SocialTradingDashboard />
      </Suspense>
    </main>
  );
}
