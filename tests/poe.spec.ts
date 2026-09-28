import {
  computeDocumentHash,
  createDualPoeAnchor,
  verifyDualPoeAnchor,
  fetchFromIpfs,
} from '../scripts/poe';

describe('Cross-Chain PoE Attestation Service (Issue #1081)', () => {
  const sampleDocument = Buffer.from(
    'Agri-Fi Warehouse Storage Inspection Certificate - Grade A Maize - Deal #4912',
    'utf8',
  );

  it('performs dual anchoring (chain + IPFS + opt-in external registry)', async () => {
    const mockStorage = new Map<string, Buffer>();
    const receipt = await createDualPoeAnchor(sampleDocument, {
      filename: 'inspection-certificate.pdf',
      submitToRegistry: true,
      mockStorage,
    });

    expect(receipt.documentHash).toHaveLength(64);
    expect(receipt.documentHash).toBe(computeDocumentHash(sampleDocument));
    expect(receipt.ipfsCid).toMatch(/^Qm/);
    expect(receipt.ipfsUri).toContain(receipt.ipfsCid);
    expect(receipt.stellarTxId).toHaveLength(64);
    expect(receipt.registryStatus).toBe('SUBMITTED');
    expect(receipt.registryAttestationId).toBeDefined();
    expect(receipt.metadata.byteSize).toBe(sampleDocument.length);
  });

  it('read path verifies both on-chain anchor and IPFS document agree', async () => {
    const mockStorage = new Map<string, Buffer>();
    const receipt = await createDualPoeAnchor(sampleDocument, {
      mockStorage,
    });

    const verification = await verifyDualPoeAnchor(
      receipt.documentHash,
      receipt.ipfsCid,
      { mockStorage },
    );

    expect(verification.verified).toBe(true);
    expect(verification.hashMatch).toBe(true);
    expect(verification.chainAnchorVerified).toBe(true);
    expect(verification.retrievedByteLength).toBe(sampleDocument.length);
    expect(verification.reasons.length).toBe(0);
  });

  it('detects corrupted or tampered documents on read path', async () => {
    const mockStorage = new Map<string, Buffer>();
    const receipt = await createDualPoeAnchor(sampleDocument, {
      mockStorage,
    });

    // Tamper with IPFS payload
    mockStorage.set(receipt.ipfsCid, Buffer.from('TAMPERED FRAUDULENT DOCUMENT', 'utf8'));

    const verification = await verifyDualPoeAnchor(
      receipt.documentHash,
      receipt.ipfsCid,
      { mockStorage },
    );

    expect(verification.verified).toBe(false);
    expect(verification.hashMatch).toBe(false);
    expect(verification.reasons.some((r) => r.includes('does not match expected hash'))).toBe(true);
  });

  it('handles IPFS retrieval failure gracefully', async () => {
    const mockStorage = new Map<string, Buffer>(); // empty mock storage

    const verification = await verifyDualPoeAnchor(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'QmNonExistentCid123456789',
      { mockStorage, fetchTimeoutMs: 100 },
    );

    expect(verification.verified).toBe(false);
    expect(verification.hashMatch).toBe(false);
    expect(verification.reasons.some((r) => r.includes('Could not retrieve document from IPFS'))).toBe(true);
  });

  it('tolerates optional registry failure without aborting dual anchor', async () => {
    const mockStorage = new Map<string, Buffer>();
    const receipt = await createDualPoeAnchor(sampleDocument, {
      mockStorage,
      submitToRegistry: false,
    });

    expect(receipt.documentHash).toBeDefined();
    expect(receipt.stellarTxId).toBeDefined();
    expect(receipt.ipfsCid).toBeDefined();
    expect(receipt.registryStatus).toBe('SKIPPED');
  });
});
