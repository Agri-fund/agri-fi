#!/usr/bin/env bash
# Detect drift between a decrypted SealedSecret and the source-of-truth value set
# (Vault or an expected JSON file). The script is read-only and emits a diff artifact
# plus an optional Slack alert when values diverge.
#
# Examples:
#   SEALED_SECRET_PRIVATE_KEY_PATH=/path/to/sealed-secrets-key.pem \
#   VAULT_ADDR=https://vault.example.com VAULT_TOKEN=... \
#   VAULT_PATH=secret/data/agri-fi/app \
#   ./devops/scripts/sealed-secret-drift-check.sh
#
#   EXPECTED_SECRET_VALUES_FILE=/tmp/expected-secrets.json \
#   SEALED_SECRET_FILE=devops/k8s/argocd/sealed-secrets.yaml \
#   ./devops/scripts/sealed-secret-drift-check.sh --namespace agri-fi --secret-name agri-fi-secrets

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sealed-secret-drift-check.sh [options]

Options:
  --sealed-file PATH           Path to the SealedSecret YAML file (default: devops/k8s/argocd/sealed-secrets.yaml)
  --secret-name NAME           Name of the Secret in the cluster (default: agri-fi-secrets)
  --namespace NS               Namespace for the Secret (default: agri-fi)
  --key PATH                   Path to the SealedSecrets private key / recovery key
  --vault-path PATH            Vault KV path to read expected values from
  --expected-json PATH         JSON file with the expected secret values
  --slack-webhook URL          Optional webhook for drift alerts
  --artifact-dir DIR           Artifact output dir (default: /tmp/sealed-secret-drift)
  --help                       Show this help message

Environment variables:
  SEALED_SECRET_FILE
  SEALED_SECRET_NAME
  NAMESPACE
  SEALED_SECRET_PRIVATE_KEY_PATH
  VAULT_PATH
  EXPECTED_SECRET_VALUES_FILE
  SLACK_WEBHOOK_URL
  ARTIFACT_DIR

Notes:
  - This script is read-only and never mutates cluster state.
  - Set APPROVE_MUTATION=1 only if you plan to run a separate, explicit apply action.
EOF
}

SEALED_SECRET_FILE="${SEALED_SECRET_FILE:-devops/k8s/argocd/sealed-secrets.yaml}"
SEALED_SECRET_NAME="${SEALED_SECRET_NAME:-agri-fi-secrets}"
NAMESPACE="${NAMESPACE:-agri-fi}"
SEALED_SECRET_PRIVATE_KEY_PATH="${SEALED_SECRET_PRIVATE_KEY_PATH:-${SEALED_SECRET_KEY_PATH:-}}"
VAULT_PATH="${VAULT_PATH:-}"
EXPECTED_SECRET_VALUES_FILE="${EXPECTED_SECRET_VALUES_FILE:-${EXPECTED_VALUES_FILE:-}}"
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/tmp/sealed-secret-drift}"
APPROVE_MUTATION="${APPROVE_MUTATION:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sealed-file)
      SEALED_SECRET_FILE="$2"; shift 2 ;;
    --secret-name)
      SEALED_SECRET_NAME="$2"; shift 2 ;;
    --namespace)
      NAMESPACE="$2"; shift 2 ;;
    --key)
      SEALED_SECRET_PRIVATE_KEY_PATH="$2"; shift 2 ;;
    --vault-path)
      VAULT_PATH="$2"; shift 2 ;;
    --expected-json)
      EXPECTED_SECRET_VALUES_FILE="$2"; shift 2 ;;
    --slack-webhook)
      SLACK_WEBHOOK_URL="$2"; shift 2 ;;
    --artifact-dir)
      ARTIFACT_DIR="$2"; shift 2 ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

notify_slack() {
  local title="$1"
  local details="$2"

  if [[ -z "$SLACK_WEBHOOK_URL" ]]; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "Slack notification requested but curl is missing; skipping alert." >&2
    return 0
  fi

  local safe_details
  safe_details=$(printf '%s' "$details" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-2000)

  curl -fsSL -X POST \
    -H 'Content-type: application/json' \
    --data "{\"text\":\"*SealedSecret drift detected*\n${title}\n${safe_details}\"}" \
    "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
}

