from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"

DEMAND_KEYWORDS = [
    "AI需求", "拉貨", "訂單", "出貨", "補庫存", "客戶需求", "伺服器需求",
    "車用需求", "資料中心", "雲端需求", "電力需求", "低軌衛星需求", "需求",
]
SUPPLY_KEYWORDS = [
    "缺貨", "供給吃緊", "產能滿載", "交期拉長", "減產", "庫存下降",
    "供應鏈轉單", "產能不足", "漲價", "報價上漲", "ASP", "供給",
]
COST_KEYWORDS = ["原料下跌", "報價上漲", "利差擴大", "毛利率改善", "稼動率提升", "利差"]


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def norm_code(value) -> str:
    return str(value or "").strip().upper().replace(".TW", "").replace(".TWO", "")


def number(value, default=0.0) -> float:
    if value is None:
        return default
    text = str(value).replace(",", "").replace("%", "").replace("+", "").replace("張", "").strip()
    try:
        parsed = float(text)
        return parsed if math.isfinite(parsed) else default
    except ValueError:
        return default


def clamp(value: float, low=0.0, high=100.0) -> float:
    return max(low, min(high, value))


def stock_name(code: str, stocks_by_code: dict, master: dict) -> str:
    stock = stocks_by_code.get(code)
    if stock and stock.get("name"):
        return str(stock["name"])
    record = master.get(code)
    if isinstance(record, dict):
        return str(record.get("name") or "")
    if isinstance(record, str):
        return record
    return ""


def stock_market(code: str, stocks_by_code: dict, master: dict) -> str:
    stock = stocks_by_code.get(code)
    if stock and stock.get("market"):
        return str(stock["market"])
    record = master.get(code)
    if isinstance(record, dict):
        return str(record.get("market") or "")
    return ""


def stock_label(code: str, stocks_by_code: dict, master: dict) -> dict:
    return {"code": code, "name": stock_name(code, stocks_by_code, master) or "名稱待補"}


def event_text(event: dict) -> str:
    pieces = [
        event.get("title", ""),
        event.get("summary", ""),
        event.get("asurada_analysis", ""),
        event.get("category", ""),
        " ".join(event.get("related_keywords") or []),
        " ".join(event.get("related_stocks") or []),
    ]
    return " ".join(str(item) for item in pieces)


def event_url(event: dict) -> str:
    return str(event.get("source_url") or event.get("url") or "").strip()


def real_url(url: str) -> bool:
    lowered = url.lower()
    return bool(url) and "example.com" not in lowered and lowered not in {"#", "demo", "test"}


def keyword_hits(text: str, keywords: list[str]) -> list[str]:
    upper = text.upper()
    return [word for word in keywords if str(word).upper() in upper]


def score_news(news_count: int, source_count: int) -> float:
    return clamp(news_count * 12 + source_count * 7)


def score_spread(stock_count: int) -> float:
    if stock_count <= 1:
        return 25
    if stock_count == 2:
        return 45
    return clamp(55 + (stock_count - 3) * 10)


def score_supply(demand_hits: int, supply_hits: int, cost_hits: int) -> float:
    score = demand_hits * 12 + supply_hits * 12 + cost_hits * 8
    if demand_hits and supply_hits:
        score += 25
    return clamp(score)


def stock_metric(code: str, stocks_by_code: dict, key: str) -> float:
    stock = stocks_by_code.get(code) or {}
    return number(stock.get(key))


