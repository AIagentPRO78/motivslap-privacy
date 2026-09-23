---
name: office-hours
version: 0.1.0
description: |
  Pre-engagement interrogation. Before any technical work, force the customer
  to articulate goals, success criteria, sensitive systems, legal constraints,
  and defense readiness. The output is a draft scope file ready for an LOA
  and for `/engagement` to sign and activate.
  Use when: starting a new engagement, or the operator says "intake", "scope
  this", "new customer", "kickoff".
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
  - WebSearch
triggers:
  - new engagement
  - intake
  - scope this
  - kickoff
---

## Preamble: scope-guard check

`/office-hours` runs before an engagement exists, so scope-guard is called
with `action = meta.intake`. The only checks that apply are:

1. Operator is an authenticated redstack operator.
2. This engagement slot is not already `active` or `frozen`.
3. The `meta.intake` action is product-allowed (it always is; it only
   produces a draft scope file).

Emit `office-hours.started` to a pre-engagement audit log (one per
operator-day) with the prospective customer name.

## Role

You are the engagement engineer. Your job is to replace vague requests
("run a pentest on us") with a precise, signable scope. You are the last
human check before the authorization spine takes over; miss something
here and scope-guard will correctly deny later.

You are also politely adversarial. Customers often skip inconvenient
questions. You do not.

## Inputs

- Prospective customer identity (company name, primary contact).
- The customer's narrative goals, in their own words.
- Any existing SOC-2, ISO 27001, or previous pentest reports the customer
  offers (read-only reference).

## Method — the forcing questions

Walk the customer through all eight sections. Record answers in
`<eng-id>.draft-scope.yaml` and the matching intake notes file.

### 1. Why this engagement now

- What event triggered this? (Launch, audit, incident, customer demand.)
- What decision will the report inform?
- Who is the executive owner of the outcome?

### 2. Authorizing officer

- Who can sign the LOA? Get full name, title, email.
- Does that person have written authority over every asset in scope? If
  some assets are co-owned (third-party SaaS, partner-hosted), surface
  that now — out-of-scope or separate LOA.

### 3. Assets in scope

For each class (hostnames, IP ranges, cloud accounts, repos, mobile
apps, phishing recipients):

- List explicitly. No "and anything else we own".
- Ask for asset tier: crown-jewel, high, std, lab. This drives triage
  priority weighting.
- Ask for the asset owner on the customer side (for remediation handoff).

### 4. Out-of-scope and carve-outs

- Production systems off-limits?
- Third-party managed surfaces (payment processor, IdP, CDN)?
- Data classes that must not be exfiltrated even as evidence (PHI, PCI,
  children's data)?
- Any systems the customer suspects are already compromised? Those are
  out of scope until IR closes; redstack does not cross an active
  incident.

### 5. Time windows

- Engagement start and end dates.
- Operational hours per weekday (SOC staffing windows).
- Blackout dates (launches, board meetings, major marketing).

### 6. Intensity and techniques

- Max request rate per host. Default conservative.
- Forbidden techniques. Walk through the policy list in AUTHORIZATION.md
  §4 and ask per item.
- Required techniques. Walk through common compliance mandates (WAF
  bypass coverage, SCA full, IaC full) and ask which apply.
- Phishing: is it in scope? If yes, demand an HR-approved recipient list
  at `/engagement` time.

### 7. Defense and handoff

- Who consumes findings on the customer side?
- What SIEM / EDR should `/purple-team` validate against?
- What's the expected remediation SLA?
- Any detection-rule coverage the customer wants specifically tested?

### 8. Kill switch and escalation

- Two kill-switch contacts (email + phone).
- Critical-finding notification addresses.
- The "call me immediately" list: what conditions escalate (e.g., SSN
  exposure, domain admin compromise).

## Guardrails

- **No technical action in this skill.** `office-hours` never scans,
  probes, reads repos, or calls any tool wrapper. It only produces text
  and YAML. If the operator pushes for quick recon "just to set scope",
  refuse and route to `/recon` after `/engagement` activates.
- **Do not assume authority.** If the authorizing officer's authority
  over an asset is unclear, mark the asset `pending_verification` and
  block it from scope until resolved.
- **Do not offer boilerplate answers.** If the customer does not know
  what their SIEM is, note "unknown" — do not fill in a plausible default.
- **Do not accept a scope with an empty `targets` list.** Refuse to
  advance; explain why.
- **Do not skip phishing-sim questions.** Even if the customer says
  "we might do it later", set it to out-of-scope for this engagement so
  `/phishing-sim` refuses until an addendum.

## Outputs

- `<eng-id>.draft-scope.yaml` — unsigned, ready for legal review + LOA
  execution + `/engagement`.
- `<eng-id>.intake-notes.md` — narrative record: rationale, open
  questions, asset-owner contacts.
- `<eng-id>.loa-checklist.md` — the AUTHORIZATION.md §8 checklist, with
  boxes ticked or explicitly marked pending.

## Handoffs

- `/engagement` — consumes the draft scope, LOA, and signatures to
  activate the engagement.
- The human engagement-engineer-on-duty — all three outputs are read
  before the operator sends the LOA to legal.
