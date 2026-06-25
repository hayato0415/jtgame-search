#!/usr/bin/env python3
"""Build or validate the source catalog fallback files.

The first version is intentionally conservative: it does not scrape external
websites. It validates source-sites.json and source-category-raw.json, and
keeps unstable sources in link_only / needs_fill mode so the static frontend
does not break.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
SOURCE_SITES = DOCS_DATA / "source-sites.json"
RAW_FILE = DOCS_DATA / "source-category-raw.json"


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_sites(data: dict) -> list[str]:
    warnings: list[str] = []
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("source-sites.json must include sources")
    required = {"moneydj", "wantgoo", "yahoo", "pchome", "cmoney"}
    found = {str(source.get("id")) for source in sources}
    missing = sorted(required - found)
    if missing:
        warnings.append(f"missing sources: {', '.join(missing)}")
    for source in sources:
        if not source.get("url"):
            warnings.append(f"{source.get('id')} missing url")
        if source.get("auto_collect") is False and source.get("fallback_mode") != "link_only":
            warnings.append(f"{source.get('id')} should use link_only fallback")
    return warnings


def normalize_raw(data: dict, generated_at: str) -> dict:
    rows = data.get("items")
    if not isinstance(rows, list):
        raise ValueError("source-category-raw.json must include items")
    normalized = []
    for row in rows:
        next_row = dict(row)
        next_row["collection_status"] = next_row.get("collection_status") or "needs_fill"
        next_row["stocks"] = next_row.get("stocks") if isinstance(next_row.get("stocks"), list) else []
        next_row["collected_stock_count"] = int(next_row.get("collected_stock_count") or len(next_row["stocks"]))
        normalized.append(next_row)
    return {
        "generated_at": data.get("generated_at") or generated_at,
        "items": normalized,
    }


def main() -> int:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    sites = load_json(SOURCE_SITES)
    warnings = validate_sites(sites)
    raw = normalize_raw(load_json(RAW_FILE), sites.get("generated_at") or generated_at)

    temp = RAW_FILE.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(raw, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    shutil.move(str(temp), str(RAW_FILE))

    print(f"sources: {len(sites.get('sources', []))}")
    print(f"raw rows: {len(raw.get('items', []))}")
    if warnings:
        print("warnings:")
        for warning in warnings:
            print(f"- {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
