'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone, FileWithPath } from 'react-dropzone';
import { getAuthToken } from '@/lib/auth-token';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

type MilestoneType = 'farm' | 'warehouse' | 'port' | 'importer';

interface LocationState {
  lat: number;
  lng: number;
}

interface UploadedDoc {
  id: string;
  storage_url: string;
  doc_type: string;
}

interface MilestoneEvidenceFormProps {
  tradeDealId: string;
  /** Next expected milestone type */
  milestoneType: MilestoneType;
  onSuccess?: (milestone: any) => void;
  onCancel?: () => void;
}

const MILESTONE_LABELS: Record<MilestoneType, string> = {
  farm: 'Farm Collection',
  warehouse: 'Warehouse Storage',
  port: 'Port Shipment',
  importer: 'Importer Receipt',
};

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] };

async function uploadEvidenceFile(
  file: File,
  tradeDealId: string,
  token: string,
): Promise<UploadedDoc> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tradeDealId', tradeDealId);
  formData.append('docType', 'milestone_evidence');

  const res = await fetch(`${API_BASE}/v1/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Upload failed (${res.status})`);
  }

  return res.json();
}

async function recordMilestone(payload: {
  trade_deal_id: string;
  milestone: MilestoneType;
  notes?: string;
  location?: { lat: number; lng: number };
  evidence?: string[];
}, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}/v1/shipments/milestones`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Failed to record milestone (${res.status})`);
  }

  return res.json();
}

export function MilestoneEvidenceForm({
  tradeDealId,
  milestoneType,
  onSuccess,
  onCancel,
}: MilestoneEvidenceFormProps) {
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [location, setLocation] = useState<LocationState | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: FileWithPath[]) => {
    setFiles(prev => {
      const combined = [...prev, ...acceptedFiles];
      return combined.slice(0, MAX_FILES);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: MAX_FILES,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
  });

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(`Location error: ${err.message}`);
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const clearLocation = () => setLocation(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const token = getAuthToken();
    if (!token) {
      setError('Authentication required.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // 1. Upload all evidence files concurrently
      const uploadedDocs: UploadedDoc[] = [];
      if (files.length > 0) {
        const total = files.length;
        let completed = 0;

        const results = await Promise.allSettled(
          files.map(async (file) => {
            const doc = await uploadEvidenceFile(file, tradeDealId, token);
            completed += 1;
            setUploadProgress(Math.round((completed / total) * 80));
            return doc;
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            uploadedDocs.push(result.value);
          } else {
            throw new Error(`File upload failed: ${(result.reason as Error).message}`);
          }
        }
      }

      setUploadProgress(85);

      // 2. Record the milestone with evidence IDs and location
      const milestone = await recordMilestone(
        {
          trade_deal_id: tradeDealId,
          milestone: milestoneType,
          notes: notes.trim() || undefined,
          location: location ?? undefined,
          evidence: uploadedDocs.map(d => d.id),
        },
        token,
      );

      setUploadProgress(100);
      onSuccess?.(milestone);
    } catch (err: any) {
      setError(err.message ?? 'An unexpected error occurred.');
    } finally {
      setUploading(false);
    }
  };

  const mapPreviewUrl = location
    ? `https://www.openstreetmap.org/?mlat=${location.lat}&mlon=${location.lng}&zoom=14`
    : null;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5"
      aria-label={`Record ${MILESTONE_LABELS[milestoneType]} milestone`}
    >
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Record Milestone: {MILESTONE_LABELS[milestoneType]}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Add notes, capture your GPS location, and attach up to {MAX_FILES} photos as proof of execution.
        </p>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="milestone-notes" className="block text-sm font-medium text-slate-700 mb-1">
          Notes <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="milestone-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Arrived at Tema port, awaiting customs clearance"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          maxLength={1000}
          disabled={uploading}
          aria-describedby="notes-count"
        />
        <p id="notes-count" className="text-xs text-slate-400 text-right mt-0.5">{notes.length}/1000</p>
      </div>

      {/* Geolocation */}
      <fieldset>
        <legend className="block text-sm font-medium text-slate-700 mb-1">
          Location <span className="text-slate-400 font-normal">(optional)</span>
        </legend>

        {location ? (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
            <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-green-800 font-medium">Location captured</p>
              <a
                href={mapPreviewUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-700 hover:underline font-mono"
                aria-label={`View on map: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
              >
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)} ↗
              </a>
            </div>
            <button
              type="button"
              onClick={clearLocation}
              className="text-xs text-green-700 hover:text-red-600 transition-colors"
              aria-label="Remove captured location"
              disabled={uploading}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={captureLocation}
            disabled={geoLoading || uploading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
            aria-busy={geoLoading}
          >
            {geoLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin text-brand-600" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Getting location…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Capture my location
              </>
            )}
          </button>
        )}

        {geoError && (
          <p role="alert" className="text-xs text-red-600 mt-1">{geoError}</p>
        )}
      </fieldset>

      {/* Photo Upload */}
      <div>
        <p className="block text-sm font-medium text-slate-700 mb-1" id="photos-label">
          Evidence Photos <span className="text-slate-400 font-normal">(optional, up to {MAX_FILES})</span>
        </p>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-brand-400 bg-brand-50'
              : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
          } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          aria-labelledby="photos-label"
          aria-describedby="photos-hint"
        >
          <input {...getInputProps()} aria-label="Upload evidence photos" />
          <svg className="mx-auto w-8 h-8 text-slate-400 mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75l6.75-6.75 6.75 6.75M3 3h18" />
          </svg>
          {isDragActive ? (
            <p className="text-sm text-brand-600 font-medium">Drop photos here…</p>
          ) : (
            <p className="text-sm text-slate-600">
              Drag & drop photos here, or <span className="text-brand-600 font-medium">browse</span>
            </p>
          )}
          <p id="photos-hint" className="text-xs text-slate-400 mt-1">JPEG or PNG · max 10 MB each</p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="Selected photos">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 bg-slate-50"
              >
                {/* Preview */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(file)}
                  alt={`Preview of ${file.name}`}
                  className="w-10 h-10 object-cover rounded flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  disabled={uploading}
                  className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded"
                  aria-label={`Remove ${file.name}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Upload progress */}
      {uploading && (
        <div aria-live="polite" aria-atomic="true">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
            <span>Uploading…</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-1.5" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="bg-brand-600 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={uploading}
          className="flex-1 rounded-lg bg-brand-600 text-white text-sm font-medium py-2.5 px-4 hover:bg-brand-700 disabled:opacity-60 transition-colors"
          aria-busy={uploading}
        >
          {uploading ? 'Recording…' : `Record ${MILESTONE_LABELS[milestoneType]}`}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 px-4 hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
