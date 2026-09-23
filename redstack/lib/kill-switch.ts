// Kill-switch state. Monitored by every skill's preamble via scope-guard
// check 9 (engagement.frozen). Activation writes an audit entry and
// flips the engagement state to `frozen` via the engagement helper.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { engagementDir, load, save, transition } from "./engagement.js";
import { append } from "./audit-log.js";
import type { AuditSigner } from "./audit-log.js";

function killPath(engagementId: string): string {
  return join(engagementDir(engagementId), ".kill-switch");
}

export function isFrozen(engagementId: string): boolean {
  if (existsSync(killPath(engagementId))) return true;
  try {
    return load(engagementId).state === "frozen";
  } catch {
    return false;
  }
}

export function activatedAt(engagementId: string): string | null {
  const path = killPath(engagementId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

export async function activate(
  engagementId: string,
  reason: string,
  operatorId: string,
  signer: AuditSigner,
): Promise<void> {
  const ts = new Date().toISOString();
  writeFileSync(killPath(engagementId), ts);

  try {
    const eng = load(engagementId);
    if (eng.state !== "frozen") {
      save(transition(eng, "frozen"));
    }
  } catch {
    // engagement record missing; kill file + audit still record the event
  }

  await append(
    engagementDir(engagementId),
    {
      engagement_id: engagementId,
      operator_id: operatorId,
      skill: "kill-switch",
      action: "kill_switch.activated",
      target_ref: null,
      decision: "info",
      reason,
      payload_hash: null,
      duration_ms: null,
    },
    signer,
  );
}

export function clear(engagementId: string): void {
  const path = killPath(engagementId);
  if (existsSync(path)) unlinkSync(path);
}
