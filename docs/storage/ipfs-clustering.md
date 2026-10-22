# IPFS Clustering and Storage Lifecycle

## Architecture

The backend uploads documents through `StorageService` to the configured `IPFS_GATEWAY`, preserving the existing CID and S3 fallback contract. After an upload, the service optionally requests pins from each configured IPFS Cluster REST API and Pinata. The content inventory in PostgreSQL records the CID, byte size, estimated replica count, retention state, verification time, access time, and retrieval latency. `IPFS_MIN_REPLICAS` is an enforcement threshold: if the upload provider plus successful configured pin services do not meet it, the IPFS upload fails and the existing S3 fallback is used.

Configure one IPFS Cluster REST API endpoint per independent cluster. IPFS Cluster's `replication-min` and `replication-max` control copies within each configured cluster. Pinata provides an independent pinning service. Configure credentials via secrets, not committed environment files. The existing gateway monitor remains responsible for gateway liveness; document reads also try `IPFS_GATEWAYS` in order and only return bytes that pass the stored CID check.

`IPFS_CDN_GATEWAY` optionally supplies the public URL returned for a CID. Reads use the service's verified gateway path, with a bounded in-process hot cache (100 entries, configurable TTL). The CDN must be configured to cache immutable `/ipfs/{cid}` objects and should respect the operator's privacy and jurisdiction requirements. The cache is process-local; it is not a durable replica.

## Verification and Operations

The scheduled verifier checks up to 100 oldest-updated inventory records every six hours. It fetches and verifies the document bytes against the CID, then requests pin repair when a check fails or the recorded replica count is below the configured target. A CID check detects corrupt or unavailable content, while a cluster re-pin asks IPFS to recover its blocks from available peers; it cannot reconstruct blocks that have disappeared from every provider.

`StorageService.getStorageAnalytics()` reports tracked bytes, configured-price monthly estimate, under-replicated and archived counts, unused inventory, retrieval count, and average retrieval time. Set `IPFS_COST_PER_GB_MONTH` to the blended provider price in the operator's billing currency. This estimate excludes request, egress, cluster hardware, CDN, S3 archive, and tax charges. `getCleanupCandidates(idleDays)` only identifies stale records; it never deletes data automatically. `archiveContent(cid)` verifies the CID, writes a copy to `ipfs-archive/{cid}` in S3, unpins configured IPFS providers, and retains the archive key in inventory. Archived reads are served from S3 and checked against the CID. Configure the S3 bucket's lifecycle transition to Glacier or another cold tier separately; archive objects use the bucket's normal write class.

New uploads are pinned automatically. To set retention, call `setRetentionPolicy(cid, retentionUntil, legalHold)`. Expired records without a legal hold are unpinned and removed from the inventory by the daily lifecycle task. `eraseContent(cid, overrideRetention)` is the explicit erasure operation; it refuses legal holds and unexpired retention unless the caller explicitly overrides retention. Configure `IPFS_UNPIN_ENDPOINT` for the upload provider's deletion API, and use Cluster and Pinata credentials where applicable. Erasure fails closed if no unpin provider is configured; a failed configured unpin prevents inventory deletion, leaving the operation retryable. Confirm completed deletions with provider-side controls.

## Compliance and Durability Limits

IPFS is content-addressed and public gateways, peers, and third-party caches may retain previously fetched bytes. Removing pins from configured providers does not guarantee global deletion, nor can this backend revoke copies downloaded by users. For regulated personal or confidential data, encrypt before upload, keep keys outside IPFS, select providers and regions under contract, and have counsel validate retention and erasure procedures. Use S3 or another controlled store when enforceable deletion is required.

Multiple replicas reduce dependence on a single node, but a 99.9% durability or availability figure is not guaranteed by configuration alone. Validate the independence and health of providers, monitor replica shortfalls and gateway retrieval metrics, test restores, and establish provider SLAs before making a regulatory or customer-facing guarantee. A single configured upload provider (`IPFS_MIN_REPLICAS=1`) is compatibility mode, not a redundant deployment.

## Configuration

See `backend/.env.example` for the supported settings:

- `IPFS_CLUSTER_APIS`, `IPFS_CLUSTER_USER`, `IPFS_CLUSTER_PASSWORD`
- `IPFS_CLUSTER_REPLICATION_MIN`, `IPFS_CLUSTER_REPLICATION_MAX`, `IPFS_MIN_REPLICAS`
- `PINATA_JWT`, `IPFS_UNPIN_ENDPOINT`
- `IPFS_GATEWAYS`, `IPFS_CDN_GATEWAY`, `IPFS_HOT_CACHE_TTL_SECONDS`
- `IPFS_COST_PER_GB_MONTH`

Apply the `CreateStorageContent` database migration before deploying the new storage service. Existing documents are not automatically backfilled into the inventory; they are tracked when uploaded or explicitly pinned through `pinContent(cid)`. Until backfilled, they are not included in inventory analytics or scheduled verification.
