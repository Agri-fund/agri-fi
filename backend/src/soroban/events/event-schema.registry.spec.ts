import {
  EVENT_SCHEMAS_V1,
  LEGACY_EVENT_TOPIC_MAP,
  normalizeContractEvent,
} from './event-schema.registry';

describe('Event Schema Registry (Issue #1082)', () => {
  const expectedContracts = [
    'escrow',
    'farm_campaign',
    'farm_campaign_settlement',
    'marketplace_settlement',
    'project_factory',
    'revenue_distributor',
  ];

  it('defines standardized v1 schemas for all 6 contracts', () => {
    const presentContracts = new Set<string>();
    for (const schema of Object.values(EVENT_SCHEMAS_V1)) {
      expect(schema.version).toBe('v1');
      expect(schema.topic).toBe(`${schema.contract}.${schema.event}`);
      expect(Array.isArray(schema.fields)).toBe(true);
      expect(schema.fields.length).toBeGreaterThan(0);
      presentContracts.add(schema.contract);
    }

    for (const contract of expectedContracts) {
      expect(presentContracts.has(contract)).toBe(true);
    }
    expect(presentContracts.size).toBe(6);
  });

  it('correctly normalizes a modern standardized event {contract}.{event}', () => {
    const raw = {
      id: 'evt-1',
      transactionHash: 'txhash123',
      ledger: 100,
      contractId: 'C_ESCROW_1',
      type: 'escrow.funded',
      topic: ['escrow.funded'],
      value: { contributor: 'GABCD', amount: 5000 },
    };

    const normalized = normalizeContractEvent(raw);
    expect(normalized).not.toBeNull();
    expect(normalized?.schemaTopic).toBe('escrow.funded');
    expect(normalized?.contract).toBe('escrow');
    expect(normalized?.event).toBe('funded');
    expect(normalized?.version).toBe('v1');
    expect(normalized?.data.amount).toBe(5000);
  });

  it('backwards-compatibly normalizes legacy un-namespaced topics', () => {
    const rawLegacy = {
      id: 'evt-legacy-1',
      transactionHash: 'txhash456',
      ledger: 101,
      contractId: 'C_CAMPAIGN_1',
      type: 'milestone_completed',
      topic: ['milestone_completed'],
      value: { dealId: 'deal-uuid-1', milestoneIndex: 2 },
    };

    const normalized = normalizeContractEvent(rawLegacy);
    expect(normalized).not.toBeNull();
    expect(normalized?.schemaTopic).toBe('farm_campaign.milestone_completed');
    expect(normalized?.contract).toBe('farm_campaign');
    expect(normalized?.event).toBe('milestone_completed');
    expect(normalized?.data.dealId).toBe('deal-uuid-1');
  });

  it('normalizes legacy event with contract hint when ambiguous', () => {
    const rawOrder = {
      id: 'evt-order',
      transactionHash: 'txhash789',
      ledger: 102,
      contractId: 'C_SETTLE_1',
      type: 'order_created',
      topic: ['order_created'],
      value: { orderId: '12', amount: 9999 },
    };

    const normalized = normalizeContractEvent(rawOrder, 'marketplace_settlement');
    expect(normalized).not.toBeNull();
    expect(normalized?.schemaTopic).toBe('marketplace_settlement.order_created');
  });
});
