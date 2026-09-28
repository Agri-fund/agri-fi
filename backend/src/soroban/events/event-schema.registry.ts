/**
 * Event Schema Registry for Soroban Smart Contracts
 * Standardizes event schemas across all 6 contracts with schema version v1.
 * Supports consistent naming: {contract}.{event}
 */

export interface EventFieldDefinition {
  name: string;
  type: string;
  description: string;
}

export interface ContractEventSchema {
  topic: string;
  contract: string;
  event: string;
  version: 'v1';
  description: string;
  fields: EventFieldDefinition[];
}

export interface StandardizedEventPayload {
  schemaTopic: string; // e.g. "farm_campaign.milestone_completed"
  contract: string;
  event: string;
  version: 'v1';
  contractId: string;
  transactionHash: string;
  ledger: number;
  data: Record<string, any>;
  rawEvent: any;
  timestamp: Date;
}

export const EVENT_SCHEMAS_V1: Record<string, ContractEventSchema> = {
  // 1. Escrow contract events
  'escrow.initialized': {
    topic: 'escrow.initialized',
    contract: 'escrow',
    event: 'initialized',
    version: 'v1',
    description: 'Emitted when escrow contract instance is initialized',
    fields: [
      { name: 'dealValue', type: 'i128', description: 'Total value committed to escrow' },
      { name: 'milestoneCount', type: 'u32', description: 'Number of defined milestone tranches' },
    ],
  },
  'escrow.funded': {
    topic: 'escrow.funded',
    contract: 'escrow',
    event: 'funded',
    version: 'v1',
    description: 'Emitted when funds are deposited into escrow',
    fields: [
      { name: 'contributor', type: 'Address', description: 'Address of funder' },
      { name: 'amount', type: 'i128', description: 'Amount deposited' },
    ],
  },
  'escrow.approved': {
    topic: 'escrow.approved',
    contract: 'escrow',
    event: 'approved',
    version: 'v1',
    description: 'Emitted when an escrow release or terms are approved by participants',
    fields: [
      { name: 'approver', type: 'Address', description: 'Approving party' },
      { name: 'approved', type: 'bool', description: 'Approval status' },
    ],
  },
  'escrow.milestone_completed': {
    topic: 'escrow.milestone_completed',
    contract: 'escrow',
    event: 'milestone_completed',
    version: 'v1',
    description: 'Emitted when an agricultural milestone is approved and verified',
    fields: [
      { name: 'milestoneId', type: 'u32', description: 'Sequential milestone identifier' },
      { name: 'completed', type: 'bool', description: 'Completion flag' },
    ],
  },
  'escrow.released': {
    topic: 'escrow.released',
    contract: 'escrow',
    event: 'released',
    version: 'v1',
    description: 'Emitted when escrow funds are released to the farmer',
    fields: [
      { name: 'recipient', type: 'Address', description: 'Farmer or recipient address' },
      { name: 'amount', type: 'i128', description: 'Amount released' },
    ],
  },
  'escrow.settled': {
    topic: 'escrow.settled',
    contract: 'escrow',
    event: 'settled',
    version: 'v1',
    description: 'Emitted when escrow completes final settlement',
    fields: [
      { name: 'totalFunded', type: 'i128', description: 'Total settlement amount disbursed' },
    ],
  },
  'escrow.compliance_halt': {
    topic: 'escrow.compliance_halt',
    contract: 'escrow',
    event: 'compliance_halt',
    version: 'v1',
    description: 'Emitted when compliance/sanctions screening flags an account or halts escrow',
    fields: [
      { name: 'flaggedAccount', type: 'Address', description: 'Account flagged by compliance' },
    ],
  },
  'escrow.refunded': {
    topic: 'escrow.refunded',
    contract: 'escrow',
    event: 'refunded',
    version: 'v1',
    description: 'Emitted when an investor receives a refund',
    fields: [
      { name: 'contributor', type: 'Address', description: 'Contributor refunded' },
      { name: 'amount', type: 'i128', description: 'Refunded amount' },
    ],
  },
  'escrow.frozen': {
    topic: 'escrow.frozen',
    contract: 'escrow',
    event: 'frozen',
    version: 'v1',
    description: 'Emitted when an account contribution is frozen pending review',
    fields: [
      { name: 'account', type: 'Address', description: 'Frozen account address' },
    ],
  },
  'escrow.unfrozen': {
    topic: 'escrow.unfrozen',
    contract: 'escrow',
    event: 'unfrozen',
    version: 'v1',
    description: 'Emitted when an account freeze is lifted',
    fields: [
      { name: 'account', type: 'Address', description: 'Unfrozen account address' },
    ],
  },
  'escrow.batch_refunded': {
    topic: 'escrow.batch_refunded',
    contract: 'escrow',
    event: 'batch_refunded',
    version: 'v1',
    description: 'Emitted when batch refund is executed for a canceled deal',
    fields: [
      { name: 'totalRefunded', type: 'i128', description: 'Total amount refunded across all contributors' },
    ],
  },

  // 2. Farm Campaign contract events
  'farm_campaign.initialized': {
    topic: 'farm_campaign.initialized',
    contract: 'farm_campaign',
    event: 'initialized',
    version: 'v1',
    description: 'Emitted upon campaign setup',
    fields: [
      { name: 'campaignId', type: 'String', description: 'Deal or campaign identifier' },
    ],
  },
  'farm_campaign.max_funding': {
    topic: 'farm_campaign.max_funding',
    contract: 'farm_campaign',
    event: 'max_funding',
    version: 'v1',
    description: 'Emitted when campaign funding cap is established',
    fields: [
      { name: 'maxFunding', type: 'i128', description: 'Cap in stroops/tokens' },
    ],
  },
  'farm_campaign.invested': {
    topic: 'farm_campaign.invested',
    contract: 'farm_campaign',
    event: 'invested',
    version: 'v1',
    description: 'Emitted when an investor contributes funds',
    fields: [
      { name: 'investor', type: 'Address', description: 'Investor address' },
      { name: 'amount', type: 'i128', description: 'Invested token amount' },
    ],
  },
  'farm_campaign.status_changed': {
    topic: 'farm_campaign.status_changed',
    contract: 'farm_campaign',
    event: 'status_changed',
    version: 'v1',
    description: 'Emitted when campaign state transitions',
    fields: [
      { name: 'newStatus', type: 'Symbol', description: 'New campaign status string' },
    ],
  },
  'farm_campaign.milestone_completed': {
    topic: 'farm_campaign.milestone_completed',
    contract: 'farm_campaign',
    event: 'milestone_completed',
    version: 'v1',
    description: 'Emitted when a milestone tranche is verified',
    fields: [
      { name: 'milestoneIndex', type: 'u32', description: 'Zero-indexed milestone number' },
      { name: 'trancheAmount', type: 'i128', description: 'Tranche capital unlocked' },
    ],
  },
  'farm_campaign.partial_released': {
    topic: 'farm_campaign.partial_released',
    contract: 'farm_campaign',
    event: 'partial_released',
    version: 'v1',
    description: 'Emitted when partial milestone funds are released',
    fields: [
      { name: 'dealId', type: 'String', description: 'Campaign deal ID' },
      { name: 'amountBps', type: 'u32', description: 'Basis points released' },
      { name: 'amount', type: 'i128', description: 'Raw amount released' },
    ],
  },
  'farm_campaign.revenue_distributed': {
    topic: 'farm_campaign.revenue_distributed',
    contract: 'farm_campaign',
    event: 'revenue_distributed',
    version: 'v1',
    description: 'Emitted when crop harvest proceeds are distributed to backers',
    fields: [
      { name: 'revenueAmount', type: 'i128', description: 'Total revenue disbursed' },
    ],
  },
  'farm_campaign.dispute_raised': {
    topic: 'farm_campaign.dispute_raised',
    contract: 'farm_campaign',
    event: 'dispute_raised',
    version: 'v1',
    description: 'Emitted when a participant raises an arbitration dispute',
    fields: [
      { name: 'milestoneIndex', type: 'u32', description: 'Disputed milestone' },
      { name: 'caller', type: 'Address', description: 'Dispute initiator' },
    ],
  },
  'farm_campaign.dispute_resolved': {
    topic: 'farm_campaign.dispute_resolved',
    contract: 'farm_campaign',
    event: 'dispute_resolved',
    version: 'v1',
    description: 'Emitted when arbitrator resolves a disputed milestone',
    fields: [
      { name: 'milestoneIndex', type: 'u32', description: 'Milestone resolved' },
      { name: 'approved', type: 'bool', description: 'Arbitration decision' },
    ],
  },
  'farm_campaign.arbitrator_updated': {
    topic: 'farm_campaign.arbitrator_updated',
    contract: 'farm_campaign',
    event: 'arbitrator_updated',
    version: 'v1',
    description: 'Emitted when designated arbitrator address changes',
    fields: [
      { name: 'newArbitrator', type: 'Address', description: 'New arbitrator address' },
    ],
  },
  'farm_campaign.refunded': {
    topic: 'farm_campaign.refunded',
    contract: 'farm_campaign',
    event: 'refunded',
    version: 'v1',
    description: 'Emitted when an investor claims a campaign refund',
    fields: [
      { name: 'investor', type: 'Address', description: 'Investor address' },
      { name: 'amount', type: 'i128', description: 'Refund amount' },
    ],
  },

  // 3. Farm Campaign Settlement contract events
  'farm_campaign_settlement.settlement_initiated': {
    topic: 'farm_campaign_settlement.settlement_initiated',
    contract: 'farm_campaign_settlement',
    event: 'settlement_initiated',
    version: 'v1',
    description: 'Emitted when settlement calculations commence',
    fields: [
      { name: 'campaignId', type: 'String', description: 'Campaign contract identifier' },
      { name: 'totalYield', type: 'i128', description: 'Audited crop harvest yield value' },
    ],
  },
  'farm_campaign_settlement.settlement_completed': {
    topic: 'farm_campaign_settlement.settlement_completed',
    contract: 'farm_campaign_settlement',
    event: 'settlement_completed',
    version: 'v1',
    description: 'Emitted when campaign funds and yields are fully distributed',
    fields: [
      { name: 'dealId', type: 'String', description: 'Trade deal or campaign ID' },
      { name: 'settlementAmount', type: 'i128', description: 'Total settlement amount' },
    ],
  },

  // 4. Marketplace Settlement contract events
  'marketplace_settlement.order_created': {
    topic: 'marketplace_settlement.order_created',
    contract: 'marketplace_settlement',
    event: 'order_created',
    version: 'v1',
    description: 'Emitted when an off-taker creates a produce purchase order',
    fields: [
      { name: 'orderId', type: 'u64', description: 'Unique order ID' },
      { name: 'buyer', type: 'Address', description: 'Buyer address' },
      { name: 'amount', type: 'i128', description: 'Committed purchase price' },
    ],
  },
  'marketplace_settlement.trade_settled': {
    topic: 'marketplace_settlement.trade_settled',
    contract: 'marketplace_settlement',
    event: 'trade_settled',
    version: 'v1',
    description: 'Emitted when delivery is confirmed and payment released to farmer',
    fields: [
      { name: 'orderId', type: 'u64', description: 'Settled order ID' },
      { name: 'total', type: 'i128', description: 'Disbursed payment' },
    ],
  },
  'marketplace_settlement.order_refunded': {
    topic: 'marketplace_settlement.order_refunded',
    contract: 'marketplace_settlement',
    event: 'order_refunded',
    version: 'v1',
    description: 'Emitted when an unfilled or canceled purchase order is returned',
    fields: [
      { name: 'orderId', type: 'u64', description: 'Canceled order ID' },
      { name: 'refundAmount', type: 'i128', description: 'Refunded sum' },
    ],
  },

  // 5. Project Factory contract events
  'project_factory.campaign_created': {
    topic: 'project_factory.campaign_created',
    contract: 'project_factory',
    event: 'campaign_created',
    version: 'v1',
    description: 'Emitted when a new farm campaign WASM instance is deployed',
    fields: [
      { name: 'dealId', type: 'String', description: 'Platform trade deal UUID' },
      { name: 'contractAddress', type: 'Address', description: 'Newly deployed contract address' },
    ],
  },
  'project_factory.project_registered': {
    topic: 'project_factory.project_registered',
    contract: 'project_factory',
    event: 'project_registered',
    version: 'v1',
    description: 'Emitted when metadata and farmer credentials are registered with the factory',
    fields: [
      { name: 'dealId', type: 'String', description: 'Deal UUID' },
      { name: 'farmer', type: 'Address', description: 'Farmer principal address' },
    ],
  },
  'project_factory.template_updated': {
    topic: 'project_factory.template_updated',
    contract: 'project_factory',
    event: 'template_updated',
    version: 'v1',
    description: 'Emitted when child campaign bytecode hash is upgraded',
    fields: [
      { name: 'wasmHash', type: 'BytesN<32>', description: 'New WASM hash' },
    ],
  },

  // 6. Revenue Distributor contract events
  'revenue_distributor.initialized': {
    topic: 'revenue_distributor.initialized',
    contract: 'revenue_distributor',
    event: 'initialized',
    version: 'v1',
    description: 'Emitted on distributor instantiation',
    fields: [
      { name: 'admin', type: 'Address', description: 'Admin address' },
    ],
  },
  'revenue_distributor.holder_registered': {
    topic: 'revenue_distributor.holder_registered',
    contract: 'revenue_distributor',
    event: 'holder_registered',
    version: 'v1',
    description: 'Emitted when a token holder balance is snapshotted',
    fields: [
      { name: 'holder', type: 'Address', description: 'Holder address' },
      { name: 'balance', type: 'i128', description: 'Recorded token balance' },
    ],
  },
  'revenue_distributor.revenue_distributed': {
    topic: 'revenue_distributor.revenue_distributed',
    contract: 'revenue_distributor',
    event: 'revenue_distributed',
    version: 'v1',
    description: 'Emitted when a dividend pool is deposited and made available for claim',
    fields: [
      { name: 'dealId', type: 'String', description: 'Originating deal ID' },
      { name: 'amount', type: 'i128', description: 'Total revenue pool' },
      { name: 'distributionCount', type: 'u32', description: 'Total recipients credited' },
    ],
  },
  'revenue_distributor.revenue_claimed': {
    topic: 'revenue_distributor.revenue_claimed',
    contract: 'revenue_distributor',
    event: 'revenue_claimed',
    version: 'v1',
    description: 'Emitted when an individual investor withdraws their dividend allotment',
    fields: [
      { name: 'holder', type: 'Address', description: 'Claiming investor' },
      { name: 'amount', type: 'i128', description: 'Amount transferred' },
    ],
  },
};

