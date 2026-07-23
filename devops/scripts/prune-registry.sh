#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${REGISTRY_HOST:-registry.agri-fi.io}"
REGISTRY_USER="${REGISTRY_USER:-}"
REGISTRY_PASS="${REGISTRY_PASS:-}"
DAYS_OLD="${DAYS_OLD:-30}"

if [[ -z "$REGISTRY_USER" || -z "$REGISTRY_PASS" ]]; then
  echo "ERROR: REGISTRY_USER and REGISTRY_PASS must be set" >&2
  exit 1
fi

TOKEN=$(curl -s -u "${REGISTRY_USER}:${REGISTRY_PASS}" \
  "https://${REGISTRY}/v2/token?service=registry" | jq -r '.token')

REPOS=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${REGISTRY}/v2/_catalog" | jq -r '.repositories[]')

CUTOFF=$(date -d "-${DAYS_OLD} days" +%s 2>/dev/null || date -v "-${DAYS_OLD}d" +%s)

for repo in $REPOS; do
  TAGS=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    "https://${REGISTRY}/v2/${repo}/tags/list" | jq -r '.tags // [] | .[]')

  for tag in $TAGS; do
    # skip named/semantic tags — only delete untagged (sha256 digests)
    if [[ "$tag" != sha256:* ]]; then
      continue
    fi

    CREATED=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
      -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
      "https://${REGISTRY}/v2/${repo}/manifests/${tag}" | \
      jq -r '.history[0].v1Compatibility // "{}"' | jq -r '.created // empty')

    if [[ -z "$CREATED" ]]; then continue; fi

    IMAGE_DATE=$(date -d "$CREATED" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED" +%s)
    if (( IMAGE_DATE < CUTOFF )); then
      DIGEST=$(curl -s -I -H "Authorization: Bearer ${TOKEN}" \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
        "https://${REGISTRY}/v2/${repo}/manifests/${tag}" | \
        grep -i docker-content-digest | awk '{print $2}' | tr -d '\r')
      echo "Deleting ${repo}@${DIGEST}"
      curl -s -X DELETE -H "Authorization: Bearer ${TOKEN}" \
        "https://${REGISTRY}/v2/${repo}/manifests/${DIGEST}"
    fi
  done
done

echo "Registry cleanup complete."
