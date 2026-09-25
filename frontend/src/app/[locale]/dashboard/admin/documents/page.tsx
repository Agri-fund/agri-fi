'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, User, getStoredToken } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import { PdfViewer } from '@/components/ui/PdfViewer';
import { useToast } from '@/components/ui/ToastProvider';

interface AdminDocument {
  id: string;
  tradeDealId: string;
  uploaderId: string;
  docType: string;
  ipfsHash: string;
  storageUrl: string;
  stellarTxId: string | null;
  signatureVerified: boolean;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  tradeDeal: { id: string; commodity: string } | null;
  uploader: { id: string; email: string; role: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-yellow',
  approved: 'badge-green',
  rejected: 'badge-red',
};

function docLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPdf(url: string) {
  return url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('application/pdf');
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

export default function AdminDocumentsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [docs, setDocs] = useState<AdminDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) { router.push('/login'); return; }
      let u = cached;
      try { const f = await apiClient.refreshCurrentUser(); if (f) u = f; } catch {}
      if (u.role !== 'admin') { router.push(`/dashboard/${u.role}`); return; }
      setUser(u);
      await loadDocuments();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/admin/documents', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setDocs(Array.isArray(d) ? d : d.data ?? []);
      }
    } catch {}
    setLoading(false);
  };

  const filtered = docs.filter((d) => statusFilter === 'all' || d.verificationStatus === statusFilter);
  const selected = docs.find((d) => d.id === selectedId) ?? filtered[0] ?? null;
  const pendingCount = docs.filter((d) => d.verificationStatus === 'pending').length;

  const selectDoc = (id: string) => {
    setSelectedId(id);
    setShowRejectForm(false);
    setRejectReason('');
  };

  const approve = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/admin/documents/${selected.id}/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast('Document approved ✅', 'success');
        await loadDocuments();
      } else {
        const d = await res.json();
        toast(d.message ?? 'Failed to approve document', 'error');
      }
    } catch {
      toast('Request failed', 'error');
    }
    setActionLoading(false);
  };

  const reject = async () => {
    if (!selected || rejectReason.trim().length < 3) {
      toast('Please provide a rejection reason', 'error');
      return;
    }
    setActionLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/admin/documents/${selected.id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      if (res.ok) {
        toast('Document rejected', 'success');
        setShowRejectForm(false);
        setRejectReason('');
        await loadDocuments();
      } else {
        const d = await res.json();
        toast(d.message ?? 'Failed to reject document', 'error');
      }
    } catch {
      toast('Request failed', 'error');
    }
    setActionLoading(false);
  };

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">Document verification</p>
            <h1 className="page-title">Verify Documents</h1>
          </div>
          {pendingCount > 0 && (
            <span className="badge-yellow">{pendingCount} pending</span>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                statusFilter === s ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid md:grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
            <div className="card h-96 skeleton" />
            <div className="card h-96 skeleton" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-14 text-center">
            <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex items-center justify-center text-3xl mx-auto mb-5">
              {statusFilter === 'pending' ? '✅' : '📂'}
            </div>
            <h3 className="font-bold text-slate-900 text-lg mb-2">
              {statusFilter === 'pending' ? 'All clear!' : 'No documents found'}
            </h3>
            <p className="text-slate-500 text-sm">
              {statusFilter === 'pending'
                ? 'No documents are waiting for verification.'
                : `No documents with status "${statusFilter}".`}
            </p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
            {/* List */}
            <div className="table-wrapper divide-y divide-border max-h-[720px] overflow-y-auto">
              {filtered.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => selectDoc(doc.id)}
                  className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors hover:bg-neutral-muted/50 ${
                    selected?.id === doc.id ? 'bg-neutral-muted/70' : ''
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center text-lg flex-shrink-0">
                    📄
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{docLabel(doc.docType)}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {doc.uploader?.email ?? 'Unknown uploader'}
                      {doc.tradeDeal?.commodity ? ` · ${doc.tradeDeal.commodity}` : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={STATUS_BADGE[doc.verificationStatus] ?? 'badge-gray'}>
                        {doc.verificationStatus}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Detail */}
            {selected && (
              <div className="space-y-4">
                <div className="card p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="font-bold text-slate-900 text-lg">{docLabel(selected.docType)}</h2>
                      <p className="text-sm text-slate-500 mt-0.5">
                        Submitted by <span className="font-medium text-slate-700">{selected.uploader?.email ?? 'Unknown'}</span>
                        {selected.tradeDeal?.commodity && (
                          <> for <span className="font-medium text-slate-700 capitalize">{selected.tradeDeal.commodity}</span></>
                        )}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Uploaded {new Date(selected.createdAt).toLocaleString()}
                        {selected.signatureVerified && ' · ✅ Signature verified'}
                      </p>
                    </div>
                    <span className={STATUS_BADGE[selected.verificationStatus] ?? 'badge-gray'}>
                      {selected.verificationStatus}
                    </span>
                  </div>

                  {selected.verificationStatus === 'rejected' && selected.rejectionReason && (
                    <div className="alert-error mt-4">
                      <span>⚠</span>
                      <p><strong>Rejection reason:</strong> {selected.rejectionReason}</p>
                    </div>
                  )}
                </div>

                {/* Document preview */}
                {isPdf(selected.storageUrl) ? (
                  <PdfViewer url={selected.storageUrl} fileName={`${docLabel(selected.docType)}.pdf`} />
                ) : (
                  <div className="card p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selected.storageUrl}
                      alt={docLabel(selected.docType)}
                      className="max-h-[500px] w-full object-contain rounded-xl bg-slate-50"
                    />
                  </div>
                )}

                {/* Verification panel */}
                {selected.verificationStatus === 'pending' && (
                  <div className="card p-5 space-y-4">
                    <h3 className="font-semibold text-slate-900 text-sm">Verification decision</h3>

                    {!showRejectForm ? (
                      <div className="flex gap-3">
                        <button
                          onClick={approve}
                          disabled={actionLoading}
                          className="btn-primary flex-1"
                        >
                          {actionLoading ? 'Approving…' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => setShowRejectForm(true)}
                          disabled={actionLoading}
                          className="btn-danger flex-1"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label htmlFor="rejection-reason" className="label">Rejection reason</label>
                          <textarea
                            id="rejection-reason"
                            className="textarea"
                            rows={3}
                            placeholder="Explain why this document is being rejected…"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={reject}
                            disabled={actionLoading || rejectReason.trim().length < 3}
                            className="btn-danger flex-1"
                          >
                            {actionLoading ? 'Submitting…' : 'Confirm Rejection'}
                          </button>
                          <button
                            onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
                            disabled={actionLoading}
                            className="btn-secondary flex-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