def build_news_theme_ranking(generated_at: str, themes: dict, news: list[dict], stocks_by_code: dict, master: dict):
    items = []
    for theme, config in themes.items():
        keywords = config.get("keywords") or []
        seed_stocks = [norm_code(code) for code in (config.get("stocks") or []) if norm_code(code)]
        matched = []
        related_codes = set(seed_stocks)
        demand = set()
        supply = set()
        costs = set()

        for event in news:
            text = event_text(event)
            event_codes = {norm_code(code) for code in (event.get("related_stocks") or []) if norm_code(code)}
            if keyword_hits(text, keywords) or event_codes.intersection(seed_stocks):
                matched.append(event)
                related_codes.update(event_codes)
                demand.update(keyword_hits(text, DEMAND_KEYWORDS))
                supply.update(keyword_hits(text, SUPPLY_KEYWORDS))
                costs.update(keyword_hits(text, COST_KEYWORDS))

        if not matched and not seed_stocks:
            continue

        sources = {str(event.get("source_name") or "未標示") for event in matched}
        mentioned_count = len(related_codes)
        news_heat = score_news(len(matched), len(sources))
        spread = score_spread(mentioned_count)
        supply_score = score_supply(len(demand), len(supply), len(costs))
        price_score = clamp(50 + sum(stock_metric(code, stocks_by_code, "revenue_mom_value") for code in related_codes) / max(1, len(related_codes)) / 4)
        volume_score = clamp(sum(stock_metric(code, stocks_by_code, "volume_value") for code in related_codes) / max(1, len(related_codes)) / 500)
        technical_score = 45
        theme_score = round(
            news_heat * 0.30
            + spread * 0.20
            + supply_score * 0.20
            + price_score * 0.15
            + volume_score * 0.10
            + technical_score * 0.05
        )

        top_news = [
            {
                "title": event.get("title") or event.get("category") or "未命名新聞",
                "source": event.get("source_name") or "來源未標示",
                "url": event_url(event),
                "published_at": str(event.get("date") or "")[:10],
            }
            for event in matched
            if real_url(event_url(event))
        ][:3]
        quality = "medium" if matched and len(sources) >= 2 and mentioned_count >= 3 else "low"
        supply_text = sorted(supply) or ["供給訊號待補"]
        demand_text = sorted(demand) or ["需求訊號待補"]
        cost_text = sorted(costs)
        items.append({
            "rank": 0,
            "theme": theme,
            "theme_score": theme_score,
            "news_count": len(matched),
            "weighted_news_score": round(news_heat),
            "unique_sources": len(sources),
            "mentioned_stock_count": mentioned_count,
            "representative_stocks": [stock_label(code, stocks_by_code, master) for code in seed_stocks[:5]],
            "supply_demand": {
                "demand": demand_text,
                "supply": supply_text,
                "price_power": "、".join(cost_text) if cost_text else "報價 / 利差訊號待補",
                "inventory": "庫存下降或補庫存訊號待確認",
                "conclusion": "需求與供給訊號同步出現，需持續追蹤量價延續" if demand and supply else "目前供需證據不足，僅列為觀察",
            },
            "evidence": {
                "news": f"近五日命中 {len(matched)} 則新聞，來源 {len(sources)} 個。",
                "price": "以現有日資料與營收動能輔助判斷，完整五日漲跌待資料源補齊。",
                "technical": "完整 MA5 / MA10 / MA20 與新高資料待資料源補齊。",
                "volume": "以現有成交量欄位輔助判斷，20 日均量倍率待資料源補齊。",
                "fundamental": "以營收、報價、訂單、供需關鍵字輔助判斷。",
            },
            "top_news": top_news,
            "asurada_comment": "此題材依新聞熱度、來源數、個股擴散與供需關鍵字綜合排序。",
            "data_quality": quality,
            "data_quality_note": "缺少完整近五日漲跌、20日量比與均線資料" if quality == "low" else "已具多來源或多個股擴散訊號，但仍待完整量價資料補強",
        })

    items.sort(key=lambda item: (item["theme_score"], item["news_count"], item["mentioned_stock_count"]), reverse=True)
    for index, item in enumerate(items[:10], start=1):
        item["rank"] = index
    return {
        "generated_at": generated_at,
        "range": "近五個交易日",
        "source_note": "依公開新聞、題材關鍵字、個股提及次數、供需訊號與盤面表現統計",
        "items": items[:10],
    }


def stock_themes(stock: dict, themes: dict) -> list[str]:
    text = " ".join(str(stock.get(key, "")) for key in ["name", "concept", "business", "reason", "risk_tags"])
    code = norm_code(stock.get("code"))
    matched = []
    for theme, config in themes.items():
        stocks = {norm_code(item) for item in (config.get("stocks") or [])}
        if code in stocks or keyword_hits(text, config.get("keywords") or []):
            matched.append(theme)
    return matched


