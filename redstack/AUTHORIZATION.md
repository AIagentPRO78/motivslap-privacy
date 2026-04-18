# Authorization Model

The single most load-bearing part of redstack. If this breaks, the product
is liable. Read this fully before modifying any skill.

---

## 1. Layered enforcement

```
    1. LOA (Letter of Authorization)         PDF, wet- or e-signed by
       ──────────────────────────            the customer's authorizing
                                             officer. Names the assets,
                                             dates, and constraints in
                                             prose.

    2. scope.yaml (machine-readable)         Derived from the LOA by a
       ──────────────────────────            redstack engagement engineer.
                                             Signed with the customer's
                                             Ed25519 key.

    3. Engagement token                      Per-engagement UUID issued
       ──────────────────────────            after scope.yaml signature
                                             verifies. Carried in every
                                             skill invocation.

    4. scope-guard preamble                  Runs as the first step of
       ──────────────────────────            every skill. Validates token,
                                             target, time window, operator.
                                             Refuses loudly on fail.

    5. Tool wrappers                         Every shell-out to a scanner
       ──────────────────────────            (nmap, ZAP, nuclei, prowler,
                                             ...) re-checks scope before
                                             invoking the underlying tool.

    6. Audit log                             Every decision — allow or
       ──────────────────────────            deny — is written append-only.
```

Bypass any layer and the release is blocked.

---

## 2. The scope file

Location: `scope.yaml` (unsigned while drafting), `scope.yaml.signed`
(committed after customer signature).

### 2.1 Structure

```yaml
engagement:
  id: ENG-2026-Q2-ACME-001            # human-readable, unique
  customer: "ACME Corp"
  loa_ref: loa-2026-acme-001.pdf.sha256
  authorizing_officer: "Jane Doe, CISO, jdoe@acme.example"
  signed_at: 2026-04-01T00:00:00Z
  expires_at: 2026-04-30T23:59:59Z

targets:
  hostnames:
    - "*.staging.acme.example"          # wildcards allowed
    - "api.acme.example"
  ipv4_cidrs:
    - "203.0.113.0/26"
  ipv6_cidrs: []
  cloud_accounts:
    aws: ["123456789012"]
    gcp: []
    azure: []
  repositories:
    - "github.com/acme/web"
    - "github.com/acme/api"
  mobile_bundles:
    - "com.acme.mobile"
  phishing_recipients_ref: "recipients-2026-04.csv.sha256"  # HR-approved list

out_of_scope:
  hostnames:
    - "*.prod.acme.example"             # explicit exclusions, even if
                                        # caught by a wildcard above
  data_classes:
    - "customer_pii"                    # refuse to exfiltrate these
    - "phi"

time_windows:
  utc_start: 2026-04-01T00:00:00Z
  utc_end:   2026-04-30T23:59:59Z
  operational_hours:                    # per weekday, UTC
    monday:    ["13:00", "21:00"]
    tuesday:   ["13:00", "21:00"]
    wednesday: ["13:00", "21:00"]
    thursday:  ["13:00", "21:00"]
    friday:    ["13:00", "17:00"]
    saturday:  []                       # no-op on weekends
    sunday:    []

intensity:
  max_rps_per_host: 25
  max_parallel_hosts: 16
  max_bandwidth_mbps_egress: 50

forbidden_techniques:                   # customer vetoes
  - "credential_testing_against_prod_idp"
  - "dns_rebinding"
  - "deserialization_fuzzing"

required_techniques:                    # customer mandates
  - "waf_bypass_coverage"
  - "dependency_sca_full"

notifications:
  critical_findings:
    - "soc@acme.example"
    - "pager:acme-security"
  kill_switch_contacts:
    - "jdoe@acme.example"
    - "+1-555-0100"

signature:
  algo: ed25519
  key_fingerprint: "SHA256:abcd...1234"
  value: "base64...="                   # over the canonical YAML bytes
```

### 2.2 Canonicalization and signing

Before signing, the YAML is serialized to a canonical byte form (keys
sorted, UTF-8, LF line endings, no trailing whitespace) and the signature
is computed over those bytes. Verification reruns the same canonicalization
before `ed25519-verify`.

Implementation reference: `lib/scope-guard.md` §2.

### 2.3 Who can sign

Only the authorizing officer named in the LOA. The key fingerprint is
bound to that officer at LOA intake and cannot be rotated mid-engagement
without a new LOA addendum.

---

## 3. scope-guard preamble

Every SKILL.md preamble does, in this order:

1. **Locate the engagement.** Read `engagement.json` from the engagement
   bus (CLI: `~/.redstack/engagements/<active>/`, SaaS: per-request).
2. **Verify the signature** of `scope.yaml.signed` using the customer key
   on file. If it fails, stop and log `scope_guard.signature_invalid`.
