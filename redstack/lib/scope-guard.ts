// scope-guard — the 9 ordered checks from lib/scope-guard.md §1.
//
// Pure deterministic function: same inputs → same outputs. No I/O here.
// Callers (skills, tool wrappers) provide the resolved engagement and
// scope; this module decides allow/deny and produces the reason.

import type {
  DenyReason,
  Engagement,
  Scope,
  ScopeGuardInput,
  ScopeGuardResult,
} from "./types.js";
import { PRODUCT_REFUSAL_PREFIXES } from "./types.js";

export interface ScopeGuardContext {
  engagement: Engagement;
  scope: Scope;
  scopeSignatureValid: boolean;
  killSwitchActivatedAt: string | null;
  recentConfirmationNonces: Set<string>; // valid within last 60s
  now: Date;
}

export function check(input: ScopeGuardInput, ctx: ScopeGuardContext): ScopeGuardResult {
  const deny = (reason: DenyReason, extra?: { offending_target?: string }): ScopeGuardResult => ({
    decision: "deny",
    reason,
    details: {
      engagement_id: input.engagement_id,
      operator_id: input.operator_id,
      skill: input.skill,
      action: input.action,
      targets: input.targets,
      first_failing_check: reason,
      ...(extra?.offending_target !== undefined
        ? { offending_target: extra.offending_target }
        : {}),
    },
  });

  // Check 1: engagement exists + active.
  if (ctx.engagement.state !== "active") {
    return deny("engagement.not_active");
  }

  // Check 2: scope-file signature valid.
  if (!ctx.scopeSignatureValid) {
    return deny("scope.signature_invalid");
  }

  // Check 3: time window.
  if (!withinTimeWindow(ctx.scope, ctx.now)) {
    return deny("scope.outside_window");
  }

  // Check 4: operator authorized.
  if (!ctx.scope.operators.includes(input.operator_id)) {
    return deny("operator.not_authorized");
  }

  // Check 5: targets in-scope.
  for (const target of input.targets) {
    if (!targetInScope(target, ctx.scope)) {
      return deny("target.out_of_scope", { offending_target: target });
    }
  }

  // Check 6: technique allowed.
  // 6a: product-level refusal always wins.
  if (PRODUCT_REFUSAL_PREFIXES.some((p) => input.action.startsWith(p))) {
    return deny("technique.product_refusal");
  }
  // 6b: customer forbidden.
  if (ctx.scope.forbidden_techniques.includes(input.action)) {
    return deny("technique.customer_forbidden");
  }

  // Check 7: intensity ceiling.
  if (input.intensity.rps > ctx.scope.intensity.max_rps_per_host) {
    return deny("intensity.exceeded");
  }
  if (input.intensity.parallel > ctx.scope.intensity.max_parallel_hosts) {
    return deny("intensity.exceeded");
  }

  // Check 8: irreversible action confirmation.
  if (input.irreversible) {
    const nonce = input.operator_confirmation_nonce ?? "";
    if (!nonce || !ctx.recentConfirmationNonces.has(nonce)) {
      return deny("irreversible.no_confirmation");
    }
  }

  // Check 9: kill-switch state.
  if (ctx.killSwitchActivatedAt) {
    return deny("engagement.frozen");
  }

  return {
    decision: "allow",
    reason: "scope_guard.allow",
    details: {
      engagement_id: input.engagement_id,
      operator_id: input.operator_id,
      skill: input.skill,
      action: input.action,
      targets: input.targets,
    },
  };
}

// --- helpers --------------------------------------------------------------

function withinTimeWindow(scope: Scope, now: Date): boolean {
  const start = new Date(scope.time_windows.utc_start);
  const end = new Date(scope.time_windows.utc_end);
  if (now < start || now > end) return false;

  const weekdayKey = weekdayKeyUtc(now);
  const hours = scope.time_windows.operational_hours[weekdayKey];
  if (!hours || hours.length === 0) return false;

  const [openStr, closeStr] = hours as [string, string];
  const [openH, openM] = openStr.split(":").map(Number);
  const [closeH, closeM] = closeStr.split(":").map(Number);
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minuteOfDay >= openH * 60 + openM && minuteOfDay <= closeH * 60 + closeM;
}

