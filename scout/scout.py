#!/usr/bin/env python3
"""Niall Search OS scout.

Pulls new postings from each target company's configured job-board source,
filters titles to executive/AI/FinOps scope, dedupes against prior runs,
scores the new ones against the candidate profile with Claude, and emails
a digest. Sources that fail are reported in the digest footer, never skipped
silently.
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

import requests
import yaml

try:
    from anthropic import Anthropic
except ImportError:  # scoring is optional; the digest still goes out
    Anthropic = None

ROOT = Path(__file__).parent
STATE_PATH = ROOT / "state.json"
MODEL = os.environ.get("REQ_MODEL", "claude-sonnet-4-5")


def compile_filters(cfg):
    def rx(words):
        parts = [re.escape(w) for w in words]
        return re.compile(r"\b(?:" + "|".join(parts) + r")\b", re.IGNORECASE)

    return rx(cfg["title_must_match_any"]), rx(cfg["title_none_any"])


def fetch_greenhouse(token: str):
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    jobs = []
    for item in resp.json().get("jobs", []):
        jobs.append(
            {
                "id": f"gh:{token}:{item.get('id')}",
                "title": item.get("title") or "",
                "location": (item.get("location") or {}).get("name") or "",
                "url": item.get("absolute_url") or "",
                "company": token,
                "source": "greenhouse",
            }
        )
    return jobs


def fetch_lever(token: str):
    url = f"https://api.lever.co/v0/postings/{token}?mode=json"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    jobs = []
    for item in resp.json():
        if not item.get("draft"):
            jobs.append(
                {
                    "id": f"lv:{token}:{item.get('id')}",
                    "title": item.get("text") or "",
                    "location": (item.get("categories") or {}).get("location") or "",
                    "url": item.get("hostedUrl") or item.get("applyUrl") or "",
                    "company": token,
                    "source": "lever",
                }
            )
    return jobs


def fetch_ashby(token: str):
    # Board names are case-sensitive: "Vantage" works, "vantage" is a 404.
    url = f"https://api.ashbyhq.com/posting-api/job-board/{token}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    jobs = []
    for item in resp.json().get("jobs", []):
        if item.get("isListed") is False:
            continue
        jobs.append(
            {
                "id": f"ab:{token}:{item.get('id')}",
                "title": item.get("title") or "",
                "location": item.get("location") or "",
                "url": item.get("jobUrl") or item.get("applyUrl") or "",
                "company": token,
                "source": "ashby",
            }
        )
    return jobs


def fetch_bamboohr(token: str):
    base = f"https://{token}.bamboohr.com/careers"
    resp = requests.get(f"{base}/list", headers={"Accept": "application/json"}, timeout=30)
    resp.raise_for_status()
    jobs = []
    for item in resp.json().get("result", []):
        loc = item.get("location") or {}
        jobs.append(
            {
                "id": f"bh:{token}:{item.get('id')}",
                "title": item.get("jobOpeningName") or "",
                "location": ", ".join(x for x in (loc.get("city"), loc.get("state")) if x),
                "url": f"{base}/{item.get('id')}",
                "company": token,
                "source": "bamboohr",
            }
        )
    return jobs


def fetch_workday(token: str):
    """token is "<host>/<tenant>/<site>", e.g.
    "flexerasoftware.wd1.myworkdayjobs.com/flexerasoftware/FlexeraSoftware"."""
    host, tenant, site = token.split("/")
    url = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    jobs, offset, page = [], 0, 20
    while offset < 500:  # a ceiling, so a misbehaving board cannot loop forever
        resp = requests.post(
            url,
            json={"appliedFacets": {}, "limit": page, "offset": offset, "searchText": ""},
            # Workday answers the default python-requests agent with 429.
            headers={"User-Agent": "Mozilla/5.0 (compatible; niall-scout/1.0)"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        postings = data.get("jobPostings", [])
        for item in postings:
            path = item.get("externalPath") or ""
            jobs.append(
                {
                    "id": f"wd:{tenant}:{path}",
                    "title": item.get("title") or "",
                    "location": item.get("locationsText") or "",
                    "url": f"https://{host}/en-US/{site}{path}",
                    "company": token,
                    "source": "workday",
                }
            )
        offset += page
        if len(postings) < page or offset >= (data.get("total") or 0):
            break
    return jobs


FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "bamboohr": fetch_bamboohr,
    "workday": fetch_workday,
}


def collect(cfg):
    jobs, failures = [], []
    for target in cfg["targets"]:
        name = target["name"]
        if target.get("custom_ats"):
            failures.append(f"{name}: {target.get('note') or 'custom ATS, skipped in v1 (add a source token when known)'}")
            continue
        candidates = [(kind, target[kind]) for kind in FETCHERS if target.get(kind)][:1]
        if not candidates:
            guesses = [re.sub(r"[^a-z0-9]", "", name.lower())] + [
                re.sub(r"[^a-z0-9]", "", a.lower()) for a in target.get("alt_names", [])
            ]
            candidates = [("greenhouse", g) for g in guesses]
        got = False
        for kind, token in candidates:
            try:
                jobs.extend(FETCHERS[kind](token))
                got = True
                break
            except Exception as exc:  # noqa: BLE001 - report, keep going
                last = f"{name} ({kind}:{token}): {type(exc).__name__}: {exc}"
        if not got:
            failures.append(last if candidates else f"{name}: no source configured")
        else:
            for job in jobs:
                if job["company"] == token:
                    job["company_name"] = name
    return jobs, failures


def filter_titles(jobs, cfg):
    must, none = compile_filters(cfg)
    kept = []
    for job in jobs:
        t = job["title"]
        if none.search(t):
            continue
        if must.search(t):
            kept.append(job)
    return kept


def load_state():
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {"seen": []}


def save_state(seen):
    STATE_PATH.write_text(json.dumps({"seen": seen[-2000:]}))


def score(jobs, cfg):
    profile = (ROOT / cfg["candidate_profile"]).read_text()
    if not jobs:
        return []
    if Anthropic is None or not os.environ.get("ANTHROPIC_API_KEY"):
        return [{"job": j, "fit": None, "why": "LLM unavailable this run"} for j in jobs]
    lines = "\n".join(
        f"{i + 1}. {j['title']} | {j['location']} | {j['company_name']} | {j['url']}"
        for i, j in enumerate(jobs)
    )
    prompt = (
        "You are screening new executive job postings for Niall Sheehan.\n\nPROFILE:\n"
        + profile
        + "\n\nNEW POSTINGS:\n"
        + lines
        + '\n\nReturn a JSON array, one object per posting: {"n": <line number>, '
          '"fit": <1-10>, "why": "<one short sentence>"}. JSON only, no prose.\n'
    )
    client = Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=int(cfg.get("max_tokens_per_digest", 4000)),
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")
    match = re.search(r"\[.*\]", text, re.DOTALL)
    scores = {}
    if match:
        try:
            scores = {item["n"]: item for item in json.loads(match.group(0))}
        except Exception:
            pass
    out = []
    for i, job in enumerate(jobs):
        item = scores.get(i + 1, {})
        out.append({"job": job, "fit": item.get("fit"), "why": item.get("why", "")})
    return out


def build_digest(scored, failures):
    today = "Today"
    lines = [f"Niall Search OS digest - {today}", ""]
    if not scored:
        lines.append("No new postings matching the filter today.")
    for item in scored:
        job = item["job"]
        fit = item["fit"] if item["fit"] is not None else "?"
        lines.append(f"[{fit}/10] {job['title']} - {job['company_name']}")
        if job["location"]:
            lines.append(f"    {job['location']}")
        if item["why"]:
            lines.append(f"    Why: {item['why']}")
        lines.append(f"    {job['url']}")
        lines.append("")
    if failures:
        lines.append("Sources not read this run:")
        lines.extend(f"  - {f}" for f in failures)
    return "\n".join(lines)


def send_digest(subject, text):
    host = os.environ.get("SMTP_HOST")
    if not host:
        print("SMTP_HOST not set; digest printed to log instead.")
        print(text)
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("DIGEST_FROM")
    msg["To"] = os.environ.get("DIGEST_TO")
    msg.set_content(text)
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587"))) as smtp:
        smtp.starttls()
        smtp.login(os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASS"))
        smtp.send_message(msg)
    return True


def main():
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text())
    jobs, failures = collect(cfg)
    jobs = filter_titles(jobs, cfg)
    state = load_state()
    seen = set(state["seen"])
    fresh = [j for j in jobs if j["id"] not in seen]
    scored = score(fresh, cfg)
    digest = build_digest(scored, failures)
    dry = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    if dry:
        print("DRY RUN - no email sent.")
        print(digest)
    else:
        sent = send_digest(
            f"Niall Search OS: {len(scored)} new posting(s), {today_date()}", digest
        )
        print(f"digest sent: {sent}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        Path(summary).write_text(digest + "\n")
    if not dry:  # a dry run must not mark postings as seen, or the real digest misses them
        seen.update(j["id"] for j in fresh)
        save_state(sorted(seen))
    print(f"jobs scanned: {len(jobs)}, new: {len(fresh)}, failures: {len(failures)}")


def today_date():
    from datetime import date

    return date.today().isoformat()


if __name__ == "__main__":
    main()
