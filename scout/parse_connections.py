#!/usr/bin/env python3
"""Turn a LinkedIn connections export into a per-target warm-path map.

Usage: python scout/parse_connections.py path/to/connections.csv

Prints one line per target company (1st-level connections working there now)
and writes connections_by_target.csv with the matched people, ready to paste
into the tracker sheet's Contacts tab.
"""
import csv
import re
import sys
from pathlib import Path

TARGETS = [
    "Microsoft", "Amazon", "AWS", "Google", "IBM", "Apptio",
    "Flexera", "CloudZero", "Vantage", "Credo", "Holistic", "Monitaur",
]


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    rows = list(csv.DictReader(Path(sys.argv[1]).open(encoding="utf-8-sig")))
    counts = {t: 0 for t in TARGETS}
    matched = []
    for row in rows:
        company = (row.get("Company") or "").strip()
        if not company:
            continue
        hits = [t for t in TARGETS if re.search(re.escape(t), company, re.IGNORECASE)]
        if not hits:
            continue
        for t in hits:
            counts[t] += 1
        matched.append(
            {
                "Name": f"{(row.get('First Name') or '').strip()} {(row.get('Last Name') or '').strip()}".strip(),
                "Company": company,
                "Title": (row.get("Position") or "").strip(),
                "URL": (row.get("URL") or "").strip(),
                "Connected On": (row.get("Connected On") or "").strip(),
                "Target match": ", ".join(hits),
            }
        )
    print("\nConnections at target companies (1st level):")
    for t in TARGETS:
        marker = " <- warm path" if counts[t] else ""
        print(f"  {t:<10} {counts[t]:>3}{marker}")
    out = Path("connections_by_target.csv")
    with out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["Name", "Company", "Title", "URL", "Connected On", "Target match"]
        )
        writer.writeheader()
        writer.writerows(matched)
    print(f"\nWrote {out} with {len(matched)} matched people (paste into Contacts tab).")


if __name__ == "__main__":
    main()
