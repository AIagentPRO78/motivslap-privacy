# lib/finding-schema

Canonical finding document. Produced by every surface specialist, consumed
by `/triage`, `/exploit-poc`, `/purple-team`, and `/reporter`.

## Storage

- `~/.redstack/engagements/<eng-id>/findings/<finding-id>.json` on the
  operator's Mac. Indexed in the engagement SQLite database. No remote
  storage in v0.1.

## Schema (v0.1)

```jsonc
{
  "id":            "fnd-01HXYZ...",            // ULID
  "engagement_id": "ENG-2026-Q2-EXAMPLE-001",
  "created_at":    "2026-04-18T13:42:05Z",
  "created_by":    "web-app",                   // producing skill
  "title":         "Reflected XSS in /search via q parameter",

  "asset": {
    "type":  "web_endpoint",                    // web_endpoint | cloud_resource |
                                                // repo_file | binary | network_host |
                                                // identity_object | mobile_bundle
    "ref":   "https://api.example.com/search",
    "asset_id": "ast-01HAAA..."                 // recon inventory id if available
  },

  "vulnerability": {
    "cwe":   "CWE-79",
    "class": "xss.reflected",                   // redstack internal taxonomy
    "title": "Reflected XSS",
    "description": "The `q` query parameter is reflected into the response HTML
                    without contextual encoding, allowing script injection in
                    the victim's browser."
  },

  "severity": {
    "cvss_v4_vector": "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:L/VA:N/SC:L/SI:L/SA:N",
    "cvss_v4_score":  7.3,
    "epss_score":     0.04,
    "redstack_priority": "high"                 // derived: cvss × epss × asset_tier
  },

  "evidence": {
    "artifact_refs": [
      "artifacts/req-<hash>.http.redacted",
      "artifacts/resp-<hash>.html.redacted"
    ],
    "repro_steps": [
      "GET https://api.example.com/search?q=<REDSTACK_NONCE>",
      "Observe nonce reflected unescaped in response body line 142"
    ],
    "poc_ref": "fnd-01HXYZ.../poc.md",          // populated by /exploit-poc
    "redaction_applied": true
  },

  "dedupe": {
    "hash":   "sha256:c0ffee...",               // (class, asset.ref, parameterized-payload)
    "duplicate_of": null                        // set by /triage if dedupe hits
  },

  "remediation": {
    "summary": "Contextually encode user-controlled input before reflecting
                into HTML. Deploy a strict Content-Security-Policy.",
    "references": [
      "https://owasp.org/www-community/attacks/xss/",
      "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html"
    ],
    "effort_hours_estimate": 4
  },

  "detection": {
    "expected_signals": [
      "waf_rule:xss_reflected",
      "siem_detection:suspicious_query_param"
    ],
    "observed_signals": [],                     // populated by /purple-team
    "detection_gap": null                       // true | false | null (not yet tested)
  },

  "status": "open",                             // open | triaged | validated |
                                                // reported | remediated | wont-fix

  "history": [                                  // append-only
    { "ts": "2026-04-18T13:42:05Z", "actor": "web-app",    "event": "created" },
    { "ts": "2026-04-18T14:05:11Z", "actor": "triage",     "event": "prioritized", "to": "high" },
    { "ts": "2026-04-18T15:22:48Z", "actor": "exploit-poc","event": "evidence_added" }
  ]
}
```

## Dedupe hash

```
sha256(
  vulnerability.class
  + "|" + asset.type + ":" + normalized(asset.ref)
  + "|" + parameterized(evidence.repro_steps)     // query params, body fields
                                                  // with values replaced by <VAR>
)
```

This makes "same class, same endpoint, different payload" collapse into
one finding. `/triage` is the only skill that should set `duplicate_of`.

## Priority derivation (M3 tunes weights)

```
base       = cvss_v4_score
exploitability_boost = 1 + epss_score              # 1.00 to 1.97
asset_tier = {crown-jewel: 1.3, high: 1.1, std: 1.0, lab: 0.7}[asset.tier]

priority_numeric = base * exploitability_boost * asset_tier

redstack_priority =
  "critical" if priority_numeric >= 14 else
  "high"     if priority_numeric >=  8 else
  "medium"   if priority_numeric >=  4 else
  "low"
```

The asset tier comes from the `/recon` inventory (which asks the customer
to tag assets at intake) and defaults to `std`.

## Producer contract

A surface specialist, when it believes it has found something:

1. Fill all `id`, `engagement_id`, `asset`, `vulnerability`, `evidence`
   fields. `severity.cvss_v4_vector` is required; the score is computed
   from the vector.
2. Populate `dedupe.hash`.
3. Set `status = "open"`.
4. Write the JSON file atomically (temp file + rename).
5. Emit an audit entry `<skill>.finding_created` with the finding id and
   the dedupe hash.

Specialists should NOT:
- Set `duplicate_of` (triage's job).
- Set `redstack_priority` (derived, not asserted).
- Set `detection.observed_signals` (purple-team's job).

## Consumer contract

- **`/triage`** — sets `duplicate_of`, confirms/recomputes `redstack_priority`,
  transitions `status` to `triaged`.
- **`/exploit-poc`** — populates `evidence.poc_ref` and `history`.
- **`/purple-team`** — populates `detection.observed_signals` and
  `detection.detection_gap`.
- **`/reporter`** — read-only; renders into the customer deliverable.

Mutations outside these contracts must be rejected at the bus layer (M3).
