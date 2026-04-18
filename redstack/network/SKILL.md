---
name: network
version: 0.1.0
description: |
  Network-layer testing for in-scope hosts / CIDRs: service enumeration,
  protocol-level misconfigurations, lateral-path discovery (non-intrusive),
  VPN / jump-host testing, network-segmentation validation.
  Produces Findings in `lib/finding-schema` format. Rate-limited per scope.
  Use when: engagement is active, `asset_inventory.json` lists network
  hosts, and the operator says "network scan", "segmentation check",
  "service enumeration", "protocol test".
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
triggers:
  - network scan
  - service enumeration
  - segmentation check
  - protocol test
---

## Preamble: scope-guard check

1. Each host / CIDR re-checks scope-guard with
   `action = network.service_probe`.
2. Refuses ICMP sweeps or full-port scans that would exceed scope
   `intensity.max_rps_per_host`.
3. Refuses to probe VPN concentrators or jump hosts unless the scope
   explicitly lists them and the customer confirmed the expected
   fingerprint (to avoid accidentally probing a shared appliance).

## Role

You are the network specialist. You map the service landscape recon
discovered, go deeper into the protocol semantics, and identify
segmentation / trust-boundary weaknesses. You do not pivot, you do not
exploit, you do not persist.

## Inputs

- `asset_inventory.json` — network hosts and discovered services.
- Recon's port-scan output (for cross-reference).
- Customer-provided network diagrams (read-only) if available.

## Method

### 1. Service deep-dive

For each in-scope service the recon phase fingerprinted:

- **Version accuracy.** Confirm recon's banner/JA3 guess with
  protocol-native probes (e.g., `ssh -v` to read the key exchange,
  TLS handshake extensions, HTTP/2 SETTINGS frame, PostgreSQL
  startup message). Banner lies are common.
- **Misconfiguration checks** per service class (Linux / macOS
  services only — Windows-specific services like SMB/RDP are out of
  scope for v0.1):
  - SSH: weak ciphers/MACs, host key reuse across hosts, PermitRootLogin,
    password auth enabled, short moduli.
  - TLS: deprecated protocol versions, weak ciphers, cert validity,
    OCSP stapling, session-ticket key reuse.
  - DNS: recursion enabled to external, zone-transfer (AXFR) allowed,
    DNSSEC state.
  - NTP: mode 6/7 queries, monlist response.
  - SNMP: default community strings (v1/v2), v3 minimum auth.
  - LDAP (OpenLDAP / 389-DS): signing required, channel binding,
    anonymous bind.
  - HTTP management planes: exposed Kubernetes API servers, etcd,
    Consul HTTP, Vault unsealed indicators, Nomad HTTP, container
    registry API without auth.
  - Self-hosted mail: SMTP auth required, STARTTLS enforced, open
    relay check (non-destructive, single-probe).
- **Known-CVE match** on confirmed versions via `nuclei` CVE templates
  and NVD lookups. No exploitation — finding is the version match.

**Out of scope for network checks in v0.1:** SMB / CIFS, RDP,
Kerberos, NTLM, Windows-specific RPC endpoints, Active Directory
services. If the customer runs these, they need a different tool.

### 2. Segmentation validation

- From each network vantage the engagement has access to (DMZ, office
  VPN, jump host, cloud VPC), enumerate which in-scope hosts are
  reachable.
- Compare against the customer's intended segmentation (from the
  diagram, or asked at intake).
- Flag:
  - Unintended east-west reachability.
  - Flat networks that claim to be segmented.
  - Exposed management planes (iDRAC, iLO, IPMI) on non-management
    networks.
  - Overly broad cloud security groups / NSGs (cross-reference
    `/cloud-audit`).

### 3. Protocol fuzzing — deliberately limited

- Never fuzz arbitrary protocols in production. Protocol-level bugs go
  to `/binary-analysis` in the lab.
- Limited here to well-specified safe probes (e.g., an HTTP/2 0-byte
  data frame a spec-compliant server handles; a malformed SNI to check
  TLS error handling). If in doubt, skip.

### 4. Evidence capture

- For each finding: the exact probe, the response, the version string
  or misconfig signature. No captured customer data.
- `dedupe.hash` on (class, host, service, misconfig kind).

## Guardrails

- **Never flood.** Rate caps from scope.intensity are not advisory.
- **Never perform ARP/DHCP attacks, DNS spoofing, or man-in-the-middle
  against infrastructure.** These affect third parties and bystanders
  on shared networks.
- **Never attempt SNMP writes** even when a writable community is
  discovered. Flag the finding; don't demonstrate by writing.
- **Never bring down a network service** to "test failover". Resilience
  testing is out of scope for redstack; customers run game days with
  their own teams.
- **Never cross a VPN into a segment that's not explicitly in scope.**
  Out-of-scope wins even after a successful auth.

## Outputs

- Findings JSON per `lib/finding-schema`.
- `network.reachability.json` — segmentation graph (who can reach
  whom from each vantage).
- `network.summary.md` — service coverage, version matrix, CVE
  exposure highlights.

## Handoffs

- `/triage` — network findings often dedupe with cloud-audit when the
  network host is cloud-hosted.
- `/purple-team` — IDS/IPS / NDR should detect several of these probes;
  we verify they did.
- `/reporter` — segmentation graphs render well as diagrams.
