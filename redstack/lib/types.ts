// Shared types for the redstack crypto + bus spine.
// Contracts match the specs in lib/scope-guard.md, lib/audit-log.md,
// and lib/finding-schema.md.

export type EngagementState =
  | "draft"
  | "active"
  | "paused"
  | "frozen"
  | "expired"
  | "closed";

export interface Engagement {
  id: string;
  customer: string;
  loa_ref: string;
  authorizing_officer: string;
  signed_at: string;
  expires_at: string;
  state: EngagementState;
  key_fingerprint: string;
  token: string;
}

export interface OperationalHours {
  monday: [string, string] | [];
  tuesday: [string, string] | [];
  wednesday: [string, string] | [];
  thursday: [string, string] | [];
  friday: [string, string] | [];
  saturday: [string, string] | [];
  sunday: [string, string] | [];
}

export interface ScopeTargets {
  hostnames: string[];
  ipv4_cidrs: string[];
  ipv6_cidrs: string[];
  k8s_clusters?: Array<{ context: string; api_endpoint: string }>;
  object_stores?: Array<{ endpoint: string; buckets: string[] }>;
  databases?: Array<{ endpoint: string; engine: string }>;
  idps?: Array<{ endpoint: string; kind: string }>;
  repositories: string[];
  mobile_bundles: string[];
  phishing_recipients_ref: string | null;
}

export interface Scope {
  engagement: {
    id: string;
    customer: string;
    loa_ref: string;
    authorizing_officer: string;
    signed_at: string;
    expires_at: string;
  };
  targets: ScopeTargets;
  out_of_scope: {
    hostnames: string[];
    ipv4_cidrs: string[];
    data_classes: string[];
  };
  time_windows: {
    utc_start: string;
    utc_end: string;
    operational_hours: OperationalHours;
  };
  intensity: {
    max_rps_per_host: number;
    max_parallel_hosts: number;
    max_bandwidth_mbps_egress: number;
  };
  forbidden_techniques: string[];
  required_techniques: string[];
  notifications: {
    critical_findings: string[];
    kill_switch_contacts: string[];
  };
  operators: string[];
  signature: {
    algo: "ed25519";
    key_fingerprint: string;
    value: string;
  };
}

export type ActionKey =
  | "meta.intake"
  | "meta.engagement_transition"
  | "meta.triage"
  | "meta.report_generation"
  | "meta.retro"
  | "recon.passive_osint"
  | "recon.dns_enumeration"
  | "recon.port_scan"
  | "recon.active_crawl"
  | "http_request.read"
  | "http_request.state_mutating"
  | "source_scan.sast"
  | "source_scan.secrets"
  | "source_scan.sca"
  | "source_scan.iac"
  | "cloud.read_config"
  | "cloud.permission_escalation_probe"
  | "binary.static_analysis"
  | "binary.fuzz"
  | "network.service_probe"
  | "identity.password_policy_check"
  | "identity.credential_test"
  | "mobile.static_analysis"
  | "mobile.dynamic_instrument"
  | "exploit.poc_read"
  | "exploit.poc_state_mutating"
  | "phishing.send"
  | "postex.lateral_move_lab"
  | "purple.detection_check";

// Product-level refusals — action keys that are ALWAYS denied.
export const PRODUCT_REFUSAL_PREFIXES = [
  "dos.",
  "scan.internet_wide",
  "persistence.evade_owner",
  "worm.",
  "exfil.pii_beyond_sample",
  "pivot.out_of_scope",
] as const;

export interface ScopeGuardInput {
  engagement_id: string;
  operator_id: string;
  skill: string;
  action: ActionKey | string; // unknown keys route through product-refusal check
  targets: string[];
  intensity: { rps: number; parallel: number };
  irreversible: boolean;
  operator_confirmation_nonce?: string;
}

export type DenyReason =
  | "engagement.not_active"
  | "engagement.frozen"
  | "scope.signature_invalid"
  | "scope.outside_window"
  | "operator.not_authorized"
  | "target.out_of_scope"
  | "technique.customer_forbidden"
  | "technique.product_refusal"
  | "intensity.exceeded"
  | "irreversible.no_confirmation";

export interface ScopeGuardResult {
  decision: "allow" | "deny";
  reason: "scope_guard.allow" | DenyReason;
  details: {
    engagement_id: string;
    operator_id: string;
    skill: string;
    action: string;
    targets: string[];
    first_failing_check?: DenyReason;
    offending_target?: string;
  };
}

export interface AuditEvent {
  id: string;
  ts: string;
  engagement_id: string;
  operator_id: string;
  skill: string;
  action: string;
  target_ref: string | null;
  decision: "allow" | "deny" | "info";
  reason: string;
  payload_hash: string | null;
  duration_ms: number | null;
  parent_id: string | null;
  signature: string;
}

export type AuditEventInput = Omit<AuditEvent, "id" | "ts" | "parent_id" | "signature">;
