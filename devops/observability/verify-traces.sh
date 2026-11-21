#!/usr/bin/env bash
# Verify that traces flow collector -> Jaeger -> Elasticsearch and are durable (#1308).
#
#   ./devops/observability/verify-traces.sh            # emit + query a test trace
#   ./devops/observability/verify-traces.sh --restart  # also restart Jaeger and re-query
#                                                      # (docker compose only)
#
# Env overrides:
#   OTLP_HTTP_URL  (default http://localhost:4318)
#   JAEGER_URL     (default http://localhost:16686)
#   ES_URL         (default http://localhost:9200)
set -euo pipefail

OTLP_HTTP_URL="${OTLP_HTTP_URL:-http://localhost:4318}"
JAEGER_URL="${JAEGER_URL:-http://localhost:16686}"
ES_URL="${ES_URL:-http://localhost:9200}"
SERVICE="trace-durability-check"

TRACE_ID="$(openssl rand -hex 16)"
SPAN_ID="$(openssl rand -hex 8)"
NOW_NS="$(date +%s)000000000"

echo "→ Emitting test trace ${TRACE_ID} via ${OTLP_HTTP_URL}"
curl -fsS -X POST "${OTLP_HTTP_URL}/v1/traces" -H 'Content-Type: application/json' -d @- <<JSON >/dev/null
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"${SERVICE}"}}]},
 "scopeSpans":[{"scope":{"name":"verify-traces"},"spans":[{"traceId":"${TRACE_ID}","spanId":"${SPAN_ID}",
 "name":"durability-check","kind":1,"startTimeUnixNano":"${NOW_NS}","endTimeUnixNano":"${NOW_NS}"}]}]}]}
JSON

find_trace() {
  curl -fsS "${JAEGER_URL}/api/traces/${TRACE_ID}" | grep -q "\"traceID\":\"${TRACE_ID}\""
}

echo "→ Waiting for the trace to appear in the Jaeger API"
for _ in $(seq 1 30); do
  if find_trace; then FOUND=1; break; fi
  sleep 2
done
[ "${FOUND:-0}" = 1 ] || { echo "✗ trace not found in Jaeger"; exit 1; }
echo "✓ trace is queryable in Jaeger"

echo "→ Checking Elasticsearch holds the span (durable store)"
curl -fsS "${ES_URL}/_cat/indices/jaeger-span-*?h=index,docs.count" || true
curl -fsS "${ES_URL}/jaeger-span-*/_count" | grep -Eq '"count":[1-9]' \
  && echo "✓ Elasticsearch contains Jaeger spans" \
  || { echo "✗ no span documents in Elasticsearch"; exit 1; }

echo "→ Checking the 30-day ILM policy"
curl -fsS "${ES_URL}/_ilm/policy/jaeger-ilm-policy" | grep -q '"delete"' \
  && echo "✓ jaeger-ilm-policy has a delete phase" \
  || { echo "✗ jaeger-ilm-policy missing or has no delete phase"; exit 1; }

if [ "${1:-}" = "--restart" ]; then
  echo "→ Restarting Jaeger to prove traces survive a restart"
  docker compose restart jaeger >/dev/null
  for _ in $(seq 1 30); do
    if find_trace; then echo "✓ trace still present after Jaeger restart"; exit 0; fi
    sleep 2
  done
  echo "✗ trace lost after Jaeger restart"; exit 1
fi
