import { describe, expect, test } from "bun:test";
import { check, targetInScope } from "../lib/scope-guard.js";
import type {
  Engagement,
  Scope,
  ScopeGuardContext,
  ScopeGuardInput,
} from "../lib/types.js";

// Fixed "now" in the middle of a Wednesday afternoon UTC, inside the
// sample scope window.
const NOW = new Date("2026-04-22T15:00:00Z");

function baseEngagement(): Engagement {
  return {
    id: "ENG-TEST-001",
    customer: "ACME",
    loa_ref: "sha256:abc",
    authorizing_officer: "officer@acme.example",
    signed_at: "2026-04-01T00:00:00Z",
    expires_at: "2026-04-30T23:59:59Z",
    state: "active",
    key_fingerprint: "SHA256:fingerprint",
    token: "tok-1",
  };
}

function baseScope(): Scope {
  return {
    engagement: {
      id: "ENG-TEST-001",
      customer: "ACME",
      loa_ref: "sha256:abc",
      authorizing_officer: "officer@acme.example",
      signed_at: "2026-04-01T00:00:00Z",
      expires_at: "2026-04-30T23:59:59Z",
    },
    targets: {
      hostnames: ["*.staging.acme.example"],
      ipv4_cidrs: ["203.0.113.0/26"],
      ipv6_cidrs: [],
      repositories: [],
      mobile_bundles: [],
      phishing_recipients_ref: null,
    },
    out_of_scope: {
      hostnames: ["prod.staging.acme.example"],
      ipv4_cidrs: [],
      data_classes: ["customer_pii"],
    },
    time_windows: {
      utc_start: "2026-04-01T00:00:00Z",
      utc_end: "2026-04-30T23:59:59Z",
      operational_hours: {
        monday: ["13:00", "21:00"],
        tuesday: ["13:00", "21:00"],
        wednesday: ["13:00", "21:00"],
        thursday: ["13:00", "21:00"],
        friday: ["13:00", "17:00"],
        saturday: [],
        sunday: [],
      },
    },
    intensity: {
      max_rps_per_host: 25,
      max_parallel_hosts: 16,
      max_bandwidth_mbps_egress: 50,
    },
    forbidden_techniques: [],
    required_techniques: [],
    notifications: {
      critical_findings: ["soc@acme.example"],
      kill_switch_contacts: ["officer@acme.example"],
    },
    operators: ["alex@mssp.example"],
    signature: {
      algo: "ed25519",
      key_fingerprint: "SHA256:fingerprint",
      value: "unused-in-this-test",
    },
  };
}

function ctx(overrides: Partial<ScopeGuardContext> = {}): ScopeGuardContext {
  return {
    engagement: baseEngagement(),
    scope: baseScope(),
    scopeSignatureValid: true,
    killSwitchActivatedAt: null,
    recentConfirmationNonces: new Set(),
    now: NOW,
    ...overrides,
  };
}

function baseInput(overrides: Partial<ScopeGuardInput> = {}): ScopeGuardInput {
  return {
    engagement_id: "ENG-TEST-001",
    operator_id: "alex@mssp.example",
    skill: "web-app",
    action: "http_request.read",
    targets: ["https://api.staging.acme.example"],
    intensity: { rps: 5, parallel: 2 },
    irreversible: false,
    ...overrides,
  };
}

