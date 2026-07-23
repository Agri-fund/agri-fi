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
