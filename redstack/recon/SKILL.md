---
name: recon
version: 0.1.0
description: |
  Attack-surface discovery for the in-scope assets. Passive OSINT first
  (certificate transparency, DNS, public code forges, breach data
  indices), then active
  enumeration (DNS resolution, port scan, TLS fingerprinting, web crawl)
  under scope-guard rate limits. Produces the Asset inventory that every
  surface specialist downstream consumes.
  Use when: engagement is active and no recon has run yet, or the operator
  says "what's exposed", "attack surface", "enumerate", "discover".
allowed-tools:
  - Read
  - Write
  - Bash
  - WebSearch
  - AskUserQuestion
triggers:
  - attack surface
  - enumerate
  - discover assets
  - recon
---

## Preamble: scope-guard check

1. Call `lib/scope-guard` with `action = recon.passive_osint` for the
   passive phase, then separately with `action = recon.dns_enumeration`,
   `recon.port_scan`, or `recon.active_crawl` for each active step.
2. Every target you intend to probe goes through the check. No pre-scan
   shortcut.
3. If the customer set `forbidden_techniques: ["recon.port_scan"]`, that
   step refuses; passive phase continues.

## Role

You are the scout. You map what the customer actually exposes, not what
they think they expose. Many findings die or survive here — an unknown
subdomain pointing at an abandoned self-hosted object bucket or a
forgotten staging Kubernetes ingress is often the finding.

You do not exploit. You observe, fingerprint, and inventory.

## Inputs

- `scope.yaml.signed` (read via engagement bus).
- Existing `asset_inventory.json` if a prior recon ran in this engagement
  (for incremental runs).

## Method

### Phase 1 — Passive OSINT (no packets to targets)

1. **Certificate transparency.** crt.sh / Censys for every in-scope domain
   and wildcard. Emit candidate hostnames.
2. **DNS history.** Passive DNS lookups (no resolution against the
   customer's nameservers yet).
3. **Public source code.** `/source-review` handles customer-owned
   repos; here we query public code-forge indexes (Sourcegraph public,
   grep.app, generic search engines) for leaked references to the
   customer's domains or internal identifiers. Respect robots/terms;
   one pass per index, no scraping.
4. **Breach data indices.** Check HIBP-style indices for credential
   exposure (email-level, not password). Results feed `/identity`.
5. **Public self-hosted endpoints.** Enumerate discoverable resource
   handles on in-scope self-hosted infrastructure (publicly readable
   object buckets on minio / Ceph / Garage / SeaweedFS, public Gitea /
   Forgejo / GitLab instances, public container registries, public
   Helm chart repos, public Kubernetes API servers) via unauthenticated
   probes.
6. **WHOIS / ASN / BGP.** Map autonomous systems and IP allocations.

Every passive finding goes into the asset inventory with
`source: passive`. No traffic has hit the customer yet.

### Phase 2 — Active enumeration (packets to targets, rate-limited)

1. **DNS resolution** of candidate hostnames against authoritative
   nameservers. Pull A / AAAA / CNAME / MX / TXT / NS / CAA.
2. **Port scan** of in-scope hosts (nmap wrapper with scope-guard rate
   caps). Start with top-1000 TCP + top-100 UDP; expand only if the
   customer mandated full sweep.
3. **Service fingerprinting** (nmap -sV + nuclei service templates).
4. **TLS fingerprinting** (JA3/JA4, cipher suites, cert chains,
   hostname/SAN mismatches).
5. **Web crawl** of discovered HTTP(S) endpoints: robots.txt,
   sitemap.xml, `.well-known/*`, directory-listing tells. Drive via the
   `browse/` binary; no form submission.

### Phase 3 — Inventory synthesis

Consolidate into `asset_inventory.json`:

```jsonc
{
  "generated_at": "2026-04-18T14:00:00Z",
  "engagement_id": "...",
  "assets": [
    {
      "id": "ast-01HAAA...",
      "type": "web_endpoint",
      "ref":  "https://api.example.com",
      "tier": "high",            // from scope or asked if missing
      "fingerprint": {
        "server": "nginx/1.25.3",
        "tls": "TLS1.3; JA4=...",
        "technologies": ["React 18", "Next.js 14"]
      },
      "source": "active",
      "notes": ["CSP missing", "Set-Cookie without HttpOnly"]
    },
    { "id": "ast-01HBBB...", "type": "object_bucket",  "ref": "s3://minio.acme.example/acme-public-assets", "tier": "std", ... },
    { "id": "ast-01HCCC...", "type": "network_host",   "ref": "203.0.113.5",                                "tier": "high", ... }
  ],
  "coverage_gaps": [
    "Customer did not provide a mobile bundle; /mobile skipped."
  ]
}
```

Emit `recon.inventory_published` to the audit log with the asset count.

## Guardrails

- **Never scan outside scope.** Every candidate hostname/IP re-checks
  scope-guard; if a passive OSINT find falls outside, it is recorded as
  "observed, not tested" and flagged to the operator — never probed.
- **Never bypass rate caps.** nmap, nuclei, and the crawl driver run
  inside the scope-gated wrapper.
- **Never authenticate to the customer's infrastructure here.**
  `/cloud-audit` is where authenticated discovery lives; recon is
  limited to unauthenticated observability.
- **Never bruteforce DNS**, VHOSTs, or directories beyond a conservative
  wordlist ceiling set in scope. Intensity caps apply.
- **Never ignore a robots.txt `Disallow`.** Record it, flag it, but do
  not probe; elevated scanning of disallowed paths is a technique that
  requires explicit customer opt-in in `required_techniques`.

## Outputs

- `asset_inventory.json` — the canonical inventory.
- `recon-<phase>.log.redacted` — per-phase tool output with secrets/headers
  redacted.
- Audit entries: `recon.phase_started`, `recon.asset_discovered`,
  `recon.inventory_published`.

## Handoffs

- Every surface specialist (`/web-app`, `/cloud-audit`, `/source-review`,
  `/binary-analysis`, `/network`, `/identity`, `/mobile`) reads
  `asset_inventory.json` as its primary input.
- `/triage` uses asset `tier` to weight findings.
- `/reporter` includes an attack-surface summary pulled from recon.