mkdir -p "$ARTIFACT_DIR"

require_cmd kubectl
require_cmd python3
require_cmd jq

if [[ -z "$SEALED_SECRET_PRIVATE_KEY_PATH" ]]; then
  echo "Missing sealed secret private key. Set SEALED_SECRET_PRIVATE_KEY_PATH or --key." >&2
  exit 1
fi

if [[ ! -f "$SEALED_SECRET_PRIVATE_KEY_PATH" ]]; then
  echo "SealedSecrets private key file not found: $SEALED_SECRET_PRIVATE_KEY_PATH" >&2
  exit 1
fi

if [[ ! -f "$SEALED_SECRET_FILE" ]]; then
  echo "SealedSecret manifest not found: $SEALED_SECRET_FILE" >&2
  exit 1
fi

if [[ -z "$VAULT_PATH" && -z "$EXPECTED_SECRET_VALUES_FILE" ]]; then
  echo "No expected source provided: set either VAULT_PATH or EXPECTED_SECRET_VALUES_FILE." >&2
  exit 1
fi

if [[ -n "$VAULT_PATH" ]]; then
  require_cmd vault
  export VAULT_ADDR="${VAULT_ADDR:-}"
  export VAULT_TOKEN="${VAULT_TOKEN:-}"
  if [[ -z "$VAULT_ADDR" ]]; then
    echo "Vault address is required when using VAULT_PATH; set VAULT_ADDR." >&2
    exit 1
  fi
  if [[ -z "$VAULT_TOKEN" ]]; then
    echo "Vault token is required when using VAULT_PATH; set VAULT_TOKEN." >&2
    exit 1
  fi
  vault kv get -format=json "$VAULT_PATH" > "$ARTIFACT_DIR/vault-output.json"
  jq -c '.data.data // .data // {}' "$ARTIFACT_DIR/vault-output.json" > "$ARTIFACT_DIR/expected-values.json"
fi

if [[ -n "$EXPECTED_SECRET_VALUES_FILE" ]]; then
  if [[ ! -f "$EXPECTED_SECRET_VALUES_FILE" ]]; then
    echo "Expected values file not found: $EXPECTED_SECRET_VALUES_FILE" >&2
    exit 1
  fi
  jq -c . "$EXPECTED_SECRET_VALUES_FILE" > "$ARTIFACT_DIR/expected-values.json"
fi

kubeseal --decrypt --recovery-private-key "$SEALED_SECRET_PRIVATE_KEY_PATH" < "$SEALED_SECRET_FILE" > "$ARTIFACT_DIR/decrypted-sealed-secret.yaml"

python3 - "$ARTIFACT_DIR/decrypted-sealed-secret.yaml" "$ARTIFACT_DIR/expected-values.json" > "$ARTIFACT_DIR/value-diff.txt" <<'PY'
import base64, json, sys
from pathlib import Path

decrypted_path = Path(sys.argv[1])
expected_path = Path(sys.argv[2])

with decrypted_path.open('r', encoding='utf-8') as fh:
    try:
        import yaml
    except Exception as exc:  # pragma: no cover - dependency guard
        print(f"PyYAML is required to decode decrypted SealedSecrets: {exc}", file=sys.stderr)
        raise SystemExit(1)
    payload = yaml.safe_load(fh) or {}

actual = {}
for key, value in (payload.get('data') or {}).items():
    try:
        decoded = base64.b64decode(value.encode('utf-8')).decode('utf-8')
    except Exception:
        decoded = str(value)
    actual[key] = decoded

with expected_path.open('r', encoding='utf-8') as fh:
    expected = json.load(fh) or {}

missing = [key for key in expected if key not in actual]
extra = [key for key in actual if key not in expected]
changed = [
    key for key, value in expected.items()
    if str(actual.get(key, '')) != str(value)
]

if missing or extra or changed:
    print('MISMATCH')
    if missing:
        print(f'  missing in decrypted secret: {missing}')
    if extra:
        print(f'  unexpected keys in decrypted secret: {extra}')
    if changed:
        print(f'  values differ for: {changed}')
    raise SystemExit(1)

