# Niall Search OS

Automated scout for Niall Sheehan's executive job search. A scheduled GitHub Actions job watches ten target companies' job feeds, dedupes against what was already seen, scores each new posting against Niall's profile with Claude, and emails a digest. A companion script turns a LinkedIn connections export into a per-target warm-path map for the tracker sheet.

## What runs

- `scout/scout.py` - pulls postings from each target's configured source (Greenhouse and Lever boards for v1), filters titles to executive/AI/FinOps scope, dedupes, scores with Claude (`claude-sonnet-4-5`), and emails the digest via SMTP.
- `scout/config.yaml` - the ten targets and their sources. Targets on custom ATS platforms (Microsoft, Amazon, Google, IBM) are marked and skipped in v1; add a Greenhouse or Lever token when one is known.
- `scout/parse_connections.py` - reads a LinkedIn `connections.csv` export and prints per-target connection counts plus a ready-to-paste CSV for the tracker's Contacts tab.

## Setup (one time)

Set these repo secrets (Settings > Secrets and variables > Actions):

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude scoring |
| `SMTP_HOST` / `SMTP_PORT` | mail relay (e.g. smtp.office365.com / 587) |
| `SMTP_USER` / `SMTP_PASS` | relay credentials |
| `DIGEST_FROM` / `DIGEST_TO` | from and to addresses (defaults to `dr.n.sheehan@gmail.com` from config) |

Nothing runs until the secrets exist. Until then every run fails fast and harmless.

## Schedule

Weekdays 1:00 PM UTC (5:00 AM Pacific), plus a manual run button. Manual runs default to `dry_run=true` (digest prints to the run log instead of emailing). Nothing sends on a weekend.

## Source tokens

Greenhouse board tokens and Lever tokens are guessed from each company name when not set in `config.yaml`. A 404 just means the guess is wrong for that company: confirm the real token once (visible in any of that company's job-posting URLs) and set it in the config. The script reports every source it could not read in the digest footer, never silently skips.

## Companion artifacts

- Playbook: private Google Doc, "Niall Search OS - private workspace"
- Tracker: private Google Sheet, "Niall Search OS tracker (private)" - Targets, Contacts, Outreach log, Weekly metrics
