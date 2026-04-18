# redstack — Architecture

> **Status:** Founding design doc, v0.1.0. Working name "redstack" — a fork of
> the [gstack](https://github.com/garrytan/gstack) skill model, repurposed as a
> commercial AI-driven red-teaming product. Replace the name freely; the
> structure is what matters.

---

## 1. Product positioning

**redstack** is a **MacBook-only CLI** that turns Claude Code (or a compatible
agent host) into a virtual offensive-security team for customers running
**self-hosted Linux / macOS infrastructure**. Each specialist role — recon,
web-app, infra-audit, source review, network, identity, exploit-PoC, post-ex,
purple-team, reporter, etc. — is a markdown SKILL persona that shares a
common authorization spine, audit log, and finding schema.

**Scope boundary (v0.1):**

- **Operator platform:** macOS only (arm64 + x86_64). No Linux or Windows
  install targets for the operator's machine in v0.1.
- **Target surface:** self-hosted Linux / macOS infrastructure. Kubernetes
  (self-hosted distros: k3s, kind, kubeadm, k0s, OpenShift), self-hosted
  object stores (minio, Ceph, Garage, SeaweedFS), self-hosted databases,
  HashiCorp stack (Vault, Consul, Nomad), self-hosted IdPs (Keycloak,
  Authentik, Zitadel, Authelia, Dex), self-hosted CI/CD (Gitea, Woodpecker,
  Drone, Jenkins), self-hosted mail/messaging.
- **Not supported (v0.1):** hyperscaler clouds (AWS / GCP / Azure /
  Oracle / IBM), Windows hosts, Active Directory, Microsoft 365, Azure AD
  / Entra, Exchange, SharePoint, Defender/Sentinel-owned detection stacks.
  A customer who runs on any of those uses a different product. We are
  not the product for them in v0.1 — and we say so up front, not after
  they've signed.

The product is sold to:

| Buyer                                 | Job-to-be-done                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| MSSPs / boutique pentest firms        | 5–10× consultant throughput on self-hosted infra engagements; junior staff ship senior-level reports. |
| Startup / scale-up internal red teams | Continuous, scoped testing of self-hosted Kubernetes + service stack.                         |
| Open-source security researchers      | Authorized testing of self-hosted OSS deployments on customer hardware.                       |
| Compliance-driven mid-market (Linux)  | Quarterly attested pentests at a price point that previously bought one consultant-week.      |

We **explicitly do not** sell to: unaffiliated individuals targeting third
parties, anyone who declines to sign an LOA naming the assets in scope, or
customers whose primary stack is Windows / Active Directory / hyperscaler
/ Microsoft 365.

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
(on-disk under `~/.redstack/engagements/<id>/` on the operator's Mac) that
downstream skills read and that the audit log indexes.

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
| `/recon`  | Passive OSINT (certs, DNS, public code forges, breach data) + active enumeration of in-scope. | `investigate`      |

### 4.3 Surface-specialist vulnerability hunters

| Skill              | Surface                                                                              | Forked from gstack          |
| ------------------ | ------------------------------------------------------------------------------------ | --------------------------- |
| `/web-app`         | OWASP Top 10 + business logic; orchestrates ZAP/nuclei/Burp; drives `/browse`.       | `qa` + `cso`                |
| `/cloud-audit`     | Self-hosted infrastructure config audit: Kubernetes, object stores (minio / Ceph / Garage), databases, HashiCorp stack. Drives kube-bench, kubescape, trivy, checkov, KICS. | `cso`                       |
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

All inter-skill state lives on the **engagement bus**, which is just a
directory on the operator's MacBook:

- `~/.redstack/engagements/<eng-id>/` — JSONL events, artifacts,
  `scope.yaml.signed`, `audit.jsonl`, findings, tool output.
- SQLite for indexable tables (findings, audit, asset inventory).
- Per-engagement symmetric key stored in the macOS Keychain; engagement
  key fingerprint written in `engagement.json`. Key destruction ⇒
  cryptographic deletion of the engagement's evidence.

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

- Append-only JSONL on the operator's Mac at
  `~/.redstack/engagements/<eng-id>/audit.jsonl`. `fsync` after every
  entry. macOS APFS snapshots provide a point-in-time recovery surface.
- Every entry signed with the per-engagement Ed25519 key (stored in the
  macOS Keychain). Entries form a hash-linked chain via `parent_id`.
- Optional periodic Merkle-root anchoring to a customer-chosen
  transparency log (Sigstore / Rekor / an internal self-hosted
  transparency log). Anchoring is opt-in per engagement.
- Retention: as long as the operator keeps the engagement directory.
  Customer can request cryptographic deletion at any time by destroying
  the engagement key from the Keychain.
- Exportable as a single signed tarball (`redstack audit export`) for
  the customer's compliance evidence.

---

## 8. Deployment model

**v0.1 is MacBook-only, one deploy shape.** Everything runs on the
operator's Mac. No server component, no SaaS control plane, no
appliance.

| Component            | Location                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| Skills               | `~/.claude/skills/redstack/` (symlinked by `./setup`).                       |
| CLI binary           | `/usr/local/bin/redstack` (Homebrew) or `/opt/homebrew/bin/redstack` (arm64). |
| Engagement bus       | `~/.redstack/engagements/<eng-id>/` on the Mac.                              |
| Keys                 | macOS Keychain (engagement-scoped Ed25519 + symmetric keys).                 |
| Tool wrappers        | Bundled with the CLI; shell out to scanners via sandboxed subprocesses.      |
| Browser automation   | gstack's `browse/` binary, macOS build.                                      |
| Collaboration        | Operators share engagement bundles (signed tarballs) out-of-band.            |

**Future (v0.2+; not committed):** team mode (shared bus across Macs
via a self-hosted sync endpoint the customer provisions). Not SaaS,
not multi-tenant, not hosted by us.

---

## 9. Tech stack

- **Operator OS:** macOS only (Monterey 12+). arm64 + x86_64 universal
  binary. Codesigned + notarized; Gatekeeper-friendly.
- **Agent host:** Claude Code (primary), with portability stubs for
  Codex, Cursor, Factory Droid, OpenCode (mirrors gstack's `hosts/`
  adapter pattern).
- **Skill format:** Markdown with YAML frontmatter (gstack-compatible).
- **Container runtime for local lab:** OrbStack or Docker Desktop (the
  operator picks; both work). Scanners that need Linux run inside
  ephemeral containers.
- **Browser automation:** gstack's `browse/` Playwright binary, macOS
  build.
- **Tool orchestration:** scope-gated shell-out wrappers for ZAP, nuclei,
  nmap, semgrep, trufflehog, checkov, KICS, tfsec, conftest, kube-bench,
  kube-hunter, kubescape, trivy, ffuf, sqlmap, mitmproxy, syft, grype,
  osv-scanner, testssl.sh, sslyze. Windows-only tooling (Mimikatz,
  PsExec, Rubeus, BloodHound collectors, etc.) is **not bundled** — no
  Windows / AD targets are in scope.
- **Engagement bus:** SQLite on the Mac + JSONL artifacts. No network
  component.
- **Signing / crypto:** libsodium + macOS Keychain. Sigstore Rekor
  client for optional transparency-log anchoring.
- **Languages:** TypeScript (CLI + bus + adapters), compiled to a
  single Bun binary per arch. Python only where the tool ecosystem
  requires it (custom Semgrep rules).
- **Distribution:** Homebrew tap (`brew install redstack/tap/redstack`).
  Direct binary + `.pkg` installer as fallback.

---

## 10. Compliance posture (target state for v1.0)

Simplified by the MacBook-only shape: no SaaS, no data residency, no
sub-processors, no customer data ever leaves the operator's Mac.

- No SOC 2 needed for v0.1 (we don't operate a service). A future Team
  mode may require it.
- ISO 27001 annex A: relevant controls for a CLI product (audit log,
  access control, key management) documented in `AUTHORIZATION.md`.
- GDPR: we never process customer personal data on our servers (we
  don't have servers). Operator-on-Mac handling is documented for the
  customer's DPO if requested.
- HIPAA: customers handling PHI run redstack locally; no BAA with us
  is needed because we never receive their data. Operator's Mac must
  meet the customer's endpoint hygiene baseline — documented at intake.
- Customer DPO contact encouraged at LOA signing.

---

## 11. Packaging (v0.1 working assumption)

| Tier                 | Audience                         | Includes                                                  |
| -------------------- | -------------------------------- | --------------------------------------------------------- |
| **Operator (OSS)**   | Solo consultant / researcher     | CLI, all skills, Homebrew install, BYO Claude Code.       |
| **Operator Pro**     | Paid tier for individuals        | All of Operator + signed-scope tooling + priority support. |
| **Team (pilot)**     | MSSP / internal RT on Macs       | Operator Pro + shared engagement bundles + per-engagement billing. |

Pricing model: per-active-engagement-month with a floor; not per-finding
(no incentive misalignment). No SaaS tier in v0.1.

---

## 12. Open questions for the next design pass

1. **Plug-in surface for customer-specific tools.** Many customers have
   licensed scanners (Burp Pro, Tenable, Qualys). How do their results
   join the engagement bus without us reimplementing each integration?
2. **Multi-operator collaboration.** Two consultants on one engagement
   on two Macs — shared engagement bundle sync (user-provisioned S3-compat
   endpoint on their self-hosted infra) vs hard one-Mac-per-engagement?
3. **Customer self-service scoping.** Can customers safely author their
   own `scope.yaml`, or do we require a redstack engagement engineer to
   derive it from the LOA narrative?
4. **Exploit-PoC review board.** Should every PoC require a second-agent
   or second-human review before execution? Default ON for crown-jewel
   assets is the conservative answer.
5. **Telemetry.** Opt-in only, never includes target identifiers,
   payloads, findings, or customer code. Mirror gstack's stance.
6. **License.** gstack is MIT. redstack v0.1 ships MIT too; the
   authorization-first architecture is the moat, not the source.

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
2. **M2 — Reference engagement.** End-to-end demo against a MacBook-local,
   reproducible lab: DVWA in Docker Compose + minio (S3-compat object
   store) + self-hosted Postgres + Keycloak + k3d (k3s-in-Docker) for
   the cloud-audit surface. No real cloud accounts needed. Runs
   `/office-hours → /recon → /web-app → /cloud-audit → /triage →
   /reporter` end-to-end on a MacBook in under 30 minutes.
3. **M3 — Authorization spine.** Real Ed25519 signing of scope files, audit
   log anchoring, kill-switch wired through.
4. **M4 — First design partner.** One MSSP, one enterprise internal RT.
   Co-develop the on-prem appliance and the report templates with them.
5. **M5 — SOC 2 readiness assessment + GA pricing.**
