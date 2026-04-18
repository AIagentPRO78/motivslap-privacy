# lib/audit-log

The append-only evidence trail. Every allow, deny, refusal, and state-changing
action writes one entry. If it isn't in the log, it didn't happen.

## Storage

- **CLI mode:** `~/.redstack/engagements/<eng-id>/audit.jsonl`
  - One JSON object per line, UTF-8, LF-terminated.
  - Append-only. `fsync` after every entry.
  - Per-engagement key signs each entry; a daily Merkle root is signed
    with the engagement key and optionally anchored externally.
- **SaaS / appliance mode:** immutable Postgres table + S3 Object Lock
  mirror. Same schema; same signing.

## Entry schema

```jsonc
{
  "id":            "ae-01HXYZ...",         // ULID
  "ts":            "2026-04-18T13:42:05.123Z",
  "engagement_id": "ENG-2026-Q2-EXAMPLE-001",
  "operator_id":   "alex@redstack-mssp.example",
  "skill":         "web-app",              // or "scope-guard", "redstack",
                                           //    "kill-switch", "engagement"
  "action":        "http_request.read",    // §4 in lib/scope-guard.md
  "target_ref":    "https://api.example.com/v1/users",
                                           // normalized; null if not an
                                           // action event (e.g. routing)
  "decision":      "allow",                // allow | deny | info
  "reason":        "scope_guard.allow",    // stable machine key
  "payload_hash":  "sha256:4b3f...",       // of request/response body
                                           // null when not applicable
  "duration_ms":   132,                    // null for instantaneous
  "parent_id":     "ae-01HXYY...",         // previous event on the same
                                           // engagement; forms a chain
  "signature":     "ed25519:base64..."     // over canonicalized body
}
```

### Canonicalization

The signature covers the entry with `signature` removed, `id` present,
keys sorted, whitespace-minimized JSON, UTF-8, no trailing newline. Any
deviation invalidates.

### parent_id chain

Every entry points to the previous entry in the engagement's log. This
gives us a hash-linked chain; tampering with any entry breaks every
downstream verification.

## Event categories

- **`scope_guard.*`** — every allow/deny decision from `lib/scope-guard`.
- **`product_refusal.*`** — product-level refusals (§4 in AUTHORIZATION.md).
  Never toggleable.
- **`kill_switch.*`** — armed, activated, acknowledged by a skill, cleared.
- **`engagement.*`** — state transitions: created, activated, paused,
  frozen, expired, closed.
- **`<skill>.*`** — skill-internal events (e.g., `web-app.request_sent`,
  `cloud-audit.api_call`, `exploit-poc.evidence_captured`).
- **`operator.*`** — authentication, confirmation, kill-switch issuance.
- **`redstack.route`** — router decisions from the top-level skill.

## Writer contract

Every callsite — skills, scope-guard, tool wrappers — writes via a single
helper (`lib/audit-log.ts` in M3). The helper:

1. Fills `ts`, `id`, `parent_id`, `engagement_id`, `operator_id`
   automatically.
2. Signs the entry with the per-engagement key.
3. Appends + `fsync`s (CLI) or transactionally inserts (SaaS).
4. Returns the new `id` so the caller can chain follow-up events.

Writers NEVER include:

- Raw request/response bodies. Use `payload_hash` and store the body under
  `engagements/<id>/artifacts/<hash>` with per-artifact encryption.
- Secrets or session tokens. These are redacted at the helper boundary.
- Personally identifying information from captured evidence. `/exploit-poc`
  runs evidence through a redactor before the reference reaches the log.

## Read / verify contract

An audit log can be independently verified by:

1. Loading the engagement's public signing key.
2. Re-canonicalizing each entry and verifying its signature.
3. Walking `parent_id` from the tail back to the head and checking the
   chain is unbroken.
4. If a Merkle root was anchored externally, verifying the root matches
   the log.

A standalone `redstack audit verify <engagement>` command (M3) performs
all four and exits non-zero on any mismatch.

## Retention

- Default: 7 years after engagement close.
- Customer can shorten via contract (minimum: end of report cycle + 30
  days).
- Customer can cryptographically delete at any time by destroying the
  per-engagement key; the log becomes unreadable but its existence and
  Merkle roots remain, preserving tamper evidence.

## What never goes in the audit log

- Operator passwords or API tokens.
- Customer employee PII beyond a redacted sample reference.
- Full request/response bodies (hash only).
- Random debug prints. Debug events go to local dev logs, not the engagement
  audit log.

## CI invariants

M3 tests enforce:

- Every scope-guard decision produces exactly one entry.
- Every skill-declared action class produces at least one entry per
  invocation.
- Chain is unbroken across a full reference engagement.
- No payload body is ever persisted into an entry — only hashes.
- Signature verification passes for every entry in the reference corpus.
