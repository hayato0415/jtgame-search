#!/usr/bin/env python3
"""Build the three-layer concepts taxonomy for the static GitHub Pages site.

This first version is intentionally conservative:
- It does not scrape external websites.
- It validates and normalizes a manually maintained taxonomy JSON.
- Future crawlers can write the same schema after source verification.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
OUTPUT = DOCS_DATA / "concepts-taxonomy.json"
MANUAL_SOURCE = ROOT / "data" / "manual_concepts_taxonomy.json"

VALID_TYPES = {"official_industry", "supply_chain", "market_theme"}
VALID_CONFIDENCE = {"A", "B", "C", "D", "E"}
VALID_QUALITY = {"high", "medium", "low"}


def load_source() -> dict:
    source = MANUAL_SOURCE if MANUAL_SOURCE.exists() else OUTPUT
    if not source.exists():
        raise FileNotFoundError(
            "No taxonomy source found. Create data/manual_concepts_taxonomy.json "
            "or docs/data/concepts-taxonomy.json first."
        )
    with source.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_stock(stock: dict, category: dict) -> dict:
    required = ["code", "name", "market"]
    missing = [key for key in required if not str(stock.get(key, "")).strip()]
    if missing:
        raise ValueError(f"Stock in category {category.get('id')} missing fields: {missing}")
    confidence = stock.get("confidence") or category.get("source_confidence") or "C"
    if confidence not in VALID_CONFIDENCE:
        raise ValueError(f"Invalid stock confidence {confidence} for {stock.get('code')}")
    data_quality = stock.get("data_quality") or category.get("data_quality") or "low"
    if data_quality not in VALID_QUALITY:
        raise ValueError(f"Invalid stock data_quality {data_quality} for {stock.get('code')}")
    normalized = dict(stock)
    normalized["code"] = str(stock["code"]).strip()
    normalized["name"] = str(stock["name"]).strip()
    normalized["market"] = str(stock["market"]).strip()
    normalized["confidence"] = confidence
    normalized["source_count"] = int(stock.get("source_count") or 1)
    normalized["data_quality"] = data_quality
    normalized["evidence"] = stock.get("evidence") if isinstance(stock.get("evidence"), list) else []
    return normalized


def normalize_category(category: dict) -> dict:
    required = ["id", "type", "name", "description"]
    missing = [key for key in required if not str(category.get(key, "")).strip()]
    if missing:
        raise ValueError(f"Category missing fields: {missing}")
    if category["type"] not in VALID_TYPES:
        raise ValueError(f"Invalid category type: {category['type']}")
    confidence = category.get("source_confidence") or "C"
    if confidence not in VALID_CONFIDENCE:
        raise ValueError(f"Invalid category confidence {confidence}: {category.get('id')}")
    data_quality = category.get("data_quality") or "low"
    if data_quality not in VALID_QUALITY:
        raise ValueError(f"Invalid category data_quality {data_quality}: {category.get('id')}")
    normalized = dict(category)
    normalized["source_confidence"] = confidence
    normalized["source_count"] = int(category.get("source_count") or len(category.get("sources") or []) or 1)
    normalized["data_quality"] = data_quality
    normalized["sources"] = category.get("sources") if isinstance(category.get("sources"), list) else []
    normalized["stocks"] = [normalize_stock(stock, normalized) for stock in category.get("stocks", [])]
    return normalized


def build_taxonomy() -> dict:
    raw = load_source()
    categories = raw.get("categories")
    if not isinstance(categories, list) or not categories:
        raise ValueError("taxonomy categories must be a non-empty list")
    generated_at = raw.get("generated_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
    return {
        "generated_at": generated_at,
        "source_policy": raw.get("source_policy") or {},
        "categories": [normalize_category(category) for category in categories],
    }


def main() -> int:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    taxonomy = build_taxonomy()
    temp = OUTPUT.with_suffix(".json.tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(taxonomy, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    shutil.move(str(temp), str(OUTPUT))
    print(f"concepts taxonomy categories: {len(taxonomy['categories'])}")
    print(f"output: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
