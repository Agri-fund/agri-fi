import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Deal } from "@/lib/api";

const COMPARISON_STORAGE_KEY = "agri-fi:deal-comparison";
const COMPARISON_URL_PARAM = "compare";

function formatRoi(value: number | null | undefined): string {
  return value == null ? "Not specified" : `${Number(value).toFixed(1)}%`;
}

function formatDuration(value: number | null | undefined): string {
  return value == null ? "Not specified" : `${value} days`;
}

function formatProgress(deal: Deal): string {
  const progress =
    deal.total_value > 0
      ? Math.min(
          (Number(deal.total_invested) / Number(deal.total_value)) * 100,
          100,
        )
      : 0;
  return `${progress.toFixed(1)}%`;
}

function formatCurrency(value: number | string | undefined): string {
  if (value === undefined || value === null) return "N/A";
  const num = typeof value === "string" ? Number(value) : value;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Generates CSV content from comparison table
 */
function generateComparisonCSV(deals: Deal[]): string {
  const rows = [
    ["Expected ROI", (deal: Deal) => formatRoi(deal.expected_roi)],
    ["Duration", (deal: Deal) => formatDuration(deal.duration_days)],
    ["Funding progress", (deal: Deal) => formatProgress(deal)],
    ["Risk rating", (deal: Deal) => deal.risk_rating ?? "Not specified"],
    ["Commodity", (deal: Deal) => deal.commodity],
    ["Total Value", (deal: Deal) => formatCurrency(deal.total_value)],
    ["Total Invested", (deal: Deal) => formatCurrency(deal.total_invested)],
  ] as const;

  const headers = ["Metric", ...deals.map((d) => d.commodity)];
  const lines = [headers.join(",")];

  for (const [label, getValue] of rows) {
    const values = [
      label,
      ...deals.map((deal) => {
        const value = getValue(deal);
        // Escape quotes in CSV
        return `"${value.replace(/"/g, '""')}"`;
      }),
    ];
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * Generates shareable URL with comparison IDs
 */
function generateShareLink(dealIds: string[], baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set(COMPARISON_URL_PARAM, dealIds.join(","));
  return url.toString();
}

/**
 * Parses comparison IDs from URL params
 */
function parseComparisonParams(compareParam: string | null): string[] {
  if (!compareParam) return [];
  return compareParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export default function DealComparison({
  deals,
  onRemove,
  onClear,
}: {
  deals: Deal[];
  onRemove: (dealId: string) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // Persist comparison to localStorage
  useEffect(() => {
    if (deals.length > 0) {
      try {
        localStorage.setItem(
          COMPARISON_STORAGE_KEY,
          JSON.stringify(deals.map((d) => d.id)),
        );
      } catch {
        // Silently fail if localStorage unavailable
      }
    } else {
      try {
        localStorage.removeItem(COMPARISON_STORAGE_KEY);
      } catch {
        // Silently fail
      }
    }
  }, [deals]);

  // Generate share link
  useEffect(() => {
    if (typeof window !== "undefined" && deals.length > 0) {
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      setShareUrl(
        generateShareLink(
          deals.map((d) => d.id),
          baseUrl,
        ),
      );
    }
  }, [deals]);

  const handleExportCSV = () => {
    const csv = generateComparisonCSV(deals);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `deal-comparison-${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (deals.length === 0) return null;

  const rows = [
    ["Expected ROI", (deal: Deal) => formatRoi(deal.expected_roi)],
    ["Duration", (deal: Deal) => formatDuration(deal.duration_days)],
    ["Funding progress", (deal: Deal) => formatProgress(deal)],
    ["Risk rating", (deal: Deal) => deal.risk_rating ?? "Not specified"],
    ["Commodity", (deal: Deal) => deal.commodity],
    ["Total Value", (deal: Deal) => formatCurrency(deal.total_value)],
    ["Total Invested", (deal: Deal) => formatCurrency(deal.total_invested)],
  ] as const;

  return (
    <section
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur"
      aria-label="Deal comparison"
    >
      <div className="mx-auto max-w-7xl overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="font-bold text-slate-900">
            Compare deals ({deals.length}/3)
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              title="Export comparison to CSV"
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              📥 Export CSV
            </button>
            <button
              type="button"
              onClick={handleCopyShareLink}
              title="Copy shareable link"
              className="inline-flex items-center gap-1 rounded bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-200"
            >
              {copied ? "✓ Copied" : "🔗 Share"}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              Clear all
            </button>
          </div>
        </div>
        <table className="w-full min-w-[640px] table-fixed text-left text-sm">
          <thead>
            <tr>
              <th className="w-36 pb-2 font-semibold text-slate-400">Metric</th>
              {deals.map((deal) => (
                <th
                  key={deal.id}
                  className="pb-2 pr-4 align-top font-semibold text-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/marketplace/${deal.id}`}
                      className="capitalize hover:text-brand-700"
                    >
                      {deal.commodity}
                    </Link>
                    <button
                      type="button"
                      onClick={() => onRemove(deal.id)}
                      aria-label={`Remove ${deal.commodity} from comparison`}
                      className="text-slate-400 hover:text-slate-900"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-t border-slate-100">
                <th className="py-2 font-medium text-slate-500">{label}</th>
                {deals.map((deal) => (
                  <td
                    key={deal.id}
                    className="py-2 pr-4 font-semibold text-slate-800"
                  >
                    {value(deal)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Export utilities for use in other components
export {
  COMPARISON_STORAGE_KEY,
  COMPARISON_URL_PARAM,
  generateComparisonCSV,
  generateShareLink,
  parseComparisonParams,
};
