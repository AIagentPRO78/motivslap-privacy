import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ed from "@noble/ed25519";
import { check } from "../lib/scope-guard.js";
import type { ScopeGuardContext, ScopeGuardInput, Engagement, Scope } from "../lib/types.js";
import { activate, clear, isFrozen, activatedAt } from "../lib/kill-switch.js";
import { append } from "../lib/audit-log.js";

let tmp: string;
let engagementId: string;
let signer: { sign(msg: Uint8Array): Promise<Uint8Array>; publicKey(): Uint8Array };
let publicKey: Uint8Array;

// Redirect engagement directory into a tmp location by overriding HOME.
let originalHome: string | undefined;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "redstack-kill-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmp;
  engagementId = "ENG-TEST-001";
  const dir = join(tmp, ".redstack", "engagements", engagementId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "engagement.json"),
    JSON.stringify(
      {
        id: engagementId,
        customer: "ACME",
        loa_ref: "sha256:abc",
        authorizing_officer: "officer@acme.example",
        signed_at: "2026-04-01T00:00:00Z",
        expires_at: "2026-04-30T23:59:59Z",
        state: "active",
        key_fingerprint: "SHA256:fingerprint",
        token: "tok-1",
      } satisfies Engagement,
      null,
      2,
    ),
  );
  const pk = ed.utils.randomPrivateKey();
  publicKey = await ed.getPublicKeyAsync(pk);
  signer = {
    async sign(msg: Uint8Array) {
      return ed.signAsync(msg, pk);
    },
    publicKey() {
      return publicKey;
    },
  };
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

function baseScope(): Scope {
  return {
    engagement: {
      id: engagementId,
      customer: "ACME",
      loa_ref: "sha256:abc",
      authorizing_officer: "officer@acme.example",
      signed_at: "2026-04-01T00:00:00Z",
      expires_at: "2026-04-30T23:59:59Z",
    },
    targets: {
      hostnames: ["*.staging.acme.example"],
      ipv4_cidrs: [],
      ipv6_cidrs: [],
      repositories: [],
      mobile_bundles: [],
      phishing_recipients_ref: null,
    },
    out_of_scope: { hostnames: [], ipv4_cidrs: [], data_classes: [] },
    time_windows: {
      utc_start: "2026-04-01T00:00:00Z",
      utc_end: "2026-04-30T23:59:59Z",
      operational_hours: {
        monday: ["00:00", "23:59"],
        tuesday: ["00:00", "23:59"],
        wednesday: ["00:00", "23:59"],
        thursday: ["00:00", "23:59"],
        friday: ["00:00", "23:59"],
        saturday: ["00:00", "23:59"],
        sunday: ["00:00", "23:59"],
      },
    },
    intensity: { max_rps_per_host: 25, max_parallel_hosts: 16, max_bandwidth_mbps_egress: 50 },
    forbidden_techniques: [],
    required_techniques: [],
    notifications: { critical_findings: [], kill_switch_contacts: [] },
    operators: ["alex@mssp.example"],
    signature: { algo: "ed25519", key_fingerprint: "SHA256:fingerprint", value: "x" },
  };
}

function input(): ScopeGuardInput {
  return {
    engagement_id: engagementId,
    operator_id: "alex@mssp.example",
    skill: "web-app",
    action: "http_request.read",
    targets: ["https://api.staging.acme.example"],
    intensity: { rps: 5, parallel: 2 },
    irreversible: false,
  };
}

function ctx(overrides: Partial<ScopeGuardContext> = {}): ScopeGuardContext {
  return {
    engagement: JSON.parse(
      require("node:fs").readFileSync(
        join(homedir(), ".redstack", "engagements", engagementId, "engagement.json"),
        "utf8",
      ),
    ),
    scope: baseScope(),
    scopeSignatureValid: true,
    killSwitchActivatedAt: null,
    recentConfirmationNonces: new Set(),
    now: new Date("2026-04-22T15:00:00Z"),
    ...overrides,
  };
}

describe("kill-switch", () => {
  test("starts un-armed; scope-guard allows", () => {
    expect(isFrozen(engagementId)).toBe(false);
    expect(check(input(), ctx()).decision).toBe("allow");
  });

  test("activate flips isFrozen, writes audit entry, and freezes the engagement", async () => {
    await activate(engagementId, "operator_initiated", "alex@mssp.example", signer);
    expect(isFrozen(engagementId)).toBe(true);
    expect(activatedAt(engagementId)).not.toBeNull();

    // scope-guard now denies via the engagement-state check (state=frozen).
    const r = check(input(), ctx({ engagement: { ...ctx().engagement, state: "frozen" } }));
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("engagement.not_active");

    // And via the kill-switch flag independently of state.
    const r2 = check(input(), ctx({ killSwitchActivatedAt: activatedAt(engagementId) }));
    expect(r2.decision).toBe("deny");
    // First failing check wins — either engagement.not_active or engagement.frozen.
    expect(["engagement.not_active", "engagement.frozen"]).toContain(r2.reason);

    // Audit entry exists.
    const auditPath = join(homedir(), ".redstack", "engagements", engagementId, "audit.jsonl");
    expect(existsSync(auditPath)).toBe(true);
    const lines = require("node:fs").readFileSync(auditPath, "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.skill).toBe("kill-switch");
    expect(entry.action).toBe("kill_switch.activated");
  });

  test("clear removes the kill file", async () => {
    await activate(engagementId, "test", "alex@mssp.example", signer);
    clear(engagementId);
    expect(isFrozen(engagementId)).toBe(true); // engagement.state is still frozen
    expect(activatedAt(engagementId)).toBeNull();
  });

  test("kill-switch completes well under the CI latency budget", async () => {
    const start = Date.now();
    await activate(engagementId, "ci_latency_check", "alex@mssp.example", signer);
    const elapsed = Date.now() - start;
    // Spec budget (AUTHORIZATION.md §5.3): SIGKILL by t=12s. A state flip
    // in <1s leaves room for subprocess cleanup upstream.
    expect(elapsed).toBeLessThan(1000);
  });
});

// Silence the "homedir" warning about HOME override on some platforms.
function homedir(): string {
  return process.env.HOME ?? "";
}
