# redstack — Architecture

> **Status:** Founding design doc, v0.1.0. Working name "redstack" — a fork of
> the [gstack](https://github.com/garrytan/gstack) skill model, repurposed as a
> commercial AI-driven red-teaming product. Replace the name freely; the
> structure is what matters.

---

## 1. Product positioning

**redstack** turns a Claude Code (or compatible agent host) install into a
virtual offensive-security team operating under a signed Rules of Engagement
(RoE). Each specialist role — recon, web-app, cloud, source review, network,
identity, exploit-PoC, post-ex, purple-team, reporter, etc. — is a markdown
SKILL persona that shares a common authorization spine, audit log, and finding
schema.

The product is sold to:

| Buyer                              | Job-to-be-done                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| MSSPs / boutique pentest firms     | 5–10× consultant throughput; consistent quality; junior staff produce senior-level reports.   |
| Enterprise internal red teams      | Continuous, scoped testing of new releases without scaling headcount.                         |
| Bug bounty triage teams            | Triage, dedupe, and reproduce inbound submissions at machine speed.                           |
| Compliance-driven mid-market       | Quarterly attested pentests at a price point that previously bought one consultant-week.      |

We **explicitly do not** sell to: unaffiliated individuals targeting third
parties, governments without published rules of engagement, or anyone who
declines to sign an LOA naming the assets in scope.

---

## 2. Design principles (the spine)

These are non-negotiable and every agent persona must inherit them.

1. **Authorization-first.** No agent takes an active action without a valid,
   in-scope, in-window authorization token derived from a signed LOA. This is
   enforced in `lib/scope-guard` and called as the first step of every skill.
2. **Defensive proof-of-concept only.** Exploits demonstrate *evidence of
   vulnerability* — a single read of canary data, a benign command execution
   marker, a controlled DOM injection. They are never weaponized, persistent,
   self-propagating, or designed to evade the asset owner's defenses.
3. **Customer data is radioactive.** Anything captured during testing is
   minimized, redacted, and retained only for the report cycle. Defaults match
   the strictest applicable regime (GDPR + HIPAA). Customer can purge any time.
4. **Audit log is append-only.** Every agent action — request issued, payload
   sent, host touched, finding produced — writes a structured event to a
   tamper-evident log. The log is the legal evidence trail.
5. **Kill switch is one keystroke.** The customer (and the lead operator) can
   halt every running agent and sever every active session immediately. Halt is
   logged and tested in CI.
6. **Boring beats clever.** When a published tool (nmap, ZAP, semgrep, trufflehog,
   prowler) does the job, the agent shells out to it and reasons over the
   results — we don't reinvent scanners.
7. **Human-in-the-loop for irreversibles.** Anything that mutates target state
   (writing to a database, opening a shell on a production host, sending real
   email to real users) requires a typed operator confirmation, not a click.

---

## 3. Engagement lifecycle

```
┌───────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌────────┐
│ /office-  │->│ /engage-  │->│ /recon   │->│ /<surface │->│ /exploit │->│ /report │->│ /retro │
│   hours   │  │   ment    │  │          │  │   skill>  │  │   -poc   │  │         │  │        │
└───────────┘  └───────────┘  └──────────┘  └───────────┘  └──────────┘  └─────────┘  └────────┘
   intake       sign LOA &     attack         vuln          minimum-       findings    learnings
                load scope     surface        discovery     viable PoC     + exec      + ATT&CK
                                                                          summary     coverage
                                                                                       map
```

Each arrow is a **handoff contract**: a JSON document on the engagement bus
(local on-disk in CLI mode, durable in SaaS mode) that downstream skills read
and that the audit log indexes.

The customer can pause, resume, scope-down, or terminate at any arrow.

---

## 4. Agent roster

18 agents in v0.1, grouped by phase. Each is a SKILL.md persona under
`redstack/<name>/SKILL.md`, mirroring gstack's layout.

### 4.1 Strategy & control

| Skill            | Role                                                                                             | Forked from gstack |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| `/office-hours`  | Pre-engagement interrogation — forces clarity on goals, success criteria, sensitive systems.     | `office-hours`     |
| `/engagement`    | Loads + validates LOA, materializes the scope file, opens the engagement bus & audit log.        | `cso` + `ship`     |

### 4.2 Discovery

| Skill     | Role                                                                              | Forked from gstack |
| --------- | --------------------------------------------------------------------------------- | ------------------ |
| `/recon`  | Passive OSINT (certs, DNS, GitHub, breach data) + active enumeration of in-scope. | `investigate`      |

### 4.3 Surface-specialist vulnerability hunters

| Skill              | Surface                                                                              | Forked from gstack          |
| ------------------ | ------------------------------------------------------------------------------------ | --------------------------- |
| `/web-app`         | OWASP Top 10 + business logic; orchestrates ZAP/nuclei/Burp; drives `/browse`.       | `qa` + `cso`                |
| `/cloud-audit`     | AWS/GCP/Azure misconfig (Prowler, ScoutSuite, custom CSPM rules).                    | `cso`                       |
| `/source-review`   | SAST (Semgrep, CodeQL), secrets (trufflehog), SCA, IaC (checkov).                    | `review` + `cso`            |
| `/binary-analysis` | Reverse engineering, fuzzing, dependency CVE matching for compiled artifacts.        | `investigate`               |
| `/network`         | Service enumeration, protocol-level testing, lateral path discovery.                 | new                         |
| `/identity`        | IAM, SSO, MFA, session, password policy testing — strictly against in-scope IdPs.    | new                         |
| `/mobile`          | iOS / Android static + dynamic; certificate pinning, IPC, secure storage.            | new                         |

### 4.4 Validation & exploitation

| Skill                | Role                                                                                       | Forked from gstack |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| `/exploit-poc`       | Builds the minimum-viable PoC for a finding. Defensive; canary-only. No weaponization.     | new                |
| `/phishing-sim`      | Designs + sends in-scope phishing campaigns. Requires named recipients + HR sign-off.      | new                |
| `/post-exploitation` | Lateral movement simulation in lab/cyber-range only. Production blocked by scope-guard.    | new                |

### 4.5 Defense validation

| Skill          | Role                                                                                   | Forked from gstack |
| -------------- | -------------------------------------------------------------------------------------- | ------------------ |
| `/purple-team` | Verifies SIEM/EDR detections fired for each PoC; produces detection-coverage matrix.   | `qa`               |
| `/canary`      | Post-engagement monitoring — alerts if any finding regresses or a stale agent persists.| `canary`           |

### 4.6 Communication & learning

| Skill        | Role                                                                                | Forked from gstack |
| ------------ | ----------------------------------------------------------------------------------- | ------------------ |
| `/triage`    | Dedupes, scores (CVSS 4.0 + EPSS), prioritizes findings by exploitability × impact. | `review`           |
| `/reporter`  | Generates exec summary + technical findings + remediation playbook, customer-ready. | `document-release` |
| `/retro`     | Engagement retrospective + ATT&CK coverage map + skill-quality metrics.             | `retro`            |

---

## 5. Authorization model

### 5.1 Layered enforcement

```
        Customer signs LOA  ────────────────────────┐
                            │                       │
        Scope file derived  │  scope.yaml           │
                            │                       │
        Per-engagement      │                       │
        token issued        │  ENG-<uuid>           │
                            │                       │
        Per-skill invocation│  scope-guard preamble │
        validates token,    │  ──────►  ALLOW       │
        target, window,     │           DENY (logged│
        and operator        │           + raise)    │
                            ▼                       ▼
        Every action        ──► append-only audit log
```

### 5.2 What the scope file declares

- **Targets:** explicit hostnames, IP CIDRs, cloud account IDs, repository
  URLs, mobile app bundle IDs, employee email lists (for phishing-sim).
- **Out of scope:** any asset not listed is denied by default.
- **Time windows:** UTC start/end + per-day operational hours; weekends opt-in.
- **Intensity ceiling:** request rates, parallelism, bandwidth caps.
- **Forbidden techniques:** customer-vetoed actions (e.g., "no DoS", "no
  credential testing against the production IdP", "no real phishing emails").
- **Required techniques:** customer-mandated tests (e.g., "must validate WAF
  bypass coverage").
- **Notification routing:** who gets paged on critical findings, kill-switch
  contacts.

The scope file is signed (Ed25519) by the customer's authorizing officer at
LOA execution. The signature is verified at every skill preamble.

### 5.3 What the framework refuses regardless of customer wishes

These are **product-level** refusals, not customer-toggleable:

- DoS / resource-exhaustion attacks against any target.
- Mass internet scanning or untargeted credential stuffing.
- Self-propagating payloads (worm logic, USB-spreading malware).
- Persistence techniques explicitly designed to evade the asset owner's
  defensive tooling.
- Payloads targeting infrastructure not listed in the scope file, even if
  reachable from a foothold.
- Exfiltrating real customer/employee PII beyond a 1-record evidence sample,
  which is auto-redacted before storage.

Refusals are logged with reason and surfaced to the operator in real time.

---

## 6. Data flow & handoff contracts

All inter-skill state lives on the **engagement bus**:

- **CLI deploy:** `~/.redstack/engagements/<eng-id>/` (JSONL events,
  artifacts, scope.yaml.signed, audit.log).
- **SaaS deploy:** Postgres + S3 (per-tenant KMS keys, immutable audit table).

Handoff documents are JSON Schema-validated. Core schemas:

| Schema           | Producer                | Consumers                                            |
| ---------------- | ----------------------- | ---------------------------------------------------- |
| `Asset`          | `recon`                 | every surface specialist                             |
| `Finding`        | every surface specialist| `triage`, `exploit-poc`, `reporter`                  |
| `PoC`            | `exploit-poc`           | `purple-team`, `reporter`                            |
| `DetectionEvent` | `purple-team`           | `reporter`                                           |
| `AuditEvent`     | every skill             | audit log (write-only), `retro`                      |

A `Finding` carries: surface, target ref, vulnerability class (CWE), CVSS 4.0
vector, EPSS score, evidence references, dedupe hash, and a remediation hint.

---

## 7. Audit log & chain of custody

- Append-only JSONL, optionally mirrored to immutable storage (AWS Object
  Lock, GCS retention policies).
- Every entry signed with the engagement key; periodic Merkle-root anchoring
  to a customer-chosen ledger (internal PKI, Sigstore, or transparency log).
- Retention: 7 years default, customer-configurable. Customer can request
  cryptographic deletion (key destruction) at any time.
- Exportable as a single signed bundle for SOC 2 / ISO 27001 evidence.

---

## 8. Deployment models

| Mode                | Topology                                                                | When to choose                                       |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| **CLI / consultant**| Skills install to `~/.claude/skills/redstack/` on the operator's box.   | MSSP per-consultant, individual researchers.         |
| **Team / on-prem**  | Skills + engagement bus on a hardened appliance inside customer VPC.    | Enterprise internal red teams, regulated industries. |
| **SaaS multi-tenant** | Hosted control plane, customer-isolated worker pools per engagement. | Mid-market, bug bounty triage, scale.                |

All modes share the same SKILL.md files; only the engagement bus and
authentication backend swap.

---

## 9. Tech stack

- **Agent host:** Claude Code (primary), with portability stubs for Codex,
  Cursor, Factory Droid, OpenCode (mirrors gstack's `hosts/` adapter pattern).
- **Skill format:** Markdown with YAML frontmatter (gstack-compatible).
- **Browser automation:** reuse gstack's `browse/` Playwright-based binary.
- **Tool orchestration:** shell-out wrappers for ZAP, nuclei, nmap, semgrep,
  trufflehog, prowler, ScoutSuite, checkov, ffuf, sqlmap, mitmproxy, etc.
  Each wrapper enforces scope-guard *before* invoking the underlying tool.
- **Engagement bus:** SQLite (CLI), Postgres + S3 (SaaS).
- **Signing / crypto:** libsodium / age for keys, Sigstore for log anchoring.
- **Languages:** TypeScript (CLI + bus + adapters), Python only where the
  tool ecosystem requires it (e.g., custom Semgrep rules).

---

## 10. Compliance posture (target state for v1.0)

- SOC 2 Type II within 12 months of GA.
- ISO 27001 annex A controls mapped to product features (audit log, access
  control, key management).
- HIPAA BAA available for customers handling PHI.
- GDPR Art. 28 DPA template; EU data residency option in SaaS.
- Customer DPO contact required at LOA signing.
- Sub-processor list public; customer can veto sub-processors per-engagement.

---

## 11. Packaging (v1.0 working assumption)

| Tier              | Audience                       | Includes                                                  |
| ----------------- | ------------------------------ | --------------------------------------------------------- |
| **Operator**      | Solo consultant / researcher   | CLI, all skills, BYO Claude Code + tools, community Slack |
| **Team**          | Pentest firm / internal RT     | Operator + on-prem appliance + audit bundle export + SSO  |
| **Enterprise**    | Regulated mid-market / large   | Team + SaaS option, dedicated SE, custom skill packs      |
| **Bounty triage** | Bug bounty platforms / brands  | API-first, dedupe + repro focus, no exploit-poc by default|

Pricing model: per-active-engagement-month with a floor; not per-finding (no
incentive misalignment).

---

## 12. Open questions for the next design pass

1. **Plug-in surface for customer-specific tools.** Many customers have
   licensed scanners (Burp Pro, Tenable, Qualys). How do their results join
   the engagement bus without us reimplementing each integration?
2. **Multi-operator collaboration.** Two consultants on one engagement —
   conflict resolution on the bus, branch-style worktrees, or hard locks?
3. **Customer self-service scoping.** Can customers safely author their own
   scope.yaml, or do we require a redstack engagement engineer to derive it
   from the LOA narrative?
4. **Exploit-PoC review board.** Should every PoC require a second-agent or
   second-human review before execution? Default ON for production-class
   targets is the conservative answer.
5. **Telemetry.** Opt-in only, never includes target identifiers, payloads,
   findings, or customer code. Mirror gstack's stance.
6. **Open core vs closed.** gstack is MIT. We can plausibly open-source the
   skill personas + scope-guard, hold the SaaS control plane and the
   compliance bundle proprietary. Decide before naming the repo.

---

## 13. Out of scope for v0.1

- The actual implementations of each agent (the SKILL.md bodies).
- The CLI / engagement bus code.
- Customer-facing UI.
- The website, marketing site, billing, identity provider integration.
- Any agent that operates without an LOA.

---

## 14. Next milestones

1. **M1 — Scaffold (next).** Materialize `redstack/` with all 18 SKILL.md
   stubs, `lib/scope-guard.md`, `lib/audit-log.md`, `scope.example.yaml`,
   `CLAUDE.md`, `README.md`, `LICENSE`, `VERSION`.
2. **M2 — Reference engagement.** End-to-end demo against a deliberately
   vulnerable target (DVWA + a contrived AWS sandbox), running `/office-hours
   → /recon → /web-app → /cloud-audit → /triage → /reporter`.
3. **M3 — Authorization spine.** Real Ed25519 signing of scope files, audit
   log anchoring, kill-switch wired through.
4. **M4 — First design partner.** One MSSP, one enterprise internal RT.
   Co-develop the on-prem appliance and the report templates with them.
5. **M5 — SOC 2 readiness assessment + GA pricing.**
