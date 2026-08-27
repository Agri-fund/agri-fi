import {
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type SearchResultType = 'deals' | 'farmers' | 'documents';

export interface SearchResultItem {
  id: string;
  type: SearchResultType;
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface UnifiedSearchResponse {
  deals: SearchResultItem[];
  farmers: SearchResultItem[];
  documents: SearchResultItem[];
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TRGM_THRESHOLD = 0.3;

@Injectable()
export class SearchService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async search(
    query: string,
    types: SearchResultType[] = ['deals', 'farmers', 'documents'],
    limit = DEFAULT_LIMIT,
  ): Promise<UnifiedSearchResponse> {
    const trimmed = query?.trim();
    if (!trimmed || trimmed.length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const tsQuery = this.buildTsQuery(trimmed);

    const response: UnifiedSearchResponse = {
      deals: [],
      farmers: [],
      documents: [],
    };

    if (types.includes('deals')) {
      response.deals = await this.searchDeals(tsQuery, trimmed, safeLimit);
    }
    if (types.includes('farmers')) {
      response.farmers = await this.searchFarmers(tsQuery, trimmed, safeLimit);
    }
    if (types.includes('documents')) {
      response.documents = await this.searchDocuments(tsQuery, trimmed, safeLimit);
    }

    return response;
  }

  /** Builds a safe tsquery string from user input. */
  buildTsQuery(input: string): string {
    const tokens = input
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) {
      throw new BadRequestException('Invalid search query');
    }
    return tokens.map((t) => `${t}:*`).join(' & ');
  }

  private async searchDeals(
    tsQuery: string,
    rawQuery: string,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        d.id,
        COALESCE(d.title, d.commodity) AS title,
        d.commodity,
        d.status,
        GREATEST(
          ts_rank(d.search_vector, to_tsquery('english', $1)),
          similarity(COALESCE(d.commodity, ''), $2)
        ) AS score,
        ts_headline(
          'english',
          COALESCE(d.description, d.commodity),
          to_tsquery('english', $1),
          'MaxWords=20, MinWords=5, StartSel=<b>, StopSel=</b>'
        ) AS snippet
      FROM trade_deals d
      WHERE d.deleted_at IS NULL
        AND (
          d.search_vector @@ to_tsquery('english', $1)
          OR similarity(COALESCE(d.commodity, ''), $2) > $3
          OR similarity(COALESCE(d.title, ''), $2) > $3
        )
      ORDER BY score DESC
      LIMIT $4
      `,
      [tsQuery, rawQuery, TRGM_THRESHOLD, limit],
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: 'deals' as const,
      title: row.title as string,
      snippet: (row.snippet as string) || (row.commodity as string),
      score: parseFloat(String(row.score)),
      metadata: { status: row.status, commodity: row.commodity },
    }));
  }

  private async searchFarmers(
    tsQuery: string,
    rawQuery: string,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        u.id,
        COALESCE(u.full_name, u.email) AS title,
        u.email,
        u.role,
        GREATEST(
          ts_rank(u.search_vector, to_tsquery('english', $1)),
          similarity(COALESCE(u.full_name, ''), $2),
          similarity(COALESCE(u.company_details->>'companyName', ''), $2)
        ) AS score,
        ts_headline(
          'english',
          COALESCE(u.full_name, '') || ' ' || COALESCE(u.company_details->>'companyName', ''),
          to_tsquery('english', $1),
          'MaxWords=20, MinWords=5, StartSel=<b>, StopSel=</b>'
        ) AS snippet
      FROM users u
      WHERE u.role IN ('farmer', 'trader')
        AND (
          u.search_vector @@ to_tsquery('english', $1)
          OR similarity(COALESCE(u.full_name, ''), $2) > $3
          OR similarity(COALESCE(u.company_details->>'companyName', ''), $2) > $3
        )
      ORDER BY score DESC
      LIMIT $4
      `,
      [tsQuery, rawQuery, TRGM_THRESHOLD, limit],
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: 'farmers' as const,
      title: row.title as string,
      snippet: (row.snippet as string) || (row.email as string),
      score: parseFloat(String(row.score)),
      metadata: { email: row.email, role: row.role },
    }));
  }

  private async searchDocuments(
    tsQuery: string,
    rawQuery: string,
    limit: number,
  ): Promise<SearchResultItem[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        doc.id,
        COALESCE(doc.title, doc.doc_type) AS title,
        doc.doc_type,
        doc.trade_deal_id,
        GREATEST(
          ts_rank(doc.search_vector, to_tsquery('english', $1)),
          similarity(COALESCE(doc.title, ''), $2)
        ) AS score,
        ts_headline(
          'english',
          COALESCE(doc.title, doc.doc_type),
          to_tsquery('english', $1),
          'MaxWords=20, MinWords=5, StartSel=<b>, StopSel=</b>'
        ) AS snippet
      FROM documents doc
      WHERE
        doc.search_vector @@ to_tsquery('english', $1)
        OR similarity(COALESCE(doc.title, ''), $2) > $3
      ORDER BY score DESC
      LIMIT $4
      `,
      [tsQuery, rawQuery, TRGM_THRESHOLD, limit],
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: 'documents' as const,
      title: row.title as string,
      snippet: (row.snippet as string) || (row.doc_type as string),
      score: parseFloat(String(row.score)),
      metadata: { docType: row.doc_type, tradeDealId: row.trade_deal_id },
    }));
  }
}
