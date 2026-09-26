# Prometheus Retention Tuning & Thanos/Cortex Remote-Write Architecture

## 1. Overview
In standard single-node deployments, Prometheus retains metrics locally in its Time Series Database (TSDB). If a pod is rescheduled or local volume storage is recycled, historical metrics may be truncated. 

To ensure high data durability, cost efficiency, and fast dashboard rendering across long time horizons, Agri-Fi employs a hybrid metrics architecture:
1. **Local Prometheus TSDB**: Retains recent high-resolution metrics (15–30 days) locally for real-time alerting, local scraping, and short-term operational dashboards.
2. **Remote-Write Mirror (Thanos / Cortex / Grafana Cloud)**: Simultaneously streams time-series data via Prometheus `remote_write` to an object-storage backed long-term metrics backend.

---

## 2. Retention Policy Configuration

### Local TSDB Tuning
Prometheus is configured with explicit retention time, retention size limits, and 2-hour TSDB block durations for smooth compactions:
- `--storage.tsdb.retention.time=30d`: Guarantees 30 days of high-resolution metric retention on local volume.
- `--storage.tsdb.retention.size=10GB`: Enforces a safety ceiling on disk consumption to prevent out-of-disk crashes.
- `--storage.tsdb.min-block-duration=2h` & `--storage.tsdb.max-block-duration=2h`: Produces regular 2-hour TSDB blocks, ideal for Thanos sidecar shipping and compaction.

### Remote-Write Queue Configuration
In `devops/prometheus/prometheus.yml`, metrics are mirrored upstream with optimized queueing:
```yaml
remote_write:
  - url: http://thanos-receive:19291/api/v1/receive
    remote_timeout: 30s
    queue_config:
      capacity: 10000
      max_shards: 10
      min_shards: 1
      max_samples_per_send: 2000
      batch_send_deadline: 5s
      min_backoff: 100ms
      max_backoff: 5s
    metadata_config:
      send: true
      send_interval: 1m
```

---

## 3. Grafana Datasource Federation

Grafana is provisioned with two datasources:
- **`Prometheus (Local)` (`uid: prometheus`)**: Default datasource for operational dashboards (<30d) and instant queries.
- **`Thanos (Long-Term)` (`uid: thanos-cortex`)**: Queries the Thanos Query / Cortex endpoint for year-over-year analytics and multi-month historical trends.

---

## 4. Cost and Resource Management
- **Storage Tiering**: Local NVMe/EBS storage is minimized to 30 days; long-term data lives in S3/GCS object storage via Thanos, reducing storage costs by >85%.
- **Network Compression**: Remote-write uses Snappy compression and Protobuf batches, minimizing inter-VPC bandwidth overhead.
- **Deduplication**: In multi-replica setups, Thanos Query automatically deduplicates metrics from duplicate Prometheus instances based on `replica` and `cluster` labels.
