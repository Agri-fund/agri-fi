// Issue #863 — Deal update timeline: activity feed for investors

export type ActivityEventType =
  | 'investor_joined'
  | 'shipment_milestone'
  | 'funding_target_met'
  | 'payment_distributed'
  | 'document_uploaded'
  | 'deal_status_changed';

export interface ActivityEventDto {
  id: string;
  type: ActivityEventType;
  description: string;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** Optional supplemental metadata (photo URL, new status, etc.) */
  meta: Record<string, unknown>;
}

export interface ActivityFeedResponseDto {
  events: ActivityEventDto[];
  /** Opaque cursor to pass to the next page request; null when no more pages */
  nextCursor: string | null;
  total: number;
}
