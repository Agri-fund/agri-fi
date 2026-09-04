'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, User, getStoredToken } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';

interface Deployment {
  id: string;
  contractName: string;
  networkPassphrase: string;
  contractId: string;
  wasmHash: string;
  previousWasmHash: string | null;
  deployedAt: string;
  status: string;
  smokeTestPassed: boolean | null;
}

export default function ContractDeploymentsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached || cached.role !== 'admin') {
        router.push('/login');
        return;
      }
      setUser(cached);

      try {
        const token = getStoredToken();
        const res = await fetch('/api/admin/upgrades/deployments', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) setDeployments(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const filtered = filter
    ? deployments.filter((d) => d.contractName.includes(filter))
    : deployments;

  const grouped = filtered.reduce<Record<string, Deployment[]>>((acc, d) => {
    (acc[d.contractName] ??= []).push(d);
    return acc;
  }, {});

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="px-6 py-8 max-w-6xl mx-auto">
        <h1 className="text-2xl font-black text-slate-900 mb-2">Contract Deployments</h1>
        <p className="text-sm text-slate-500 mb-6">
          Soroban contract deployment history with WASM hashes and upgrade status.
        </p>

        <input
          type="text"
          placeholder="Filter by contract name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-6 px-3 py-2 text-sm border border-slate-200 rounded-xl w-full max-w-sm"
        />

        {loading ? (
          <p className="text-slate-500">Loading deployments…</p>
        ) : Object.keys(grouped).length === 0 ? (
          <p className="text-slate-500">No deployments recorded yet.</p>
        ) : (
          Object.entries(grouped).map(([name, items]) => (
            <div key={name} className="mb-8">
              <h2 className="text-lg font-bold text-slate-800 mb-3">{name}</h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-600">Status</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">WASM Hash</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">Contract ID</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">Deployed</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">Smoke Test</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((d) => (
                      <tr key={d.id} className="border-t border-slate-100">
                        <td className="px-4 py-3">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {d.wasmHash.slice(0, 16)}…
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {d.contractId.slice(0, 12)}…
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(d.deployedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {d.smokeTestPassed == null ? '—' : d.smokeTestPassed ? '✓' : '✗'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    superseded: 'bg-slate-100 text-slate-600',
    rolled_back: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}
