'use client';

import { useState, useEffect } from 'react';

/**
 * Detects WebAssembly (WASM) support at runtime.
 *
 * iOS Safari 15 and below do not support WASM streaming compilation and may
 * silently fail when react-pdf tries to initialise the PDF.js worker. This
 * hook performs a synchronous feature-detection check on mount so the caller
 * can choose an appropriate rendering strategy before the PDF.js bundle is
 * even fetched.
 *
 * Detection strategy (three independent signals, all must pass):
 *   1. `typeof WebAssembly === 'object'`       — WASM global is present
 *   2. `typeof WebAssembly.instantiate === 'function'` — instantiation API available
 *   3. Attempt to compile a minimal WASM module synchronously via
 *      `WebAssembly.validate(bytes)` — validates the runtime can actually
 *      handle WASM bytecode (rules out partial polyfills).
 *
 * The minimal WASM bytes represent the smallest valid module:
 *   magic number (0x00 0x61 0x73 0x6d) + version (0x01 0x00 0x00 0x00)
 *
 * Returns:
 *   - `null`  while the check is in flight (SSR / first render)
 *   - `true`  when WASM is fully supported
 *   - `false` when WASM is absent or broken (show fallback UI immediately)
 */
export function useWasmSupport(): boolean | null {
  // Start as null so SSR and the first client render both render nothing
  // (avoids hydration mismatch).
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(detectWasm());
  }, []);

  return supported;
}

/**
 * Synchronous WASM feature detection.
 * Exported so it can be unit-tested independently of React.
 */
export function detectWasm(): boolean {
  try {
    if (
      typeof WebAssembly !== 'object' ||
      typeof WebAssembly.instantiate !== 'function' ||
      typeof WebAssembly.validate !== 'function'
    ) {
      return false;
    }

    // Smallest valid WASM module: magic bytes + version
    const wasmBytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic: \0asm
      0x01, 0x00, 0x00, 0x00, // version: 1
    ]);

    return WebAssembly.validate(wasmBytes);
  } catch {
    return false;
  }
}