describe("scope-guard checks", () => {
  test("allows a well-formed in-scope request", () => {
    const r = check(baseInput(), ctx());
    expect(r.decision).toBe("allow");
  });

  test("check 1: denies when engagement is not active", () => {
    const r = check(baseInput(), ctx({ engagement: { ...baseEngagement(), state: "draft" } }));
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("engagement.not_active");
  });

  test("check 2: denies on invalid scope signature", () => {
    const r = check(baseInput(), ctx({ scopeSignatureValid: false }));
    expect(r.reason).toBe("scope.signature_invalid");
  });

  test("check 3: denies outside operational hours", () => {
    const r = check(baseInput(), ctx({ now: new Date("2026-04-22T03:00:00Z") }));
    expect(r.reason).toBe("scope.outside_window");
  });

  test("check 3: denies on weekend", () => {
    const r = check(baseInput(), ctx({ now: new Date("2026-04-25T15:00:00Z") }));
    expect(r.reason).toBe("scope.outside_window");
  });

  test("check 4: denies an operator not on the list", () => {
    const r = check(baseInput({ operator_id: "unknown@mssp.example" }), ctx());
    expect(r.reason).toBe("operator.not_authorized");
  });

  test("check 5: denies an out-of-scope target", () => {
    const r = check(baseInput({ targets: ["https://api.other.example"] }), ctx());
    expect(r.reason).toBe("target.out_of_scope");
    expect(r.details.offending_target).toBe("https://api.other.example");
  });

  test("check 5: out_of_scope wins over a matching wildcard", () => {
    const r = check(baseInput({ targets: ["https://prod.staging.acme.example"] }), ctx());
    expect(r.reason).toBe("target.out_of_scope");
  });

  test("check 6a: product-level refusal overrides everything", () => {
    const r = check(baseInput({ action: "dos.flood" }), ctx());
    expect(r.reason).toBe("technique.product_refusal");
  });

  test("check 6b: customer-forbidden technique denies", () => {
    const scope = baseScope();
    scope.forbidden_techniques.push("http_request.read");
    const r = check(baseInput(), ctx({ scope }));
    expect(r.reason).toBe("technique.customer_forbidden");
  });

  test("check 7: over-limit rps denies", () => {
    const r = check(baseInput({ intensity: { rps: 1000, parallel: 1 } }), ctx());
    expect(r.reason).toBe("intensity.exceeded");
  });

  test("check 8: irreversible with no nonce denies", () => {
    const r = check(baseInput({ irreversible: true }), ctx());
    expect(r.reason).toBe("irreversible.no_confirmation");
  });

  test("check 8: irreversible with stale nonce denies", () => {
    const nonce = "nonce-xyz";
    const r = check(
      baseInput({ irreversible: true, operator_confirmation_nonce: nonce }),
      ctx({ recentConfirmationNonces: new Set() }), // stale (not in set)
    );
    expect(r.reason).toBe("irreversible.no_confirmation");
  });

  test("check 8: irreversible with fresh nonce allows", () => {
    const nonce = "nonce-xyz";
    const r = check(
      baseInput({ irreversible: true, operator_confirmation_nonce: nonce }),
      ctx({ recentConfirmationNonces: new Set([nonce]) }),
    );
    expect(r.decision).toBe("allow");
  });

  test("check 9: frozen engagement denies", () => {
    const r = check(baseInput(), ctx({ killSwitchActivatedAt: "2026-04-22T10:00:00Z" }));
    expect(r.reason).toBe("engagement.frozen");
  });

  test("regression guard: the pre-pivot cloud_accounts.aws key is not a target class", () => {
    // Synthesize a target using the pre-pivot format; scope-guard must deny it.
    const r = check(baseInput({ targets: ["aws-account:123456789012"] }), ctx());
    expect(r.decision).toBe("deny");
  });

  test("loopback targets are always denied", () => {
    const r = check(baseInput({ targets: ["http://127.0.0.1:8080"] }), ctx());
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("target.out_of_scope");
  });

  test("169.254.* metadata range is always denied", () => {
    const r = check(baseInput({ targets: ["169.254.169.254"] }), ctx());
    expect(r.decision).toBe("deny");
  });
});

describe("targetInScope helper", () => {
  test("wildcard matching", () => {
    const s = baseScope();
    expect(targetInScope("api.staging.acme.example", s)).toBe(true);
    expect(targetInScope("staging.acme.example", s)).toBe(true);
    expect(targetInScope("other.example", s)).toBe(false);
  });

  test("ipv4 cidr matching", () => {
    const s = baseScope();
    expect(targetInScope("203.0.113.10", s)).toBe(true);
    expect(targetInScope("203.0.113.100", s)).toBe(false);
  });
});
