import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { append, verify, merkleRoot } from "../lib/audit-log.js";

let dir: string;
let privateKey: Uint8Array;
let publicKey: Uint8Array;
let signer: { sign(msg: Uint8Array): Promise<Uint8Array>; publicKey(): Uint8Array };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "redstack-audit-"));
  privateKey = ed.utils.randomPrivateKey();
  publicKey = await ed.getPublicKeyAsync(privateKey);
  signer = {
    async sign(msg: Uint8Array) {
      return ed.signAsync(msg, privateKey);
    },
    publicKey() {
      return publicKey;
    },
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const input = (i: number) => ({
  engagement_id: "ENG-TEST-001",
  operator_id: "alex@mssp.example",
  skill: "scope-guard",
  action: "scope_guard.allow" as const,
  target_ref: `https://api.example.invalid/${i}`,
  decision: "allow" as const,
  reason: "scope_guard.allow",
  payload_hash: null,
  duration_ms: 12,
});

describe("audit-log", () => {
  test("appends and verifies a chain of entries", async () => {
    const a = await append(dir, input(1), signer);
    const b = await append(dir, input(2), signer);
    const c = await append(dir, input(3), signer);

    expect(b.parent_id).toBe(a.id);
    expect(c.parent_id).toBe(b.id);

    const r = await verify(dir, publicKey);
    expect(r.ok).toBe(true);
  });

  test("detects a tampered entry", async () => {
    await append(dir, input(1), signer);
    await append(dir, input(2), signer);
    await append(dir, input(3), signer);

    const path = join(dir, "audit.jsonl");
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const tampered = JSON.parse(lines[1]);
    tampered.target_ref = "https://api.example.invalid/EVIL";
    lines[1] = JSON.stringify(tampered);
    writeFileSync(path, lines.join("\n") + "\n");

    const r = await verify(dir, publicKey);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });

  test("merkle root is stable and changes when a new entry is appended", async () => {
    await append(dir, input(1), signer);
    const root1 = merkleRoot(dir);
    await append(dir, input(2), signer);
    const root2 = merkleRoot(dir);
    expect(root1).not.toBe(null);
    expect(root2).not.toBe(null);
    expect(root1).not.toBe(root2);
  });
});
