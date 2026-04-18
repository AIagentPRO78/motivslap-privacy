---
name: engagement
version: 0.1.0
description: |
  Engagement lifecycle manager. Loads the signed LOA and `scope.yaml.signed`,
  verifies signatures, runs the AUTHORIZATION.md §8 intake checklist, issues
  the engagement token, opens the audit log, and transitions the engagement
  from `draft` to `active`. Also handles pause, freeze, resume, and close.
  Use when: the operator says "activate", "load scope", "open engagement",
  "pause", "resume", "close engagement".
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
triggers:
  - activate engagement
  - load scope
  - open engagement
  - freeze
  - resume
  - close engagement
---

## Preamble: scope-guard check

`/engagement` is the only skill that legitimately runs before an engagement
is `active` — because its job is to make it `active`. scope-guard is called
with `action = meta.engagement_transition` and the only checks that apply
are:

1. Operator is an authenticated redstack operator and named in the draft
   scope's `operators` list.
2. The action class is product-allowed.

After a successful `active` transition, subsequent `/engagement` calls
(pause, freeze, resume, close) go through the normal scope-guard path.

## Role

You are the gatekeeper. You verify the cryptographic and procedural
integrity of a scope before any other skill is allowed to run. You are
also the only skill that can freeze or close an engagement.

You do not test anything. You do not open network connections to targets.
You do not read customer repositories. You only verify signatures, run
checklists, and flip state.

## Inputs

- `<eng-id>.draft-scope.yaml` — from `/office-hours`.
- `<eng-id>.loa.pdf` — the signed Letter of Authorization.
- `<eng-id>.scope.yaml.signed` — scope with Ed25519 signature.
- `<eng-id>.loa-checklist.md` — intake checklist.
- Customer public key on file.

## Method

### Transition: `draft` → `active`

1. **Locate all inputs.** If any are missing, refuse with a specific list
   of what's missing.

2. **Verify LOA hash.**
   - Compute SHA-256 of the LOA PDF. Must match `engagement.loa_ref` in
     the scope file. Mismatch → refuse with `loa.hash_mismatch`.

3. **Verify scope-file signature.**
   - Canonicalize `scope.yaml.signed` (see `lib/scope-guard` §2).
   - Resolve the signing key to the authorizing officer's key fingerprint
     on file.
   - Ed25519 verify. Failure → refuse with `scope.signature_invalid`.
     Emit a product-level alert.

4. **Run the AUTHORIZATION.md §8 checklist** in order. Any unchecked box
   refuses with `intake.checklist_<item>_missing`.

5. **Sanity-check targets.**
   - No loopback, redstack-internal, or cloud-metadata addresses in scope.
   - No wildcards against TLDs or public cloud shared resources.
   - No out-of-scope overlap errors (contradictions between `targets` and
     `out_of_scope` that cannot be resolved by "out-of-scope wins").

6. **Issue the engagement token.** A new UUID, bound to the engagement id
   and the operator list. Written into `engagement.json`.

7. **Open the audit log.** Initialize `audit.jsonl` with an
   `engagement.activated` entry signed with a fresh per-engagement key.

8. **Transition state.** `engagement.json` goes from `draft` to `active`.

9. **Notify.** Send "engagement active" to the notification contacts in
   scope. Test the kill-switch contacts by requesting an ack within 24
   hours; if no ack, the engagement auto-freezes.

### Other transitions

| From       | To         | Trigger                                              |
| ---------- | ---------- | ---------------------------------------------------- |
| `active`   | `paused`   | Operator requests pause; reversible.                 |
| `active`   | `frozen`   | Kill switch activated; or scope-guard tripwire (3 denies in 60s); irreversible without customer ack. |
| `paused`   | `active`   | Operator resumes; must confirm operator still in scope.operators. |
| `frozen`   | `active`   | Requires customer authorizing-officer ack + fresh operator auth. |
| `active`   | `expired`  | Automatic at `time_windows.utc_end`.                 |
| any        | `closed`   | Operator or customer closes; final audit entry +     |
|            |            | archive bundle generated.                            |

Every transition writes an `engagement.<new_state>` audit event.

## Guardrails

- **Never accept an unsigned scope file.** Not even in dev mode. If a
  developer needs to iterate, they sign with a dev key and the engagement
  is tagged `dev` in every audit entry.
- **Never accept an LOA with an expired date.** Past-dated LOAs refuse
  at intake.
- **Never extend a time window silently.** Extensions require a new
  signed scope file; this skill does not mutate `time_windows`.
- **Never resume from `frozen` without the full re-auth path.**
- **Never delete audit entries.** Even for closed engagements. Customer
  cryptographic deletion is handled by key destruction at the storage
  layer, not by this skill.

## Outputs

- `engagement.json` — authoritative engagement record with state, token,
  and key fingerprint.
- `audit.jsonl` — opened with `engagement.activated` or whatever transition.
- Notification side-effects: emails / pages to scope contacts.

## Handoffs

- `/recon` — first skill to run after activation.
- All other skills — they can now pass scope-guard.
- `/retro` — at engagement close, reads the full audit + finding set.
