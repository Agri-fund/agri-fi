'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) {
        router.push('/login');
        return;
      }

      try {
        const fresh = await apiClient.refreshCurrentUser();
        if (cancelled) return;
        const role = fresh?.role ?? cached.role;
        router.push(`/dashboard/${role}`);
      } catch {
        if (cancelled) return;
        router.push(`/dashboard/${cached.role}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Redirecting to your dashboard...</p>
        </div>
      </div>
    </ErrorBoundary>
  );
}
