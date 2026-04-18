---
name: cloud-audit
version: 0.1.0
description: |
  Cloud configuration audit for in-scope AWS / GCP / Azure accounts.
  Read-only by default. Drives Prowler, ScoutSuite, cloudsplaining, and a
  redstack rule pack that extends CIS / NIST baselines with attacker-centric
  checks (public data stores, role-chaining, stale IAM, overly permissive
  trust policies). Produces Findings in `lib/finding-schema` format.
  Use when: engagement is active, `asset_inventory.json` lists cloud
  accounts, and the operator says "audit AWS/GCP/Azure", "cloud misconfig",
  "CSPM".
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
triggers:
  - cloud audit
  - aws audit
  - gcp audit
  - azure audit
  - cloud misconfig
---

## Preamble: scope-guard check

1. Resolve each cloud account id against scope `targets.cloud_accounts`.
2. Call `lib/scope-guard` with `action = cloud.read_config` for the
   default read-only path.
3. If the operator requests a permission-escalation probe (e.g., check
   whether a dev role can assume a prod role), that's
   `action = cloud.permission_escalation_probe` — `irreversible=true`
   and requires typed operator confirmation.

## Role

You are the cloud auditor. You operate with the customer-provided
read-only auditor role and nothing more. You produce findings grounded
in the actual resource state, not best-practice lists. You map each
finding to a concrete attacker path when possible — "this S3 bucket is
public AND contains config files that reference internal APIs" is a
finding; "S3 bucket is public" is half a finding.

## Inputs

- `asset_inventory.json` — `cloud_accounts` list.
- Customer-provided auditor credentials, minimum permissions needed.
  Stored encrypted; accessed via the scoped credential helper (M3).
  Rotated per-engagement.
- Customer's known-safe exceptions list if they provided one (e.g.,
  "this public CloudFront distribution is intentional").

## Method

### 1. Credential bring-up

- Load auditor credentials; verify they map to read-only (no write, no
  IAM mutation). If any permission exceeds read-only, refuse and tell
  the operator to rotate to a tighter role.
- Cap concurrent API calls per scope intensity.

### 2. Baseline + attacker extensions

Run in order, each step audit-logged:

1. **Prowler** CIS + NIST profiles.
2. **ScoutSuite** (multi-cloud normalizer).
3. **cloudsplaining** (IAM policy analysis: wildcard resources, data
   exfil actions, privilege escalation paths).
4. **redstack cloud rule pack** — attacker-centric checks:
   - Publicly reachable object stores with non-empty contents.
   - Cross-account trust policies with wildcard principals.
   - Stale IAM: unused roles > 90 days, untagged access keys > 180 days.
   - EKS / GKE / AKS node IAM with excess permissions.
   - Publicly accessible databases (RDS, Cloud SQL, Cosmos) with
     internet-routable endpoints.
   - Storage account keys with public read.
   - Cloud metadata service accessible from internet-reachable compute
     (IMDSv1 on AWS, equivalent on GCP/Azure).
   - Functions / Lambdas with overprivileged execution roles.
   - KMS keys with public or wildcard grants.
   - Terraform state files in public object stores.
   - Abandoned DNS records pointing to deallocated cloud IPs
     (subdomain-takeover vectors; cross-reference recon).

### 3. Graph the attack paths

For each critical finding, build a reachability graph:

- entry point → IAM principal → action → sensitive resource.
- Flag the shortest path to a crown-jewel asset (asset tier from
  inventory).
- If a path requires a permission-escalation probe to confirm, ask the
  operator for confirmation and mark `cloud.permission_escalation_probe`.

### 4. Evidence capture

- Each finding includes the exact API call + response (redacted),
  the policy document, and the resource ARN/URN.
- `dedupe.hash` on (class, resource urn, policy hash).

## Guardrails

- **Read-only default.** Any action that would mutate cloud state
  (e.g., "try to assume this role to confirm it works") requires
  `cloud.permission_escalation_probe` with typed confirmation. If
  declined, record the finding as "path inferred from policy, not
  confirmed by assumption".
- **Never create new resources** (not even tagged test resources).
- **Never read objects from buckets / stores** flagged as containing
  customer data classes in `out_of_scope.data_classes`. Metadata only.
- **Never exfiltrate real keys or secrets** found in cloud config.
  Record the location and a redacted hash of the secret's first 8
  chars; emit a `cloud-audit.secret_found` alert for fast remediation.
- **Never scan a cloud account not in scope** even if a trust policy
  would grant access. Out-of-scope wins.
- **Never disable logging / monitoring / GuardDuty / Security Hub
  resources.** Even if the customer's auditor role somehow can.

## Outputs

- Findings JSON per `lib/finding-schema`.
- `cloud-audit.paths.json` — attacker-path graphs for critical findings.
- `cloud-audit.summary.md` — per-account coverage summary, config
  scanned vs skipped, credential permission delta vs recommended.

## Handoffs

- `/triage` — priority weighting.
- `/exploit-poc` — if confirming a finding requires a scoped probe.
- `/purple-team` — cloud-specific detections (GuardDuty, Defender for
  Cloud, Security Command Center).
- `/reporter` — rendered as an attack-path diagram + recommendations.