print('OK')
PY

if kubectl get secret -n "$NAMESPACE" "$SEALED_SECRET_NAME" >/dev/null 2>&1; then
  kubectl get secret -n "$NAMESPACE" "$SEALED_SECRET_NAME" -o yaml > "$ARTIFACT_DIR/live-secret.yaml"
  kubectl create secret generic "$SEALED_SECRET_NAME" -n "$NAMESPACE" \
    --dry-run=client \
    --from-literal="__placeholder__=__placeholder__" \
    -o yaml > "$ARTIFACT_DIR/template-secret.yaml"
  python3 - "$ARTIFACT_DIR/expected-values.json" "$NAMESPACE" "$SEALED_SECRET_NAME" > "$ARTIFACT_DIR/expected-secret.yaml" <<'PY'
import base64, json, sys
expected_path, namespace, secret_name = sys.argv[1:4]
with open(expected_path, 'r', encoding='utf-8') as fh:
    values = json.load(fh) or {}
body = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    f'  name: {secret_name}',
    f'  namespace: {namespace}',
    'type: Opaque',
    'data:'
]
for key, value in values.items():
    encoded = base64.b64encode(str(value).encode('utf-8')).decode('utf-8')
    body.append(f'  {key}: {encoded}')
print('\n'.join(body))
PY

  set +e
  kubectl diff -f "$ARTIFACT_DIR/expected-secret.yaml" -n "$NAMESPACE" > "$ARTIFACT_DIR/kubectl-diff.txt" 2>&1
  kubectl_diff_status=$?
  set -e
else
  kubectl_diff_status=2
  printf 'Secret %s/%s does not exist in-cluster.\n' "$NAMESPACE" "$SEALED_SECRET_NAME" > "$ARTIFACT_DIR/kubectl-diff.txt"
fi

set +e
python3 - "$ARTIFACT_DIR/decrypted-sealed-secret.yaml" "$ARTIFACT_DIR/expected-values.json" >/dev/null 2>&1 <<'PY'
import base64, json, sys
from pathlib import Path

decrypted_path = Path(sys.argv[1])
expected_path = Path(sys.argv[2])
try:
    import yaml
except Exception:  # pragma: no cover
    raise SystemExit(1)
with decrypted_path.open('r', encoding='utf-8') as fh:
    payload = yaml.safe_load(fh) or {}
actual = {}
for key, value in (payload.get('data') or {}).items():
    try:
        actual[key] = base64.b64decode(value.encode('utf-8')).decode('utf-8')
    except Exception:
        actual[key] = str(value)
with expected_path.open('r', encoding='utf-8') as fh:
    expected = json.load(fh) or {}
missing = [k for k in expected if k not in actual]
extra = [k for k in actual if k not in expected]
changed = [k for k, value in expected.items() if str(actual.get(k, '')) != str(value)]
if missing or extra or changed:
    raise SystemExit(1)
PY
value_diff_status=$?
set -e

if [[ "$value_diff_status" -ne 0 || "$kubectl_diff_status" -ne 0 ]]; then
  echo "SealedSecret drift detected." >&2
  echo "Artifacts written to: $ARTIFACT_DIR" >&2
  printf '\n--- value diff ---\n' >&2
  cat "$ARTIFACT_DIR/value-diff.txt" >&2 || true
  printf '\n--- kubectl diff artifact ---\n' >&2
  cat "$ARTIFACT_DIR/kubectl-diff.txt" >&2 || true
  notify_slack "Namespace: ${NAMESPACE}; Secret: ${SEALED_SECRET_NAME}; file: ${SEALED_SECRET_FILE}" "Value drift or kubectl diff mismatch. Artifact dir: ${ARTIFACT_DIR}"
  exit 1
fi

echo "SealedSecret drift check passed. No mismatch detected."
if [[ "$APPROVE_MUTATION" == "1" ]]; then
  echo "Mutation approval was explicitly set, but this script remains read-only. Run a separate apply/update workflow only after manual review." >&2
fi
