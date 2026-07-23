'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, User, Document } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import { PdfViewer } from '@/components/ui/PdfViewer';

interface DealDocument extends Document {
  dealId?: string;
  dealCommodity?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  quality_certificate: 'Quality Certificate',
  bill_of_lading:      'Bill of Lading',
  invoice:             'Invoice',
  insurance:           'Insurance',
  phytosanitary:       'Phytosanitary Certificate',
};

function docLabel(type: string) {
  return DOC_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isPdf(url: string) {
  return url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('application/pdf');
}

export default function DocumentsPage() {
  const router = useRouter();
  const [user, setUser]         = useState<User | null>(null);
  const [docs, setDocs]         = useState<DealDocument[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selected, setSelected] = useState<DealDocument | null>(null);

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) { router.push('/login'); return; }
      let u = cached;
      try { const f = await apiClient.refreshCurrentUser(); if (f) u = f; } catch {}
      setUser(u);

      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/documents', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load documents');
        const data = await res.json();
        setDocs(Array.isArray(data) ? data : data.data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load documents');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        <div>
          <p className="text-sm text-slate-500 mb-1">Trade certificates &amp; files</p>
          <h1 className="page-title">Documents</h1>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-4 flex items-center gap-4">
                <div className="w-10 h-10 skeleton rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 skeleton rounded-lg w-1/3" />
                  <div className="h-3 skeleton rounded-lg w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="alert-error">
            <span>⚠</span>
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && docs.length === 0 && (
          <div className="card p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-3">
              📂
            </div>
            <p className="text-sm font-semibold text-slate-700">No documents yet</p>
            <p className="text-xs text-slate-400 mt-1">Documents attached to your deals will appear here.</p>
          </div>
        )}

        {!loading && docs.length > 0 && (
          <div className="grid gap-3">
            {docs.map(doc => {
              const docUrl = doc.storage_url || `https://ipfs.io/ipfs/${doc.ipfs_hash}`;
              const pdf    = isPdf(docUrl);
              const isOpen = selected?.id === doc.id;

              return (
                <div key={doc.id} className="card overflow-hidden">
                  {/* Document row */}
                  <div className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-xl flex-shrink-0">
                      📄
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {docLabel(doc.doc_type)}
                      </p>
                      {doc.dealCommodity && (
                        <p className="text-xs text-slate-400 capitalize">{doc.dealCommodity}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(doc.created_at).toLocaleDateString('en', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {pdf && (
                        <button
                          onClick={() => setSelected(isOpen ? null : doc)}
                          className={`btn-secondary text-xs px-3 py-1.5 ${isOpen ? 'bg-brand-50 border-brand-200 text-brand-700' : ''}`}
                        >
                          {isOpen ? 'Close' : 'Preview'}
                        </button>
                      )}
                      <a
                        href={docUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="btn-secondary text-xs px-3 py-1.5"
                        aria-label={`Download ${docLabel(doc.doc_type)}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                    </div>
                  </div>

                  {/* Inline PDF viewer */}
                  {isOpen && pdf && (
                    <div className="border-t border-slate-100 p-4">
                      <PdfViewer
                        url={docUrl}
                        fileName={`${docLabel(doc.doc_type)}.pdf`}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
