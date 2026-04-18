// Canonical byte form for signing. Deterministic across platforms so an
// Ed25519 signature produced on one MacBook verifies on another.
//
// Rules:
//   - recursively sort object keys ASCII-ascending,
//   - drop the `signature` field at the root (signatures sign the scope
//     minus their own signature block),
//   - serialize as JSON (LF line endings, UTF-8, no trailing whitespace),
//   - append a single LF at end-of-file.
//
// We canonicalize as JSON rather than YAML on purpose: YAML has
// platform-dependent edge cases (flow vs block, anchors, sexagesimal
// numbers) that would invalidate signatures across parsers. The signer
// parses YAML, canonicalizes to JSON, signs the JSON bytes. Verifiers
// do the same.

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortDeep(obj[k]);
    }
    return out;
  }
  return value;
}

export function canonicalize(input: unknown, options?: { stripSignature?: boolean }): Uint8Array {
  const stripSignature = options?.stripSignature ?? true;
  let value: unknown = input;
  if (stripSignature && value && typeof value === "object" && !Array.isArray(value)) {
    const { signature: _sig, ...rest } = value as Record<string, unknown>;
    value = rest;
  }
  const sorted = sortDeep(value);
  const json = JSON.stringify(sorted) + "\n";
  return new TextEncoder().encode(json);
}
