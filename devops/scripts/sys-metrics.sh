#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${INTERVAL_SECONDS:-60}"
CPU_THRESHOLD="${CPU_THRESHOLD:-85}"
MEM_THRESHOLD="${MEM_THRESHOLD:-85}"
DISK_THRESHOLD="${DISK_THRESHOLD:-90}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

notify() {
  local message="$1"
  echo "[ALERT] ${message}"
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl -sS -X POST \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"${message}\"}" \
      "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
}

get_cpu_usage() {
  local idle
  idle="$(top -bn1 | awk '/Cpu\(s\)/ {print $8}' | cut -d. -f1)"
  echo $((100 - idle))
}

get_mem_usage() {
  free | awk '/Mem:/ {printf "%.0f\n", $3/$2 * 100}'
}

get_disk_usage() {
  df -P / | awk 'NR==2 {gsub("%","",$5); print $5}'
}

echo "Starting system metrics monitor (interval: ${INTERVAL_SECONDS}s)"

while true; do
  cpu="$(get_cpu_usage)"
  mem="$(get_mem_usage)"
  disk="$(get_disk_usage)"

  echo "$(date -Iseconds) cpu=${cpu}% mem=${mem}% disk=${disk}%"

  (( cpu > CPU_THRESHOLD )) && notify "CPU usage high: ${cpu}% (threshold: ${CPU_THRESHOLD}%)"
  (( mem > MEM_THRESHOLD )) && notify "Memory usage high: ${mem}% (threshold: ${MEM_THRESHOLD}%)"
  (( disk > DISK_THRESHOLD )) && notify "Disk usage high: ${disk}% (threshold: ${DISK_THRESHOLD}%)"

  sleep "$INTERVAL_SECONDS"
done
