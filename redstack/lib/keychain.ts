// macOS Keychain wrapper for per-engagement Ed25519 keys.
//
// On darwin: uses /usr/bin/security to store and retrieve the private
// key as a generic-password item under the service
// "com.redstack.engagement". The key material never hits a plaintext
// file on disk.
//
// On non-darwin (CI / tests): falls back to an in-memory stub that
// MUST NOT be used for real engagements. The stub throws if the caller
// tries to use it in a way that would encourage misuse in production.

import { spawnSync } from "node:child_process";
import * as ed from "@noble/ed25519";

export interface KeychainBackend {
  get(engagementId: string): Uint8Array | null;
  put(engagementId: string, privateKey: Uint8Array): void;
  destroy(engagementId: string): void;
}

const SERVICE = "com.redstack.engagement";

class MacOSKeychain implements KeychainBackend {
  get(engagementId: string): Uint8Array | null {
    const r = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", SERVICE, "-a", engagementId, "-w"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) return null;
    const b64 = r.stdout.trim();
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  put(engagementId: string, privateKey: Uint8Array): void {
    const b64 = Buffer.from(privateKey).toString("base64");
    const r = spawnSync(
      "/usr/bin/security",
      ["add-generic-password", "-s", SERVICE, "-a", engagementId, "-w", b64, "-U"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error(`keychain put failed: ${r.stderr.trim() || "unknown error"}`);
    }
  }
  destroy(engagementId: string): void {
    spawnSync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", SERVICE, "-a", engagementId],
      { encoding: "utf8" },
    );
  }
}

class InMemoryStubKeychain implements KeychainBackend {
  private readonly store = new Map<string, Uint8Array>();
  get(engagementId: string): Uint8Array | null {
    return this.store.get(engagementId) ?? null;
  }
  put(engagementId: string, privateKey: Uint8Array): void {
    this.store.set(engagementId, privateKey);
  }
  destroy(engagementId: string): void {
    this.store.delete(engagementId);
  }
}

export function getKeychain(): KeychainBackend {
  if (process.platform === "darwin" && !process.env.REDSTACK_KEYCHAIN_STUB) {
    return new MacOSKeychain();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "redstack refuses to run outside darwin in production: " +
        "real engagements require macOS Keychain.",
    );
  }
  return new InMemoryStubKeychain();
}

/** Create a signer bound to the engagement's key. */
export async function signerFor(engagementId: string, keychain = getKeychain()) {
  const privateKey = keychain.get(engagementId);
  if (!privateKey) {
    throw new Error(`no key for engagement ${engagementId}; generate with generateAndStore()`);
  }
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    async sign(message: Uint8Array): Promise<Uint8Array> {
      return ed.signAsync(message, privateKey);
    },
    publicKey(): Uint8Array {
      return publicKey;
    },
  };
}

/** Generate a fresh Ed25519 keypair, persist the private key, return the public key. */
export async function generateAndStore(
  engagementId: string,
  keychain = getKeychain(),
): Promise<{ publicKey: Uint8Array; fingerprint: string }> {
  const privateKey = ed.utils.randomPrivateKey();
  keychain.put(engagementId, privateKey);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, fingerprint: fingerprintFor(publicKey) };
}

export function fingerprintFor(publicKey: Uint8Array): string {
  const hash = require("node:crypto").createHash("sha256").update(publicKey).digest("base64");
  return "SHA256:" + hash.replace(/=+$/, "");
}
