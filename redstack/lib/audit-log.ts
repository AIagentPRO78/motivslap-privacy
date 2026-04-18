// Append-only, hash-chained, signed audit log.
// Spec: lib/audit-log.md.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";
import { canonicalize } from "./canonical.js";
import type { AuditEvent, AuditEventInput } from "./types.js";

export interface AuditSigner {
  sign(message: Uint8Array): Promise<Uint8Array>;
  publicKey(): Uint8Array;
}

function ulid(): string {
  // Tiny ULID-ish: 48-bit millisecond timestamp + 80 bits of randomness,
  // base32-encoded. Sufficient for audit entry ids in v0.1.
  const t = Date.now();
  const rnd = randomBytes(10);
  const bytes = new Uint8Array(16);
  bytes[0] = (t >>> 40) & 0xff;
  bytes[1] = (t >>> 32) & 0xff;
  bytes[2] = (t >>> 24) & 0xff;
  bytes[3] = (t >>> 16) & 0xff;
  bytes[4] = (t >>> 8) & 0xff;
  bytes[5] = t & 0xff;
  bytes.set(rnd, 6);
  return "ae-" + base32(bytes);
}

function base32(bytes: Uint8Array): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 0x1f];
  return output;
}

function logPath(engagementDir: string): string {
  return join(engagementDir, "audit.jsonl");
}

function tailPath(engagementDir: string): string {
  return join(engagementDir, ".audit-tail");
}

export async function append(
  engagementDir: string,
  input: AuditEventInput,
  signer: AuditSigner,
): Promise<AuditEvent> {
  const parent_id = existsSync(tailPath(engagementDir))
    ? readFileSync(tailPath(engagementDir), "utf8").trim()
    : null;

  const partial: Omit<AuditEvent, "signature"> = {
    id: ulid(),
    ts: new Date().toISOString(),
    parent_id,
    ...input,
  };

  const message = canonicalize(partial, { stripSignature: false });
  const signature = await signer.sign(message);
  const event: AuditEvent = {
    ...partial,
    signature: "ed25519:" + Buffer.from(signature).toString("base64"),
  };

  appendFileSync(logPath(engagementDir), JSON.stringify(event) + "\n", { flag: "a" });
  writeFileSync(tailPath(engagementDir), event.id);
  return event;
}

export interface VerifyResult {
  ok: boolean;
  brokenAt?: number; // line number (1-based) of the first broken entry
  reason?: string;
}

export async function verify(engagementDir: string, publicKey: Uint8Array): Promise<VerifyResult> {
  const path = logPath(engagementDir);
  if (!existsSync(path)) return { ok: true };
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  let expectedParent: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let event: AuditEvent;
    try {
      event = JSON.parse(lines[i]);
    } catch {
      return { ok: false, brokenAt: i + 1, reason: "malformed json" };
    }
    if (event.parent_id !== expectedParent) {
      return { ok: false, brokenAt: i + 1, reason: "parent_id chain broken" };
    }
    const { signature, ...rest } = event;
    const expectedSigPrefix = "ed25519:";
    if (!signature.startsWith(expectedSigPrefix)) {
      return { ok: false, brokenAt: i + 1, reason: "unknown signature scheme" };
    }
    const sigBytes = Uint8Array.from(Buffer.from(signature.slice(expectedSigPrefix.length), "base64"));
    const message = canonicalize(rest, { stripSignature: false });
    const valid = await ed.verifyAsync(sigBytes, message, publicKey);
    if (!valid) {
      return { ok: false, brokenAt: i + 1, reason: "signature invalid" };
    }
    expectedParent = event.id;
  }
  return { ok: true };
}

/** Compute a Merkle root over every entry id, for periodic anchoring. */
export function merkleRoot(engagementDir: string): string | null {
  const path = logPath(engagementDir);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  let layer = lines.map((l) => {
    const e = JSON.parse(l) as AuditEvent;
    return sha256Hex(e.id + e.signature);
  });
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a;
      next.push(sha256Hex(a + b));
    }
    layer = next;
  }
  return layer[0];
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
