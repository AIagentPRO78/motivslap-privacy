# redstack ETHOS

The operating principles. Every contributor, every operator, every agent
inherits these. PRs that soften any of them need maintainer + security-review
sign-off.

## 1. Authorization-first

No agent takes an active action without a valid, in-scope, in-window
authorization token derived from a signed Letter of Authorization (LOA).
The check lives in `lib/scope-guard` and is the first step of every skill
preamble. There is no override flag. There is no `--yolo`.

If the customer cannot produce an LOA naming the assets, we do not test
those assets. Full stop.

## 2. Defensive proof-of-concept only

A PoC exists to prove the vulnerability, not to weaponize it. The bar is
**minimum viable evidence**:

- Data-read vulns: fetch one canary record, not the table.
- RCE: run a benign marker command (`whoami`, `hostname`, write a timestamp
  to a redstack-owned file), not a shell.
- XSS: pop a DOM marker with a redstack nonce, not a keylogger.
- SSRF: request a redstack canary URL, not an internal metadata endpoint
  unless scope explicitly permits.

No persistence. No self-propagation. No evasion of the asset owner's
defensive tooling. If the operator needs more to prove impact, they escalate
to the human lead, not the agent.

## 3. Customer data is radioactive

Evidence samples are minimized, redacted before storage, and retained only
for the report cycle. Defaults match the strictest applicable regime
(GDPR + HIPAA). Customers can cryptographically purge at any time via key
destruction.

If in doubt, capture less. A finding with a redacted sample and a clear
repro is more valuable than one with ten un-redacted records.

## 4. Audit log is append-only and the source of truth

Every action — request issued, payload sent, host touched, finding produced,
refusal raised — writes a structured event to the engagement audit log. The
log is signed per entry, optionally anchored to a transparency ledger, and
cannot be edited after the fact.

If it isn't in the log, it didn't happen. If it happened and isn't in the
log, that's a bug and it blocks the release.

## 5. Kill switch is one keystroke

Both the customer and the lead operator can halt every running agent and
sever every active session immediately. The kill path is tested in CI.
"Couldn't stop it in time" is not an acceptable incident postmortem.

## 6. Boring beats clever

When a published tool (nmap, ZAP, semgrep, trufflehog, prowler, nuclei, ffuf,
mitmproxy) does the job, the agent shells out to it and reasons over the
results. We don't rewrite scanners. We don't invent new exploit primitives
when existing ones reproduce the finding.

The interesting work is orchestration, triage, and communication. That's
where agents earn their keep.

## 7. Human-in-the-loop for irreversibles

Anything that mutates target state — writing to a production database,
opening a shell on a production host, sending real email to real recipients,
changing DNS, rotating keys — requires a typed operator confirmation, not a
click. The confirmation is logged.

Read-only actions may proceed without per-action confirmation, subject to
scope and rate caps.

## 8. Refuse when it's right to refuse

Some things the product refuses regardless of what the customer puts in the
scope file:

- Denial-of-service or resource exhaustion.
- Mass internet scanning or untargeted credential stuffing.
- Self-propagating payloads (worm logic, USB-spreading malware).
- Persistence techniques explicitly designed to evade the asset owner's
  defensive tooling.
- Pivoting to assets not listed in the scope file, even from a valid
  foothold.
- Exfiltrating real customer/employee PII beyond a minimized, redacted
  evidence sample.

These refusals are product-level, logged with reason, and surfaced to the
operator in real time. A customer who pushes for any of these is a customer
we do not serve.

## 9. Defense-supporting, not adversary-supporting

Every finding ships with a remediation hint. Every PoC ships with detection
signals (`/purple-team` consumes them). redstack's value accrues when the
customer's defenses improve — not when they stay compromised.

We do not sell to customers who cannot articulate a defense-improvement
outcome. Red team without blue team handoff is theater.

## 10. Boil the lake (Tan's principle, kept)

Completeness is cheap in an AI-assisted workflow. When you can do the full
job in one agent-turn, do the full job. Don't ship half a scope, half a
scan, half a report. Half-done security work is worse than undone security
work because it creates false assurance.

This is gstack's principle, kept verbatim. The one place we extend it: in
offensive work, "complete" includes the detection-validation step and the
remediation hint. A finding without those is not yet complete.

---

## A note on risk

Offensive security tooling is dual-use. redstack's defense against misuse
is not a promise; it is the architecture: LOAs, signed scope files,
product-level refusals, append-only audit, kill switches, and the
defensive-PoC bar. If you find yourself reaching for a workaround to any
of these, stop and talk to the maintainer. There is almost always a
defensible path.
