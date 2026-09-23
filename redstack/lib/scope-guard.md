# lib/scope-guard

The mandatory pre-flight check every skill calls as the first step of its
preamble. This doc is the **specification**. The M3 implementation will
live at `lib/scope-guard.ts`; skills reference the spec until then.

## Invocation

Every SKILL.md preamble, step 0:

> Call `lib/scope-guard` with the intended action(s) and target(s). If it
> returns `deny`, STOP, surface the reason to the operator, and exit the
> skill. Do not retry silently. Do not ask the operator to "try again".

## Inputs

```jsonc
{
  "engagement_id": "ENG-2026-Q2-EXAMPLE-001",
  "operator_id":   "alex@redstack-mssp.example",
  "skill":         "web-app",
  "action":        "http_request",           // see §4 action taxonomy
  "targets":       ["https://api.example.com/v1/users"],
  "intensity":     { "rps": 10, "parallel": 2 },
  "irreversible":  false                     // true = state-mutating
}
```

## 1. Checks (run in order; first fail returns `deny`)

1. **Engagement exists + active.**
   - Load `engagement.json`. State must be `active`. If `draft`, `frozen`,
     `expired`, or `closed` → deny with `engagement.not_active`.

2. **Scope-file signature valid.**
   - Verify the Ed25519 signature on `scope.yaml.signed` using the key
     fingerprint bound to the engagement. If verify fails → deny with
     `scope.signature_invalid`. Emit a product-level alert.

3. **Time window.**
   - Current UTC inside `[utc_start, utc_end]` AND current weekday's
     `operational_hours`. Outside → deny with `scope.outside_window`.

4. **Operator authorized.**
   - `operator_id` present in scope `operators`. Absent → deny with
     `operator.not_authorized`.

5. **Target in-scope.**
   - For every target in the request, run `match_target()` (§3). Every
     target must match `targets` AND NOT match `out_of_scope`. Any miss →
     deny with `target.out_of_scope` and the offending target.

6. **Technique allowed.**
   - If `action` is in `forbidden_techniques` → deny with
     `technique.customer_forbidden`.
   - If `action` is in the product-level refusal list (see
     `AUTHORIZATION.md §4`) → deny with `technique.product_refusal`
     regardless of scope.

7. **Intensity ceiling.**
   - `intensity.rps` ≤ `scope.intensity.max_rps_per_host`.
   - `intensity.parallel` ≤ `scope.intensity.max_parallel_hosts`.
   - Over → deny with `intensity.exceeded` OR queue if the caller
     requested queuing.

8. **Irreversible action confirmation.**
   - If `irreversible` is `true`, require a typed operator confirmation
     within the last 60 seconds (session-scoped nonce). Missing → deny
     with `irreversible.no_confirmation`.

9. **Kill-switch state.**
   - If the engagement bus has a `kill_switch.activated` event newer than
     this invocation's timestamp → deny with `engagement.frozen`.

On all checks passing: return `allow` and emit `scope_guard.allow` to the
audit log.

## 2. Signature verification (canonicalization)

```
bytes = canonicalize_yaml(scope.yaml)          # sorted keys, LF, UTF-8,
                                               # no trailing whitespace
ok = ed25519_verify(
  public_key = engagement.key_fingerprint_resolves_to,
  message    = bytes,
  signature  = scope.signature.value,
)
```

If canonicalization differs by one byte, verification fails. The
engagement-engineer CLI (M3) is the only supported signer; hand-edits
after signing invalidate the file and require re-signing.

## 3. Target matching

```
match_target(target, scope):
  kind = classify(target)           # hostname | ipv4 | ipv6 | cloud_account
                                    # | repository | mobile_bundle
  match kind:
    hostname:
      return any(fnmatch(target, p) for p in scope.targets.hostnames)
             and not any(fnmatch(target, p) for p in scope.out_of_scope.hostnames)
    ipv4:
      return any(ip_in_cidr(target, c) for c in scope.targets.ipv4_cidrs)
             and not any(ip_in_cidr(target, c) for c in scope.out_of_scope.ipv4_cidrs)
    ...
```

Redstack-internal / loopback / RFC1918-without-explicit-listing targets
are **always** denied, even if a wildcard would match them.

## 4. Action taxonomy

Every skill declares its actions against this taxonomy. scope-guard uses
the action key to apply the technique allow/deny lists.

| Action key                             | Typical skill              | Class           |
| -------------------------------------- | -------------------------- | --------------- |
| `recon.passive_osint`                  | `/recon`                   | read-only       |
| `recon.dns_enumeration`                | `/recon`                   | read-only       |
| `recon.port_scan`                      | `/recon`, `/network`       | read-only       |
| `http_request.read`                    | `/web-app`, `/recon`       | read-only       |
| `http_request.state_mutating`          | `/web-app`                 | irreversible    |
| `source_scan.sast`                     | `/source-review`           | read-only       |
| `source_scan.secrets`                  | `/source-review`           | read-only       |
| `source_scan.sca`                      | `/source-review`           | read-only       |
| `cloud.read_config`                    | `/cloud-audit`             | read-only       |
| `cloud.permission_escalation_probe`    | `/cloud-audit`             | irreversible    |
| `binary.static_analysis`               | `/binary-analysis`         | read-only       |
| `binary.fuzz`                          | `/binary-analysis`         | read-only (lab) |
| `network.service_probe`                | `/network`                 | read-only       |
| `identity.password_policy_check`       | `/identity`                | read-only       |
| `identity.credential_test`             | `/identity`                | irreversible    |
| `mobile.static_analysis`               | `/mobile`                  | read-only       |
| `mobile.dynamic_instrument`            | `/mobile`                  | irreversible    |
| `exploit.poc_read`                     | `/exploit-poc`             | evidence-read   |
| `exploit.poc_state_mutating`           | `/exploit-poc`             | irreversible    |
| `phishing.send`                        | `/phishing-sim`            | irreversible    |
| `postex.lateral_move_lab`              | `/post-exploitation`       | irreversible    |
| `purple.detection_check`               | `/purple-team`             | read-only       |

Product-level refusals map to action keys that do NOT appear in this table
and MUST be rejected if a skill ever invents them:

- `dos.*`
- `scan.internet_wide`
- `persistence.evade_owner`
- `worm.*`
- `exfil.pii_beyond_sample`
- `pivot.out_of_scope`

## 5. Outputs

```jsonc
{
  "decision": "allow" | "deny",
  "reason":   "scope_guard.allow" | "target.out_of_scope" | ...,
  "details": {
    "engagement_id": "...",
    "operator_id": "...",
    "skill": "...",
    "action": "...",
    "targets": [...],
    "first_failing_check": "scope.outside_window" // deny only
  }
}
```

On allow: skills proceed. On deny: skills STOP and surface the `reason`
verbatim to the operator. Every invocation, allow or deny, produces one
audit entry via `lib/audit-log`.

## 6. Determinism & testing

scope-guard must be deterministic — same inputs, same outputs. The M3
implementation ships with:

- Unit tests per check.
- Fuzz tests on target-matching (IPv6 scope creep is a known class of bug).
- A golden-file test suite: canned engagement + request → expected decision.
- A CI check that forbids any code path around scope-guard.

## 7. What scope-guard is NOT

- It is **not** a vulnerability scanner. Skills do the work; scope-guard
  gates the work.
- It is **not** a replacement for the LOA. The LOA is the legal instrument;
  scope-guard is the runtime enforcement.
- It is **not** a substitute for product-level refusals. Some actions are
  denied regardless of what the customer signed.
