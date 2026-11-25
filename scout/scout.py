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
MODEL = os.environ.get("REQ_MODEL", "claude-sonnet-5-5")
UA = {"User-Agent": "Mozilla/5.0 (compatible; niall-scout/1.0)"}
SEARCH_LIMIT = 25  # newest results kept per search query


def compile_filters(cfg):
    def rx(words):
        if not words:
            return re.compile(r"(?!)")
        parts = [re.escape(w) for w in words]
        return re.compile(r"\b(?:" + "|".join(parts) + r")\b", re.IGNORECASE)

    groups = cfg.get("title_must_match_groups")
    if groups is None:
        groups = [cfg["title_must_match_any"]]
    return [rx(group) for group in groups], rx(cfg["title_none_any"])


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
            headers=UA,  # Workday answers the default python-requests agent with 429
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


def _queries(token):
    """Search sources take one query or a list of them."""
    return [token] if isinstance(token, str) else list(token)


def fetch_amazon(token):
    jobs = {}
    for query in _queries(token):
        resp = requests.get(
            "https://www.amazon.jobs/en/search.json",
            params={"base_query": query, "result_limit": SEARCH_LIMIT, "sort": "recent"},
            headers=UA,
            timeout=30,
        )
        resp.raise_for_status()
        for item in resp.json().get("jobs", []):
            key = f"az:{item.get('id_icims')}"
            jobs[key] = {
                "id": key,
                "title": item.get("title") or "",
                "location": item.get("normalized_location") or "",
                "url": "https://www.amazon.jobs" + (item.get("job_path") or ""),
                "company": "amazon",
                "source": "amazon",
            }
    return list(jobs.values())


def fetch_microsoft(token):
    # One request only: this endpoint answers a second quick request with 429.
    query = " ".join(_queries(token))
    resp = requests.get(
        "https://apply.careers.microsoft.com/api/pcsx/search",
        params={"domain": "microsoft.com", "query": query, "start": 0, "num": SEARCH_LIMIT},
        headers=UA,
        timeout=30,
    )
    resp.raise_for_status()
    jobs = []
    for item in (resp.json().get("data") or {}).get("positions", []):
        jobs.append(
            {
                "id": f"ms:{item.get('id')}",
                "title": item.get("name") or "",
                "location": "; ".join(item.get("standardizedLocations") or item.get("locations") or []),
                "url": "https://apply.careers.microsoft.com" + (item.get("positionUrl") or ""),
                "company": "microsoft",
                "source": "microsoft",
            }
        )
    return jobs


def fetch_ibm(token):
    jobs = {}
    for query in _queries(token):
        resp = requests.post(
            "https://www-api.ibm.com/search/api/v2",
            json={
                "appId": "careers",
                "scopes": ["careers2"],
                "query": {"bool": {"must": [{"simple_query_string": {
                    "query": query, "fields": ["title^3", "description"]}}]}},
                "size": SEARCH_LIMIT,
                "from": 0,
                "_source": ["title", "url", "field_keyword_19"],
            },
            headers=UA,
            timeout=30,
        )
        resp.raise_for_status()
        for hit in (resp.json().get("hits") or {}).get("hits", []):
            src = hit.get("_source") or {}
            key = f"ibm:{hit.get('_id')}"
            jobs[key] = {
                "id": key,
                "title": src.get("title") or "",
                "location": src.get("field_keyword_19") or "",
                "url": src.get("url") or "",
                "company": "ibm",
                "source": "ibm",
            }
    return list(jobs.values())


FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "bamboohr": fetch_bamboohr,
    "workday": fetch_workday,
    "amazon": fetch_amazon,
    "microsoft": fetch_microsoft,
    "ibm": fetch_ibm,
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
                found = FETCHERS[kind](token)
                for job in found:
                    job["company_name"] = name
                jobs.extend(found)
                got = True
                break
            except Exception as exc:  # noqa: BLE001 - report, keep going
                last = f"{name} ({kind}:{token}): {type(exc).__name__}: {exc}"
        if not got:
            failures.append(last if candidates else f"{name}: no source configured")
    return jobs, failures


def filter_titles(jobs, cfg):
    default = compile_filters(cfg)
    by_target = {}
    for target in cfg.get("targets", []):
        if overrides := target.get("title_filters"):
            by_target[target["name"]] = compile_filters({
                **cfg,
                **overrides,
                "title_none_any": cfg["title_none_any"] + overrides.get("title_none_any", []),
            })
    kept = []
    for job in jobs:
        must, none = by_target.get(job.get("company_name"), default)
        t = job["title"]
        if not none.search(t) and all(group.search(t) for group in must):
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
    # Best fit first; unscored postings last, in the order they were found.
    out.sort(key=lambda r: -r["fit"] if isinstance(r["fit"], (int, float)) else 1)
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