/**
 * Legacy to Standardized Schema mapping table.
 * Maps historical / un-namespaced topics to v1 standardized schema topics.
 */
export const LEGACY_EVENT_TOPIC_MAP: Record<string, string> = {
  // Legacy un-namespaced topics mapped by contract or topic name
  milestone_completed: 'farm_campaign.milestone_completed',
  milestone: 'escrow.milestone_completed',
  partial_release: 'farm_campaign.partial_released',
  funding_received: 'farm_campaign.invested',
  invested: 'farm_campaign.invested',
  campaign_status_changed: 'farm_campaign.status_changed',
  status_changed: 'farm_campaign.status_changed',
  settlement_completed: 'farm_campaign_settlement.settlement_completed',
  settled: 'marketplace_settlement.trade_settled',
  trade_settled: 'marketplace_settlement.trade_settled',
  order: 'marketplace_settlement.order_created',
  order_created: 'marketplace_settlement.order_created',
  revenue_distributed: 'revenue_distributor.revenue_distributed',
  reg_holder: 'revenue_distributor.holder_registered',
  campaign: 'project_factory.campaign_created',
  compliance_halt: 'escrow.compliance_halt',
  funded: 'escrow.funded',
  approve: 'escrow.approved',
  release: 'escrow.released',
  refund: 'escrow.refunded',
  frozen: 'escrow.frozen',
  unfrozen: 'escrow.unfrozen',
  batch_refund: 'escrow.batch_refunded',
};

