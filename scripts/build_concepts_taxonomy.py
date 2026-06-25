#!/usr/bin/env python3
"""Build the concept taxonomy from source mapping files.

This script does not scrape external sites. It merges the manually maintained
source-category map, source raw rows, and aliases into the static taxonomy used
by GitHub Pages.
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
MAP_FILE = DOCS_DATA / "source-category-map.json"
RAW_FILE = DOCS_DATA / "source-category-raw.json"
ALIASES_FILE = DOCS_DATA / "concept-aliases.json"
OUTPUT = DOCS_DATA / "concepts-taxonomy.json"

SOURCE_NAME = {
    "moneydj": "MoneyDJ",
    "wantgoo": "WantGoo",
    "yahoo": "Yahoo",
    "pchome": "PChome",
    "cmoney": "CMoney",
    "manual": "人工整理",
}

VALID_STATUS_COMPLETE = {"complete"}
VALID_STATUS_PARTIAL = {"partial", "link_only", "needs_fill", "source_unavailable", "blocked", "manual_only"}


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def unique_list(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def confidence_for_source_count(count: int) -> str:
    if count >= 3:
        return "B"
    if count == 2:
        return "B"
    return "C"


def quality_for_source_count(count: int) -> str:
    if count >= 3:
        return "medium"
    if count == 2:
        return "medium"
    return "low"


def status_from_rows(rows: list[dict], stock_count: int, declared_max: int | None) -> str:
    statuses = {str(row.get("collection_status") or "").strip() for row in rows}
    if declared_max and stock_count >= declared_max:
        return "complete"
    if statuses & VALID_STATUS_COMPLETE and not statuses & VALID_STATUS_PARTIAL:
        return "complete"
    if stock_count > 0:
        return "partial"
    return "needs_fill"


def build_source_breakdown(map_item: dict, rows: list[dict]) -> dict:
    breakdown: dict[str, dict] = {}
    row_lookup = defaultdict(list)
    for row in rows:
        row_lookup[str(row.get("source") or "")].append(row)

    for mapping in map_item.get("source_mappings", []):
        source_id = str(mapping.get("source") or "").strip()
        source_name = SOURCE_NAME.get(source_id, source_id or "來源")
        matched_rows = row_lookup.get(source_id, [])
        if matched_rows:
            declared = max(
                [row.get("declared_stock_count") or 0 for row in matched_rows],
                default=0,
            ) or None
            collected = sum(int(row.get("collected_stock_count") or len(row.get("stocks") or [])) for row in matched_rows)
            status = "partial" if collected else str(matched_rows[0].get("collection_status") or "needs_fill")
            url = next((row.get("url") for row in matched_rows if row.get("url")), mapping.get("url") or "")
            source_category_name = " / ".join(unique_list([row.get("source_category_name") for row in matched_rows]))
        else:
            declared = None
            collected = 0
            status = mapping.get("status") or "needs_mapping"
            url = mapping.get("url") or ""
            source_category_name = mapping.get("source_name") or ""

        breakdown[source_name] = {
            "source_id": source_id,
            "source_category_name": source_category_name,
            "source_group": mapping.get("source_group") or "",
            "url": url,
            "declared_stock_count": declared,
            "collected_stock_count": collected,
            "collection_status": status,
        }
    return breakdown


def build_stocks(rows: list[dict]) -> list[dict]:
    stocks: dict[str, dict] = {}
    for row in rows:
        source_label = SOURCE_NAME.get(str(row.get("source") or ""), row.get("source_name") or row.get("source") or "來源")
        for stock in row.get("stocks") or []:
            code = str(stock.get("code") or "").strip()
            name = str(stock.get("name") or "").strip()
            if not code or not name:
                continue
            current = stocks.setdefault(
                code,
                {
                    "code": code,
                    "name": name,
                    "market": str(stock.get("market") or "").strip(),
                    "sources": [],
                    "source_count": 0,
                    "relation_type": "source_category",
                    "confidence": "C",
                    "data_quality": "low",
                    "evidence": [],
                },
            )
            if not current.get("market") and stock.get("market"):
                current["market"] = stock.get("market")
            current["sources"] = unique_list([*current.get("sources", []), source_label])
            current["evidence"] = unique_list([*current.get("evidence", []), f"{source_label} 收錄"])

    result = []
    for stock in stocks.values():
        count = len(stock.get("sources") or [])
        stock["source_count"] = count
        stock["confidence"] = confidence_for_source_count(count)
        stock["data_quality"] = quality_for_source_count(count)
        result.append(stock)
    return sorted(result, key=lambda item: (item.get("market") != "上市", item["code"]))


def build_taxonomy() -> dict:
    source_map = load_json(MAP_FILE)
    raw = load_json(RAW_FILE)
    aliases = load_json(ALIASES_FILE).get("items", {})

    raw_by_canonical: dict[str, list[dict]] = defaultdict(list)
    for row in raw.get("items", []):
        canonical_id = str(row.get("canonical_id") or "").strip()
        if canonical_id:
            raw_by_canonical[canonical_id].append(row)

    categories = []
    for item in source_map.get("items", []):
        canonical_id = str(item.get("canonical_id") or "").strip()
        if not canonical_id:
            continue
        rows = raw_by_canonical.get(canonical_id, [])
        all_stocks = build_stocks(rows)
        declared_counts = [
            int(row.get("declared_stock_count"))
            for row in rows
            if isinstance(row.get("declared_stock_count"), int) and row.get("declared_stock_count") > 0
        ]
        declared_max = max(declared_counts) if declared_counts else None
        stock_count = len(all_stocks)
        coverage_rate = round(stock_count / declared_max, 4) if declared_max else None
        source_breakdown = build_source_breakdown(item, rows)
        source_names = unique_list(
            [SOURCE_NAME.get(mapping.get("source"), mapping.get("source")) for mapping in item.get("source_mappings", [])]
        )
        coverage_status = status_from_rows(rows, stock_count, declared_max)
        source_count = len([entry for entry in source_breakdown.values() if entry.get("collection_status") in {"mapped", "partial", "complete", "needs_fill", "link_only", "related"}])
        categories.append(
            {
                "id": canonical_id,
                "name": item.get("canonical_name") or canonical_id,
                "display_group": item.get("display_group") or "themes",
                "type": item.get("type") or "分類",
                "aliases": unique_list([*(item.get("aliases") or []), *(aliases.get(canonical_id) or [])]),
                "stock_count": stock_count,
                "declared_max_source_count": declared_max,
                "source_count": source_count,
                "sources": source_names,
                "confidence": "B" if source_count >= 2 else "C",
                "data_quality": "partial" if stock_count else "low",
                "coverage_status": coverage_status,
                "coverage_rate": coverage_rate,
                "url": f"concept-detail.html?id={canonical_id}",
                "representative_stocks": all_stocks[:5],
                "all_stocks": all_stocks,
                "source_breakdown": source_breakdown,
            }
        )

    return {
        "generated_at": source_map.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source_policy": {
            "official_industry": "以證交所、櫃買、公開資訊觀測站、政府開放資料為優先。",
            "supply_chain": "以 MoneyDJ、CMoney、Yahoo、公司年報與法說會交叉驗證。",
            "market_theme": "以 MoneyDJ、CMoney、Yahoo、公開新聞與公司公告交叉驗證，單一來源不得視為高可信。"
        },
        "categories": categories,
    }


def main() -> int:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    taxonomy = build_taxonomy()
    if not taxonomy["categories"]:
        raise RuntimeError("No categories generated")
    temp = OUTPUT.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(taxonomy, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    shutil.move(str(temp), str(OUTPUT))
    print(f"concept categories: {len(taxonomy['categories'])}")
    print(f"output: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
