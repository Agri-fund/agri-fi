export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export function normalizePagination(query: PaginationQuery): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Number.isFinite(query.page) && query.page > 0 ? query.page : 1;
  const requestedLimit =
    Number.isFinite(query.limit) && query.limit > 0 ? query.limit : 20;
  const limit = Math.min(requestedLimit, 100);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

export function toPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export interface CursorPaginationQuery {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  meta: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export function encodeCursor(value: string | Date | number): string {
  const strVal = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(strVal).toString('base64');
}

export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    return cursor;
  }
}

