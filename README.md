# Niall Search OS

Automated scout for Niall Sheehan's executive job search. A scheduled GitHub Actions job watches ten target companies' job feeds, dedupes against what was already seen, scores each new posting against Niall's profile with Claude, and emails a digest. A companion script turns a LinkedIn connections export into a per-target warm-path map for the tracker sheet.

## Live pages (public hosts)

- Playbook, the operating system: https://wajo.ai/d/3a88ba55-2754-4ef9-8f56-b0c9caf17352
- Tracker live view, the ten targets: https://wajo.ai/d/9af7305a-3771-4c92-ad3a-f00ba12bfcb5
- Job-finding approach (four channels + ten services, Jack & Jill first): https://wajo.ai/d/483aa154-45a4-45cc-bacb-24ddee90efd5
- Full exec package (bios, resume, outreach scripts, seeded targets): https://wajo.ai/d/7af21b47-7319-4638-bd0e-313b8f46946d
- Social media plan, ten targets + posting engine: https://wajo.ai/d/5be22e89-3217-487c-a130-266b00e879d3

## Editing copies (private)

- Playbook Google Doc: https://docs.google.com/document/d/1izEXJdcJ5Ntjh0v63-6qmtFK611tcwHdNRLtzUdWKO0/edit
- Tracker Google Sheet (Targets / Contacts / Outreach log / Weekly metrics): https://docs.google.com/spreadsheets/d/1-xyELH7--oP9-0BgbYtsufRCHehd-suGYNASM9BiCd0/edit

## What runs

- `scout/scout.py` - pulls postings from each target's configured source, filters titles to executive/AI/FinOps scope, dedupes, scores with Claude (`claude-sonnet-5-5`), and emails the digest via SMTP. Postings are marked seen only after the digest is emailed.
- `scout/config.yaml` - the ten targets and their sources:
  - Ashby boards: CloudZero, Vantage, Credo AI
  - BambooHR: Holistic AI
  - Workday: Flexera
  - Careers search: Microsoft, Amazon Web Services, IBM (Apptio)
  - Checked by hand (`custom_ats: true`, listed in the run log): Google Cloud, Monitaur

  Greenhouse and Lever readers also exist for targets that use those boards.
- `scout/parse_connections.py` - reads a LinkedIn `connections.csv` export and prints per-target connection counts plus a ready-to-paste CSV for the tracker's Contacts tab.

## Setup (one time)

Set these repo secrets (Settings > Secrets and variables > Actions):

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude scoring |
| `SMTP_HOST` / `SMTP_PORT` | mail relay (e.g. smtp.office365.com / 587) |
| `SMTP_USER` / `SMTP_PASS` | relay credentials |
| `DIGEST_FROM` | sender address |

The scout sends only to Bob at the `digest_to` address in `scout/config.yaml`. It ignores the `DIGEST_TO` secret. Without `SMTP_HOST`, it prints the digest to the run log instead of emailing it.

## Schedule

Weekdays 1:00 PM UTC (5:00 AM Pacific), plus a manual run button. Manual runs email the digest unless `dry_run=true` is set. Nothing sends on a weekend.

## Source tokens

Each target uses the first source set in `config.yaml` (`ashby`, `bamboohr`, `workday`, `microsoft`, `amazon`, `ibm`, `greenhouse` or `lever`; see the comments at the top of that file). With no source set, a Greenhouse board token is guessed from the company name. A 404 just means the guess is wrong for that company: confirm the real token once (visible in any of that company's job-posting URLs) and set it in the config. Unexpected source failures add a short warning to the digest; details and planned manual checks are listed separately in the Actions run log.
