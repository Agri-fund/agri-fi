"use client";

import React, { useMemo, useState } from "react";

type SortDirection = "asc" | "desc";
type RowId = string | number;

export interface DataTableColumn<T> {
  key: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  exportValue?: (row: T) => string | number | null | undefined;
  className?: string;
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Array<DataTableColumn<T>>;
  getRowId: (row: T) => RowId;
  caption?: string;
  emptyMessage?: string;
  exportFileName?: string;
  selectable?: boolean;
  loading?: boolean;
  pageSize?: number;
  onSelectionChange?: (rows: T[]) => void;
}

function normalizeSortValue(value: string | number | Date | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return value.toLowerCase();
  return value ?? "";
}

function escapeCsv(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv<T>(fileName: string, columns: Array<DataTableColumn<T>>, rows: T[]) {
  const csvRows = [
    columns.map((column) => escapeCsv(column.header)).join(","),
    ...rows.map((row) =>
      columns
        .map((column) =>
          escapeCsv(
            column.exportValue
              ? column.exportValue(row)
              : String(column.accessor(row) ?? ""),
          ),
        )
        .join(","),
    ),
  ];

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  caption = "Data table",
  emptyMessage = "No records found",
  exportFileName = "table-export.csv",
  selectable = true,
  loading = false,
  pageSize = 10,
  onSelectionChange,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(columns[0]?.key ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<RowId>>(() => new Set());
  const [page, setPage] = useState(1);

  const sortedRows = useMemo(() => {
    const sortColumn = columns.find((column) => column.key === sortKey && column.sortValue);
    if (!sortColumn) return rows;

    return [...rows].sort((left, right) => {
      const a = normalizeSortValue(sortColumn.sortValue?.(left));
      const b = normalizeSortValue(sortColumn.sortValue?.(right));
      if (a < b) return sortDirection === "asc" ? -1 : 1;
      if (a > b) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [columns, rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visibleRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const selectedRows = sortedRows.filter((row) => selectedIds.has(getRowId(row)));
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedIds.has(getRowId(row)));

  function publishSelection(next: Set<RowId>) {
    setSelectedIds(next);
    onSelectionChange?.(rows.filter((row) => next.has(getRowId(row))));
  }

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) return;
    if (sortKey === column.key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDirection("asc");
    }
  }

  function toggleRow(row: T) {
    const next = new Set(selectedIds);
    const rowId = getRowId(row);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    publishSelection(next);
  }

  function toggleVisibleRows() {
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      visibleRows.forEach((row) => next.delete(getRowId(row)));
    } else {
      visibleRows.forEach((row) => next.add(getRowId(row)));
    }
    publishSelection(next);
  }

  React.useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: Math.min(pageSize, 5) }).map((_, index) => (
          <div key={index} className="h-12 rounded-lg skeleton" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {selectedRows.length > 0 ? `${selectedRows.length} selected` : `${rows.length} records`}
        </p>
        <button
          type="button"
          className="btn btn-sm border border-border text-foreground hover:bg-neutral-muted"
          onClick={() => downloadCsv(exportFileName, columns, selectedRows.length ? selectedRows : sortedRows)}
        >
          Export CSV
        </button>
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse" aria-label={caption}>
          <caption className="sr-only">{caption}</caption>
          <thead className="table-head">
            <tr>
              {selectable && (
                <th scope="col" className="table-th w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisibleRows}
                    aria-label="Select visible rows"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`table-th ${column.className ?? ""}`}
                  aria-sort={
                    sortKey === column.key
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left font-semibold disabled:cursor-default"
                    onClick={() => toggleSort(column)}
                    disabled={!column.sortValue}
                  >
                    {column.header}
                    {sortKey === column.key && <span aria-hidden="true">{sortDirection}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const rowId = getRowId(row);
              const selected = selectedIds.has(rowId);
              return (
                <tr key={rowId} className="table-row">
                  {selectable && (
                    <td className="table-td">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRow(row)}
                        aria-label={`Select row ${rowId}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={`table-td ${column.className ?? ""}`}>
                      {column.accessor(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {visibleRows.map((row) => {
          const rowId = getRowId(row);
          return (
            <div key={rowId} className="card p-4 space-y-3">
              {selectable && (
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(rowId)}
                    onChange={() => toggleRow(row)}
                  />
                  Select row
                </label>
              )}
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div key={column.key} className="flex items-start justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">{column.header}</span>
                    <span className="text-right text-foreground">{column.accessor(row)}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between gap-4" aria-label={`${caption} pagination`}>
          <button
            type="button"
            className="btn btn-sm border border-border"
            disabled={page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Prev
          </button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <button
            type="button"
            className="btn btn-sm border border-border"
            disabled={page === totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

export default DataTable;
