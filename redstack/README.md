# redstack

**AI-driven red-teaming, built on the gstack SKILL.md persona model.**

redstack turns Claude Code (or any compatible agent host) into a virtual
offensive-security team operating under a signed Rules of Engagement. Each
specialist role — recon, web-app, cloud, source review, network, identity,
exploit-PoC, post-ex, purple-team, reporter — is a markdown skill that shares
a common authorization spine, audit log, and finding schema.

> **Status:** v0.1.0 — scaffold. Agent personas defined; CLI, engagement
> bus, and crypto are M3+. See `ARCHITECTURE.md` for the full roadmap.
>
> **Scope (v0.1):** MacBook-only operator (macOS arm64 / x86_64).
> Self-hosted Linux / macOS targets only. No hyperscaler support
> (AWS / GCP / Azure). No Windows / Active Directory / Microsoft 365.

## Authorized use only

redstack runs **only** against assets you are explicitly authorized to test
in writing. Every skill preamble calls `lib/scope-guard` and refuses to act
without a valid, in-scope, in-window authorization token derived from a
signed Letter of Authorization. If you don't have an LOA, stop here.

See [`AUTHORIZATION.md`](./AUTHORIZATION.md) for the scope model and
[`ETHOS.md`](./ETHOS.md) for the operating principles.

## Install (MacBook-only; CLI ships in M3)

```bash
# Homebrew (recommended once the tap is live):
brew install redstack/tap/redstack

# Or, for development:
git clone https://github.com/<org>/redstack ~/.claude/skills/redstack
cd ~/.claude/skills/redstack
./setup                    # macOS-only; checks xcode-select, codesign, Keychain
```

Requirements:

- macOS 12 (Monterey) or later, arm64 or x86_64.
- Claude Code installed (or another supported agent host).
- OrbStack or Docker Desktop for the local lab (only needed when you
  actually run an engagement with container-based scanners).

Until the CLI ships, the SKILL.md files can be read directly by Claude
Code when the repo is checked out — they are prompt templates, not
compiled code.

## Quick start (design target)

```bash
redstack engagement new --loa ./loa.pdf --scope ./scope.yaml
# Claude Code picks up the engagement and routes through the phases:
/office-hours          # intake, forcing questions
/engagement            # load + validate scope
/recon                 # attack-surface discovery
/web-app               # or /cloud-audit, /source-review, ...
/exploit-poc           # minimum-viable proof-of-concept
/triage                # dedupe + CVSS 4.0 + EPSS scoring
/purple-team           # detection validation
/reporter              # customer-ready deliverable
/retro                 # ATT&CK coverage map + learnings
```

## Agents (18 in v0.1)

| Phase              | Skills                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| Strategy & control | `/office-hours`, `/engagement`                                                    |
| Discovery          | `/recon`                                                                          |
| Surface specialist | `/web-app`, `/cloud-audit`, `/source-review`, `/binary-analysis`, `/network`, `/identity`, `/mobile` |
| Validation         | `/exploit-poc`, `/phishing-sim`, `/post-exploitation`                             |
| Defense validation | `/purple-team`, `/canary`                                                         |
| Communication      | `/triage`, `/reporter`, `/retro`                                                  |

Each lives at `<skill-name>/SKILL.md` and is a self-contained persona.

## Layout

```
redstack/
├── ARCHITECTURE.md       # product design doc
├── AUTHORIZATION.md      # scope / LOA / kill-switch model
├── ETHOS.md              # operating principles
├── CLAUDE.md             # skill manifest + development guidance
├── SKILL.md              # router / entry point
├── README.md             # this file
├── LICENSE               # MIT + authorized-use notice
├── VERSION
├── package.json
├── scope.example.yaml    # annotated scope-file template
├── lib/                  # shared docs every skill references
│   ├── scope-guard.md
│   ├── audit-log.md
│   └── finding-schema.md
└── <skill>/SKILL.md      # 18 agent personas
```

## Relationship to gstack

redstack forks the gstack persona pattern: markdown SKILL.md files with YAML
frontmatter, invoked via slash commands by Claude Code. We borrow gstack's
browser binary, host-adapter layout, and skill-routing conventions. redstack
is **not** a gstack plugin — it ships as its own install under
`~/.claude/skills/redstack/`.

gstack stays at `.claude/skills/gstack/` in this repo as the tool we use to
build redstack. redstack ships as the product.

## Contributing

1. Read `ETHOS.md` first. Authorization-first is not negotiable.
2. Every new skill must call `lib/scope-guard` in its preamble.
3. Every active action must produce an audit-log entry via `lib/audit-log`.
4. No skill may include ready-to-use exploit payloads inline. Payload
   construction belongs in `/exploit-poc` and is scope-gated.
5. PRs that soften authorization, scope-guard, or product-level refusals
   require maintainer + security-review sign-off.

## License

MIT, plus an authorized-use notice. See [`LICENSE`](./LICENSE).
