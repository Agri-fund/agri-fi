#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# AgriFi Soroban Contract Build Script
#
# Compiles all contracts to WASM and runs wasm-opt -Oz to minimise binary
# sizes, targeting the <15 KB acceptance threshold per contract.
#
# Cargo release profile settings (blockchain/Cargo.toml):
#   opt-level = "z"   — optimise for size (smallest code)
#   lto        = true — full link-time optimisation across crates
#   codegen-units = 1 — single codegen unit for maximum LTO effectiveness
#   panic = "abort"   — remove panic unwinding machinery
#   strip = "symbols" — strip debug symbols from output
#
# wasm-opt -Oz applies Binaryen's binary-size-focused passes on top of rustc's
# output, typically reducing size by an additional 5–20%.
#
# Prerequisites (local build):
#   - Rust with wasm32-unknown-unknown target:
#       rustup target add wasm32-unknown-unknown
#   - wasm-opt from Binaryen:
#       cargo install wasm-opt  OR  brew install binaryen  OR download from
#       https://github.com/WebAssembly/binaryen/releases
#
# Usage:
#   ./scripts/build.sh [--check-size]
#
#   --check-size  Print sizes and exit with code 1 if any contract exceeds 15 KB
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKCHAIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SIZE_LIMIT_BYTES=15360  # 15 KB
CHECK_SIZE=false

for arg in "$@"; do
  case "$arg" in
    --check-size) CHECK_SIZE=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Validate toolchain ────────────────────────────────────────────────────────
if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
  echo "❌ wasm32-unknown-unknown target not installed."
  echo "   Run: rustup target add wasm32-unknown-unknown"
  exit 1
fi

if ! command -v wasm-opt &>/dev/null; then
  echo "❌ wasm-opt not found. Install Binaryen:"
  echo "   cargo install wasm-opt"
  echo "   brew install binaryen"
  echo "   https://github.com/WebAssembly/binaryen/releases"
  exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "📦 Building contracts (release profile: opt-level=z, lto, panic=abort)..."
cd "$BLOCKCHAIN_DIR"
cargo build --target wasm32-unknown-unknown --release

WASM_DIR="$BLOCKCHAIN_DIR/target/wasm32-unknown-unknown/release"

# ── wasm-opt post-processing ──────────────────────────────────────────────────
echo ""
echo "⚙️  Running wasm-opt -Oz on compiled contracts..."
echo "─────────────────────────────────────────────────"
printf "%-40s %10s %10s %8s\n" "Contract" "Before" "After" "Saving"
echo "─────────────────────────────────────────────────"

# Track failures for --check-size
OVERSIZED=()

for wasm in "$WASM_DIR"/*.wasm; do
  # Skip test/deps artifacts (only process contracts that have a matching src/ dir)
  name="$(basename "$wasm" .wasm)"

  # Skip *-test.wasm and similar non-contract artifacts
  [[ "$name" == *test* ]] && continue
  [[ "$name" == *deps* ]] && continue

  original_bytes=$(wc -c < "$wasm")

  # -Oz: size-focused passes; --strip-debug: remove DWARF; --strip-producers: remove tool metadata
  wasm-opt -Oz --strip-debug --strip-producers "$wasm" -o "$wasm"

  optimised_bytes=$(wc -c < "$wasm")
  saved=$((original_bytes - optimised_bytes))
  saved_pct=$(( saved * 100 / original_bytes ))

  optimised_kb=$(echo "scale=1; $optimised_bytes / 1024" | bc)

  printf "%-40s %10s %10s %7s%%\n" \
    "$name.wasm" \
    "$(numfmt --to=iec-i --suffix=B --format="%.1f" "$original_bytes" 2>/dev/null || echo "${original_bytes}B")" \
    "$(numfmt --to=iec-i --suffix=B --format="%.1f" "$optimised_bytes" 2>/dev/null || echo "${optimised_bytes}B")" \
    "$saved_pct"

  if $CHECK_SIZE && [ "$optimised_bytes" -gt "$SIZE_LIMIT_BYTES" ]; then
    OVERSIZED+=("$name (${optimised_kb} KB > 15 KB limit)")
  fi
done

echo "─────────────────────────────────────────────────"
echo ""
echo "✅ Build complete. Optimised WASMs in:"
echo "   $WASM_DIR"

if $CHECK_SIZE; then
  if [ ${#OVERSIZED[@]} -gt 0 ]; then
    echo ""
    echo "❌ The following contracts exceed the 15 KB size limit:"
    for item in "${OVERSIZED[@]}"; do
      echo "   • $item"
    done
    exit 1
  else
    echo "✅ All contracts are within the 15 KB size limit."
  fi
fi