3. **Check the time window.** Current UTC must fall within
   `engagement.expires_at` AND the current weekday's operational hours.
4. **Check the operator.** The invoking operator must be in the
   engagement's allowed operator list.
5. **Resolve the intended target(s)** from the skill inputs and match
   them against `targets` AND `out_of_scope`. Out-of-scope wins every
   tie.
6. **Check technique allow/deny.** If the skill's action class is in
   `forbidden_techniques`, refuse. If it is a product-level refusal
   (§4), refuse regardless.
7. **Check intensity.** If the intended action would exceed a rate or
   parallelism cap, queue or refuse per policy.
8. **Emit `scope_guard.allow` or `scope_guard.deny`** to the audit log
   with full context.

On any deny: stop, tell the operator exactly which check failed, do not
retry silently.

---

## 4. Product-level refusals

These override customer wishes. They are not toggleable from the scope
file. A customer who cannot accept them is not a customer we serve.

| Refusal                                                  | Rationale                                     |
| -------------------------------------------------------- | --------------------------------------------- |
| Denial-of-service or resource-exhaustion attacks         | Civil + criminal liability; asset-owner harm  |
| Mass internet scanning or untargeted credential stuffing | Third-party harm; abuse of shared infra       |
| Self-propagating payloads (worms, USB spreaders)         | Blast radius uncontrollable                   |
| Persistence designed to evade the asset owner            | Defeats the defense-supporting purpose        |
| Pivot to assets not in the scope file                    | Defeats the authorization spine               |
| Exfil of real PII beyond a minimized, redacted sample    | GDPR / HIPAA / customer-trust                 |
| Detection-evasion tuned for malicious ops                | Not a red-team goal; adversary-supporting     |

Each refusal emits `product_refusal.<kind>` to the audit log with the
triggering skill, target, and operator.

---

## 5. Kill switch

### 5.1 Who can trigger

- Customer authorizing officer (contacts in `notifications.kill_switch_contacts`).
- Lead operator.
- Automated: scope-guard itself, if three consecutive refusals fire within
  60 seconds (suggests a misconfigured skill).

### 5.2 What happens

1. The engagement token is revoked on the bus.
2. All active skill processes receive SIGTERM, then SIGKILL after 10s.
3. All open scanner/proxy sessions are closed.
4. The audit log receives `kill_switch.activated` with the trigger and
   reason.
5. The engagement enters `frozen` state. Resume requires a fresh operator
   authentication AND an explicit customer ack.

### 5.3 Test in CI

M3 lands a CI test that:
- starts a mock engagement,
- launches a skill that would otherwise run 60s,
- triggers the kill switch at t=2s,
- asserts: all child processes gone by t=12s, audit entry present,
  engagement in `frozen`.

---

## 6. Audit log

Append-only JSONL. One event per line. Every event carries:

- `ts` — RFC 3339 UTC, millisecond precision.
- `engagement_id`
- `operator_id`
- `skill` — the invoking SKILL.md name.
- `action` — the machine-readable action class.
- `target_ref` — normalized target identifier, or `null` for non-action
  events.
- `decision` — `allow`, `deny`, or `info`.
- `reason` — human-readable, stable machine key.
- `payload_hash` — SHA-256 of the payload/request, never the raw payload.
- `signature` — per-entry Ed25519 over the canonicalized entry.

Periodic Merkle roots are published to a customer-chosen ledger (internal
PKI, Sigstore, or a private transparency log). Customer can request
cryptographic deletion at any time by destroying the per-engagement key.

Implementation reference: `lib/audit-log.md`.

---

## 7. Data retention

- **Raw request/response bodies:** 30 days, encrypted at rest, customer
  can purge sooner.
- **Findings + evidence samples (redacted):** report-cycle + 30 days, or
  as customer SLA requires.
- **Audit log:** 7 years default, customer-configurable; key destruction
  available on request.
- **Telemetry (opt-in):** skill usage counts, durations, OS, version. Never
  targets, payloads, findings, or customer code.

---

## 8. Intake checklist for a new engagement

Before a `/engagement` skill accepts a scope, it must verify:

- [ ] LOA PDF attached, SHA-256 matches `engagement.loa_ref`.
- [ ] Authorizing officer email validated against the customer's HRIS or
      the LOA.
- [ ] `scope.yaml.signed` Ed25519 signature verifies with the officer's
      key.
- [ ] `targets` contains at least one concrete asset; no pure wildcards
      against top-level TLDs.
- [ ] No target resolves to a redstack-internal or localhost address.
- [ ] Time window is in the future and ≤ 180 days.
- [ ] `phishing_recipients_ref`, if present, is an HR-approved list with
      a current SHA-256 match.
- [ ] Notification contacts are reachable (test ping at intake).
- [ ] Customer DPO contact on file if any target handles personal data.

Any missing box → engagement is `draft`, not `active`. No skill runs while
`draft`.
