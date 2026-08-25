'use client';

import { useCallback, useState, useRef, type ReactNode } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_PARALLEL = 3;
const MAX_RETRIES = 3;

const ACCEPTED_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'video/mp4': ['.mp4'],
};
const ACCEPTED_LABELS = 'PDF, PNG, JPG, MP4';

interface UploadProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  progress: number; // 0-100
  status: 'uploading' | 'assembling' | 'complete' | 'error';
  error?: string;
}

interface ChunkedUploadProps {
  docType: string;
  tradeDealId: string;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  label?: ReactNode;
  hint?: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChunkedUpload({
  docType,
  tradeDealId,
  onComplete,
  onError,
  disabled = false,
  label,
  hint,
}: ChunkedUploadProps) {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const activeUploads = useRef<Map<string, AbortController>>(new Map());

  const uploadChunk = async (
    fileId: string,
    chunk: Blob,
    chunkIndex: number,
    totalChunks: number,
    signal?: AbortSignal,
  ): Promise<any> => {
    const formData = new FormData();
    formData.append('chunk', chunk, `chunk-${chunkIndex}`);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('totalChunks', String(totalChunks));
    formData.append('docType', docType);
    formData.append('tradeDealId', tradeDealId);

    const token = localStorage.getItem('auth_token');
    const res = await fetch('http://localhost:3001/v1/documents/upload-chunk', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Chunk ${chunkIndex} upload failed`);
    }

    return res.json();
  };

  const uploadFile = async (file: File) => {
    const fileId = generateFileId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    setUploads((prev) => [
      ...prev,
      { fileId, fileName: file.name, fileSize: file.size, mimeType: file.type, progress: 0, status: 'uploading' },
    ]);

    const abortController = new AbortController();
    activeUploads.current.set(fileId, abortController);

    try {
      // Upload chunks with limited parallelism
      let completedChunks = 0;

      for (let start = 0; start < totalChunks; start += MAX_PARALLEL) {
        const batch = [];
        for (let i = start; i < Math.min(start + MAX_PARALLEL, totalChunks); i++) {
          const from = i * CHUNK_SIZE;
          const to = Math.min(from + CHUNK_SIZE, file.size);
          const chunk = file.slice(from, to);

          let retries = 0;
          const uploadWithRetry = async (): Promise<any> => {
            try {
              return await uploadChunk(fileId, chunk, i, totalChunks, abortController.signal);
            } catch (err: any) {
              if (err.name === 'AbortError') throw err;
              if (retries < MAX_RETRIES) {
                retries++;
                await new Promise((r) => setTimeout(r, 1000 * retries));
                return uploadWithRetry();
              }
              throw err;
            }
          };

          batch.push(
            uploadWithRetry().then((result) => {
              completedChunks++;
              const progress = Math.round((completedChunks / totalChunks) * 100);
              setUploads((prev) =>
                prev.map((u) => (u.fileId === fileId ? { ...u, progress } : u)),
              );
              return result;
            }),
          );
        }

        await Promise.all(batch);
      }

      // Assemble chunks on server
      setUploads((prev) =>
        prev.map((u) => (u.fileId === fileId ? { ...u, status: 'assembling', progress: 100 } : u)),
      );

      const token = localStorage.getItem('auth_token');
      const res = await fetch('http://localhost:3001/v1/documents/upload-complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fileId,
          docType,
          tradeDealId,
          fileName: file.name,
          mimeType: file.type,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to assemble chunks');
      }

      const result = await res.json();

      setUploads((prev) =>
        prev.map((u) => (u.fileId === fileId ? { ...u, status: 'complete' } : u)),
      );

      onComplete?.(result);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setUploads((prev) => prev.filter((u) => u.fileId !== fileId));
        return;
      }

      const message = err.message || 'Upload failed';
      setUploads((prev) =>
        prev.map((u) =>
          u.fileId === fileId ? { ...u, status: 'error', error: message } : u,
        ),
      );
      onError?.(message);
    } finally {
      activeUploads.current.delete(fileId);
    }
  };

  const cancelUpload = (fileId: string) => {
    activeUploads.current.get(fileId)?.abort();
    activeUploads.current.delete(fileId);
    setUploads((prev) => prev.filter((u) => u.fileId !== fileId));
  };

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setUploadError(null);

      if (rejected.length > 0) {
        const first = rejected[0];
        const code = first.errors[0]?.code;
        if (code === 'file-too-large') {
          setUploadError(`File is too large. Maximum size is 100 MB.`);
        } else if (code === 'file-invalid-type') {
          setUploadError(`Unsupported file type. Please upload ${ACCEPTED_LABELS}.`);
        } else {
          setUploadError(first.errors[0]?.message ?? 'Invalid file.');
        }
        return;
      }

      accepted.forEach((file) => uploadFile(file));
    },
    [docType, tradeDealId],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME,
    maxSize: MAX_FILE_SIZE,
    multiple: true,
    disabled,
  });

  const borderColor = isDragReject || uploadError
    ? 'border-red-400 bg-red-50'
    : isDragActive
    ? 'border-emerald-500 bg-emerald-50'
    : 'border-slate-300 hover:border-emerald-400 bg-white hover:bg-emerald-50/30';

  return (
    <div className="space-y-3">
      {label && <label className="text-sm font-semibold text-slate-700">{label}</label>}

      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${borderColor} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />

        {isDragActive && !isDragReject ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl">📂</span>
            <p className="text-sm font-semibold text-emerald-600">Drop files here!</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl">
              ⬆️
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">
                Drag &amp; drop or{' '}
                <span className="text-emerald-600 underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {ACCEPTED_LABELS} · max 100 MB · chunked upload
              </p>
            </div>
          </div>
        )}
      </div>

      {uploadError && (
        <p role="alert" className="text-xs text-red-600 font-medium flex items-center gap-1">
          <span>⚠</span> {uploadError}
        </p>
      )}

      {hint && !uploadError && <p className="text-xs text-slate-500">{hint}</p>}

      {/* Upload queue */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload) => (
            <div
              key={upload.fileId}
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{upload.fileName}</p>
                <p className="text-xs text-slate-500">{humanSize(upload.fileSize)}</p>

                {upload.status === 'uploading' && (
                  <div className="mt-1.5 w-full bg-slate-100 rounded-full h-1.5">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                )}

                {upload.status === 'assembling' && (
                  <p className="text-xs text-blue-600 mt-1">Assembling chunks...</p>
                )}

                {upload.status === 'complete' && (
                  <p className="text-xs text-emerald-600 mt-1">Upload complete</p>
                )}

                {upload.status === 'error' && (
                  <p className="text-xs text-red-600 mt-1">{upload.error}</p>
                )}
              </div>

              {upload.status === 'uploading' && (
                <button
                  type="button"
                  onClick={() => cancelUpload(upload.fileId)}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Cancel
                </button>
              )}

              {(upload.status === 'complete' || upload.status === 'error') && (
                <button
                  type="button"
                  onClick={() => setUploads((prev) => prev.filter((u) => u.fileId !== upload.fileId))}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
