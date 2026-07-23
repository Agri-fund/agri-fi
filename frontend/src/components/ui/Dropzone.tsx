'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};
const ACCEPTED_LABELS = 'PDF, PNG, JPG';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DropzoneFile {
  file: File;
  /** Object URL for image previews; null for PDFs */
  previewUrl: string | null;
  /** Number of pages detected for PDFs (always 1 for images) */
  pageCount: number | null;
}

interface DropzoneProps {
  /** Called when a valid file is accepted */
  onFileAccepted: (entry: DropzoneFile) => void;
  /** Label shown above the dropzone */
  label?: ReactNode;
  /** Optional hint text below the label */
  hint?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Currently accepted file (controlled) */
  value?: DropzoneFile | null;
  /** Called when the user removes the current file */
  onRemove?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Attempt to read the PDF page count from the cross-origin-safe binary header. */
async function getPdfPageCount(file: File): Promise<number> {
  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('latin1').decode(buffer);
    const matches = [...text.matchAll(/\/Type\s*\/Page[^s]/g)];
    return matches.length > 0 ? matches.length : 1;
  } catch {
    return 1;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function Dropzone({
  onFileAccepted,
  label,
  hint,
  disabled = false,
  value,
  onRemove,
}: DropzoneProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setUploadError(null);

      try {
        const isPdf = file.type === 'application/pdf';
        const previewUrl = isPdf ? null : URL.createObjectURL(file);
        const pageCount = isPdf ? await getPdfPageCount(file) : null;

        onFileAccepted({ file, previewUrl, pageCount });
      } finally {
        setLoading(false);
      }
    },
    [onFileAccepted],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setUploadError(null);

      if (rejected.length > 0) {
        const first = rejected[0];
        const code = first.errors[0]?.code;
        if (code === 'file-too-large') {
          setUploadError(`File is too large. Maximum size is 5 MB.`);
        } else if (code === 'file-invalid-type') {
          setUploadError(`Unsupported file type. Please upload ${ACCEPTED_LABELS}.`);
        } else {
          setUploadError(first.errors[0]?.message ?? 'Invalid file.');
        }
        return;
      }

      if (accepted.length > 0) {
        processFile(accepted[0]);
      }
    },
    [processFile],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME,
    maxSize: MAX_SIZE_BYTES,
    multiple: false,
    disabled: disabled || loading,
  });

  // ── Render: file already selected ────────────────────────────────────────

  if (value) {
    const isPdf = value.file.type === 'application/pdf';

    return (
      <div className="space-y-1.5">
        {label && <label className="label">{label}</label>}

        <div className="flex items-center gap-4 p-4 rounded-xl border-2 border-primary/30 bg-primary-muted/30">
          {/* Preview */}
          {isPdf ? (
            <div className="w-14 h-14 rounded-lg bg-red-50 border border-red-200 flex flex-col items-center justify-center flex-shrink-0">
              <span className="text-red-600 text-lg leading-none">📄</span>
              {value.pageCount !== null && (
                <span className="text-[10px] text-red-500 font-semibold mt-0.5">
                  {value.pageCount}p
                </span>
              )}
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.previewUrl!}
              alt="Preview"
              className="w-14 h-14 rounded-lg object-cover border border-border flex-shrink-0"
            />
          )}

          {/* File info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{value.file.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {humanSize(value.file.size)}
              {isPdf && value.pageCount !== null && ` · ${value.pageCount} page${value.pageCount !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Remove */}
          {onRemove && !disabled && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove file"
              className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-slate-400 transition-colors text-xs font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {hint && <p className="label-hint">{hint}</p>}
      </div>
    );
  }

  // ── Render: dropzone ──────────────────────────────────────────────────────

  const borderColor = isDragReject || uploadError
    ? 'border-red-400 bg-red-50'
    : isDragActive
    ? 'border-primary bg-primary-muted/40'
    : 'border-border hover:border-primary/50 bg-surface hover:bg-primary-muted/20';

  return (
    <div className="space-y-1.5">
      {label && <label className="label">{label}</label>}

      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${borderColor} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        aria-label={typeof label === 'string' ? label : 'File upload dropzone'}
      >
        <input {...getInputProps()} aria-label={typeof label === 'string' ? label : 'Upload file'} />

        {loading ? (
          /* Upload spinner */
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground font-medium">Processing…</p>
          </div>
        ) : isDragActive && !isDragReject ? (
          /* Drag-over state */
          <div className="flex flex-col items-center gap-2">
            <span className="text-3xl">📂</span>
            <p className="text-sm font-semibold text-primary">Drop it here!</p>
          </div>
        ) : (
          /* Idle state */
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-primary-muted flex items-center justify-center text-2xl">
              ⬆️
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Drag &amp; drop or{' '}
                <span className="text-primary underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {ACCEPTED_LABELS} · max 5 MB
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {uploadError && (
        <p role="alert" className="text-xs text-red-600 font-medium flex items-center gap-1 mt-1">
          <span>⚠</span> {uploadError}
        </p>
      )}

      {hint && !uploadError && <p className="label-hint">{hint}</p>}
    </div>
  );
}