/**
 * Normalizes raw Soroban contract event into a standardized event envelope
 */
export function normalizeContractEvent(
  rawEvent: {
    id: string;
    transactionHash: string;
    ledger: number;
    contractId: string;
    type?: string;
    topic?: string[];
    value?: Record<string, any>;
  },
  contractNameHint?: string,
): StandardizedEventPayload | null {
  const primaryTopic =
    (rawEvent.topic && rawEvent.topic.length > 0 ? rawEvent.topic[0] : null) ||
    rawEvent.type ||
    '';

  // Check if topic is already in standardized {contract}.{event} format
  let schemaTopic = primaryTopic;
  let schema = EVENT_SCHEMAS_V1[schemaTopic];

  // If not found directly, check legacy topic map
  if (!schema) {
    if (contractNameHint && EVENT_SCHEMAS_V1[`${contractNameHint}.${primaryTopic}`]) {
      schemaTopic = `${contractNameHint}.${primaryTopic}`;
      schema = EVENT_SCHEMAS_V1[schemaTopic];
    } else if (LEGACY_EVENT_TOPIC_MAP[primaryTopic]) {
      schemaTopic = LEGACY_EVENT_TOPIC_MAP[primaryTopic];
      schema = EVENT_SCHEMAS_V1[schemaTopic];
    }
  }

  if (!schema) {
    return null;
  }

  return {
    schemaTopic,
    contract: schema.contract,
    event: schema.event,
    version: 'v1',
    contractId: rawEvent.contractId,
    transactionHash: rawEvent.transactionHash,
    ledger: rawEvent.ledger,
    data: rawEvent.value || {},
    rawEvent,
    timestamp: new Date(),
  };
}