def build_low_base_ranking(generated_at: str, themes: dict, news_ranking: dict, stocks: list[dict], stocks_by_code: dict, master: dict):
    strong_themes = {item["theme"]: item for item in news_ranking.get("items", [])}
    rows = []
    for stock in stocks:
        code = norm_code(stock.get("code"))
        if not code or stock_market(code, stocks_by_code, master) != "上市":
            continue
        matched_themes = stock_themes(stock, themes)
        theme = next((item for item in matched_themes if item in strong_themes), matched_themes[0] if matched_themes else "")
        if not theme:
            continue
        theme_score = (strong_themes.get(theme) or {}).get("theme_score", 45)
        yoy = number(stock.get("revenue_yoy_value"))
        mom = number(stock.get("revenue_mom_value"))
        volume = number(stock.get("volume_value"))
        score_value = number(stock.get("score_value") or stock.get("score"))
        low_base_score = clamp(35 + max(0, 100 - score_value) * 0.3 + (20 if yoy < 0 or "低基期" in str(stock.get("reason", "")) else 0))
        price_volume = clamp(35 + max(0, mom) * 1.2 + min(30, volume / 1000))
        supply_score = 65 if theme in strong_themes else 35
        fundamental = clamp(40 + max(0, mom) * 1.1 + max(0, yoy) * 0.08)
        risk_control = 70 if volume >= 1000 else 45
        total = round(low_base_score * 0.25 + theme_score * 0.25 + price_volume * 0.20 + supply_score * 0.15 + fundamental * 0.10 + risk_control * 0.05)
        rows.append({
            "rank": 0,
            "code": code,
            "name": stock_name(code, stocks_by_code, master) or stock.get("name") or "名稱待補",
            "market": "上市",
            "theme": theme,
            "score": total,
            "price": number(stock.get("close"), None),
            "five_day_change_pct": None,
            "volume_ratio_20d": None,
            "position": {
                "near_120d_low": None,
                "distance_from_120d_high_pct": None,
                "range_position_pct": None,
            },
            "technical": {
                "above_ma5": None,
                "above_ma10": None,
                "above_ma20": None,
                "breakout": None,
                "note": "完整五日技術位置待資料源補齊；目前以營收、成交量與題材強度輔助排序",
            },
            "fundamental": {
                "revenue_yoy": yoy,
                "revenue_mom": mom,
                "turnaround_note": stock.get("reason") or "營收改善線索待補",
            },
            "supply_demand": {
                "demand": "對應強題材需求或資金輪動",
                "supply": "供需細項待新聞與產業資料補齊",
                "conclusion": "題材有熱度，需確認供需與量價是否延續",
            },
            "reason": stock.get("reason") or "低基期與題材連動觀察",
            "risk": "若量能退潮、跌回關鍵均線或題材新聞消退，代表低基期補漲失敗。",
            "data_quality": "low",
            "data_quality_note": "缺少 120 日位階、五日漲跌、20 日量比與均線完整資料",
        })

    rows.sort(key=lambda item: item["score"], reverse=True)
    for index, item in enumerate(rows[:20], start=1):
        item["rank"] = index
    return {
        "generated_at": generated_at,
        "range": "近五個交易日",
        "source_note": "依低位階、題材熱度、量價轉強、營收改善與供需催化排序",
        "items": rows[:20],
    }


def main():
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    themes = load_json(DATA / "theme-keywords.json", {})
    news = load_json(DATA / "news-events.json", [])
    stocks = load_json(DATA / "stocks-latest.json", [])
    master = load_json(DATA / "stock-master.json", {})
    stocks_by_code = {norm_code(stock.get("code")): stock for stock in stocks if norm_code(stock.get("code"))}

    news_ranking = build_news_theme_ranking(generated_at, themes, news, stocks_by_code, master)
    low_base = build_low_base_ranking(generated_at, themes, news_ranking, stocks, stocks_by_code, master)

    write_json(DATA / "news-theme-ranking.json", news_ranking)
    write_json(DATA / "low-base-theme-ranking.json", low_base)
    print(f"news-theme-ranking: {len(news_ranking['items'])} themes")
    print(f"low-base-theme-ranking: {len(low_base['items'])} stocks")


if __name__ == "__main__":
    main()
