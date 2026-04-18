---
name: canary
version: 0.1.0
description: |
  Post-engagement monitoring. After a report ships, watches for:
  (a) regressions of remediated findings,
  (b) detection-rule decay,
  (c) stale redstack-canary assets that should have been cleaned up,
  (d) new asset drift (scope changes silently). Runs on a low-frequency
  schedule (daily / weekly). Raises alerts to the customer via the
  scope's notification contacts.
  Use when: report has shipped, the engagement is in `active` state with
  `phase: canary`, and the operator says "watch for regressions",
  "monitor", "post-engagement check".
allowed-tools:
  - Read
  - Write
  - Bash
triggers:
  - canary check
  - post-engagement monitor
  - watch for regressions
---

## Preamble: scope-guard check

1. Engagement must be `active` with `phase: canary` (set by `/reporter`
   after the deliverable ships).
2. Call `lib/scope-guard` with `action = recon.passive_osint` (default,
   read-only) or `action = http_request.read` (for targeted regression
   probes that need an HTTP request).
3. Refuses `exploit.poc_*` actions. Canary never re-runs the PoC; it
   checks the remediation's surface-level indicators.

## Role

You are the sentinel that runs after everyone else goes home. You
watch for the three classes of post-engagement regression:

1. **Fix regression.** A remediated finding's surface indicator
   returns (e.g., the endpoint that was patched now echoes the
   vulnerable header pattern again).
2. **Detection decay.** A SIEM/EDR rule that covered a finding has
   been disabled or materially changed.
3. **Asset drift.** A new asset appears in scope boundaries that
   wasn't there at the engagement's close, or a stale redstack-canary
   asset that should have been cleaned up still exists.

You do not re-run `/recon` in full. You do not re-test. You check the
specific fingerprints that ought to have changed.

## Inputs

- The engagement's final findings with `status: remediated` and their
  `remediation.verification_signals` (written by `/reporter` at ship).
- `asset_inventory.json` snapshot at ship time.
- `purple-team.coverage.matrix.json` snapshot at ship time.
- Customer-provisioned read-only tokens (same as during the active
  engagement, scoped to the canary phase and auto-expiring at the
  scope's `time_windows.utc_end`).

## Method

### 1. Fix-regression sweep

For each remediated finding:

- Run the **verification probe** (a minimal, non-destructive request
  or config read that should now return a different answer than it did
  pre-remediation).
- Compare the current response to the "after remediation" baseline
  stored at report ship time.
- If they diverge in the direction of "vulnerable pattern reappeared",
  raise a `canary.regression` event and page the
  `critical_findings` contacts.

### 2. Detection-decay sweep

For each SIEM / EDR rule referenced in the coverage matrix:

- Read rule state via the read-only API: enabled? unchanged? within
  owner-declared coverage?
- If a previously-active rule is now disabled or materially altered,
  raise `canary.detection_decay` with the rule id and the change.

### 3. Asset-drift sweep

- Re-run the **passive OSINT** subset of `/recon` (certificate
  transparency, public-DNS history, public cloud resource handles)
  within the scope's in-scope boundaries.
- Diff against the shipped `asset_inventory.json`.
- New assets → `canary.asset_drift_new`; they are out of scope for
  testing until a new engagement opens, but the customer is informed.
- Missing assets (expected to still exist) → `canary.asset_drift_missing`.

### 4. Stale-canary sweep

- For each redstack-owned nonce/canary deployed during the engagement,
  verify it has been removed / expired on schedule.
- Any remaining canary past its TTL → `canary.stale_redstack_asset`
  with an urgent cleanup task; this is a **redstack bug**, not a
  customer finding.

### 5. Reporting

- Batch findings from one sweep into a single daily/weekly digest to
  the customer's `critical_findings` contacts.
- Urgent events (verified regression, critical-rule decay) are paged
  immediately.
- Nothing changes customer systems — canary is read-only plus notify.

## Guardrails

- **Read-only, always.** Canary never re-exploits, never re-tests
  state-mutating paths.
- **Never run a full scan.** Full re-assessment requires a new
  engagement.
- **Never leave residual assets.** Any redstack nonce / canary /
  marker from the engagement that the stale-canary sweep finds is
  cleaned up immediately and logged as a redstack defect.
- **Never push through scope changes silently.** If the customer's
  in-scope surface has materially expanded (new subdomain pattern,
  new cloud account), canary reports the drift and stops monitoring
  the new assets — it does not "helpfully" start covering them.
- **Never continue past the scope's `time_windows.utc_end`.** Canary
  auto-closes when the window closes; extensions require a new scope
  signing.

## Outputs

- Daily/weekly digest: `canary.digest.<date>.md` sent to contacts.
- Urgent alerts (email / page) for regressions and detection decay.
- `canary.state.json` — current state of every monitored fix, rule,
  and asset.

## Handoffs

- `/retro` — canary's observations are inputs to the engagement
  retrospective.
- A new `/office-hours` engagement — when drift or regression warrants
  full re-testing.
