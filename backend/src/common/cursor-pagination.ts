import { SelectQueryBuilder } from 'typeorm';

export interface CursorPaginationQuery {
  limit?: number;
  cursor?: string;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
}

export interface CursorPayload {
  id: string;
  sortValue?: unknown;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8'),
    ) as CursorPayload;
  } catch {
    return null;
  }
}

/**
 * Apply cursor-based pagination to a TypeORM query builder.
 *
 * Assumes the query is already filtered/joined. The alias for the id column
 * must be `${alias}.id`. Fetches limit+1 rows to determine hasMore.
 */
export async function applyCursorPagination<T extends { id: string }>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  options: {
    limit?: number;
    cursor?: string;
    sortField?: string;
    sortDir?: 'ASC' | 'DESC';
  },
): Promise<CursorPaginatedResult<T>> {
  const limit = Math.min(options.limit ?? 20, 100);
  const sortField = options.sortField ?? 'createdAt';
  const sortDir = options.sortDir ?? 'DESC';

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      const op = sortDir === 'DESC' ? '<' : '>';
      if (decoded.sortValue !== undefined) {
        qb.andWhere(
          `(${alias}.${sortField} ${op} :sortValue OR (${alias}.${sortField} = :sortValue AND ${alias}.id ${op} :cursorId))`,
          { sortValue: decoded.sortValue, cursorId: decoded.id },
        );
      } else {
        qb.andWhere(`${alias}.id ${op} :cursorId`, { cursorId: decoded.id });
      }
    }
  }

  qb.orderBy(`${alias}.${sortField}`, sortDir)
    .addOrderBy(`${alias}.id`, sortDir)
    .take(limit + 1);

  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor =
    hasMore && data.length > 0
      ? encodeCursor({
          id: data[data.length - 1].id,
          sortValue: (data[data.length - 1] as Record<string, unknown>)[
            sortField
          ],
        })
      : null;

  return {
    data,
    meta: { limit, hasMore, nextCursor, prevCursor: null },
  };
}

export function normalizeCursorQuery(query: CursorPaginationQuery): {
  limit: number;
  cursor?: string;
} {
  return {
    limit: Math.min(
      Number.isFinite(query.limit) && query.limit > 0 ? query.limit : 20,
      100,
    ),
    cursor: query.cursor,
  };
}
