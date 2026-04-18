// engagement.json reader + writer + state-transition validator.
// Spec: engagement/SKILL.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Engagement, EngagementState } from "./types.js";

const VALID_TRANSITIONS: Record<EngagementState, EngagementState[]> = {
  draft: ["active"],
  active: ["paused", "frozen", "expired", "closed"],
  paused: ["active", "closed"],
  frozen: ["active", "closed"], // active requires fresh auth + customer ack, enforced upstream
  expired: ["closed"],
  closed: [],
};

export function engagementDir(engagementId: string): string {
  return join(homedir(), ".redstack", "engagements", engagementId);
}

export function load(engagementId: string): Engagement {
  const path = join(engagementDir(engagementId), "engagement.json");
  if (!existsSync(path)) {
    throw new Error(`engagement ${engagementId} not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Engagement;
}

export function save(engagement: Engagement): void {
  const dir = engagementDir(engagement.id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "engagement.json");
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(engagement, null, 2));
  // atomic rename on macOS APFS
  require("node:fs").renameSync(tmp, path);
}

export function transition(current: Engagement, to: EngagementState): Engagement {
  const allowed = VALID_TRANSITIONS[current.state];
  if (!allowed.includes(to)) {
    throw new Error(
      `invalid transition: ${current.state} → ${to} (allowed: ${allowed.join(", ") || "none"})`,
    );
  }
  return { ...current, state: to };
}

export function isActive(engagement: Engagement): boolean {
  return engagement.state === "active";
}