function weekdayKeyUtc(d: Date): keyof Scope["time_windows"]["operational_hours"] {
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  return keys[d.getUTCDay()];
}

export function targetInScope(target: string, scope: Scope): boolean {
  const kind = classify(target);

  // Redstack-internal / loopback are always denied.
  if (isDangerousLoopback(target)) return false;

  switch (kind) {
    case "hostname":
      return (
        scope.targets.hostnames.some((p) => hostnameMatch(target, p)) &&
        !scope.out_of_scope.hostnames.some((p) => hostnameMatch(target, p))
      );
    case "ipv4":
      return (
        scope.targets.ipv4_cidrs.some((c) => ipv4InCidr(target, c)) &&
        !scope.out_of_scope.ipv4_cidrs.some((c) => ipv4InCidr(target, c))
      );
    case "repo":
      return scope.targets.repositories.includes(target);
    case "mobile":
      return scope.targets.mobile_bundles.includes(target);
    case "k8s":
      return (scope.targets.k8s_clusters ?? []).some(
        (c) => c.context === target || c.api_endpoint === target,
      );
    case "object_store": {
      const stores = scope.targets.object_stores ?? [];
      const { endpoint, bucket } = parseObjectStore(target);
      return stores.some(
        (s) => s.endpoint === endpoint && (bucket === null || s.buckets.includes(bucket)),
      );
    }
    case "database":
      return (scope.targets.databases ?? []).some((d) => d.endpoint === target);
    case "idp":
      return (scope.targets.idps ?? []).some((i) => i.endpoint === target);
    default:
      return false;
  }
}

type TargetKind =
  | "hostname"
  | "ipv4"
  | "repo"
  | "mobile"
  | "k8s"
  | "object_store"
  | "database"
  | "idp"
  | "unknown";

function classify(target: string): TargetKind {
  if (target.startsWith("s3://") || target.startsWith("gs://")) return "object_store";
  if (target.startsWith("k8s://") || target.startsWith("https://") && target.includes(":6443"))
    return "k8s";
  if (target.startsWith("postgres://") || /:(5432|3306|6379|27017)\b/.test(target))
    return "database";
  if (target.startsWith("https://auth.") || target.startsWith("http://auth.")) return "idp";
  if (target.startsWith("http://") || target.startsWith("https://")) return "hostname";
  if (/^(git@|https:\/\/git)/.test(target)) return "repo";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) return "ipv4";
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(target)) return "hostname";
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(target)) return "mobile";
  return "unknown";
}

function isDangerousLoopback(target: string): boolean {
  return (
    /^127\./.test(target) ||
    target === "localhost" ||
    target.startsWith("http://localhost") ||
    target.startsWith("https://localhost") ||
    /^169\.254\./.test(target) // cloud metadata range; always suspicious
  );
}

function hostnameMatch(host: string, pattern: string): boolean {
  const h = host.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  if (pattern.startsWith("*.")) {
    const tail = pattern.slice(2);
    return h === tail || h.endsWith("." + tail);
  }
  return h === pattern;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipNum = ipv4ToNum(ip);
  const rangeNum = ipv4ToNum(range);
  if (Number.isNaN(ipNum) || Number.isNaN(rangeNum)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipv4ToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return NaN;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function parseObjectStore(target: string): { endpoint: string; bucket: string | null } {
  // s3://endpoint/bucket/key → endpoint + bucket
  const rest = target.replace(/^s3:\/\/|^gs:\/\//, "");
  const [endpoint, bucket] = rest.split("/", 2);
  return { endpoint, bucket: bucket ?? null };
}
