'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    // Check authentication and redirect to appropriate dashboard
    const currentUser = apiClient.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    // Redirect to role-specific dashboard
    router.push(`/dashboard/${currentUser.role}`);
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Redirecting to your dashboard...</p>
      </div>
    </div>
  );
}
