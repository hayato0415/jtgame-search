from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
DEFAULT_OUTPUT = DOCS_DATA / "news-events.json"
TAIPEI_TZ = timezone(timedelta(hours=8), "Asia/Taipei")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


@dataclass(frozen=True)
class NewsSource:
    name: str
    url: str
    region: str


SOURCES = [
    NewsSource("CMoney 美股新聞快訊", "https://www.cmoney.tw/notes/?tag=76325", "國際"),
    NewsSource("CMoney 台股即時消息", "https://www.cmoney.tw/notes/?navId=twstock_news", "台股"),
    NewsSource("鉅亨美股新聞", "https://news.cnyes.com/news/cat/wd_stock", "國際"),
    NewsSource("鉅亨台股新聞", "https://news.cnyes.com/news/cat/tw_stock_news", "台股"),
    NewsSource("MoneyDJ 產業分析新聞", "https://www.moneydj.com/kmdj/common/listnewarticles.aspx?a=X0300000&svc=NW", "台股"),
    NewsSource("MoneyDJ 即時新聞總表", "https://www.moneydj.com/KMDJ/News/NewsRealList.aspx?a=MB010000", "台股"),
]


THEME_KEYWORDS = {
    "AI伺服器": ["AI伺服器", "NVIDIA", "輝達", "GB200", "GB300", "資料中心", "液冷", "散熱", "雲端", "算力"],
    "記憶體": ["記憶體", "DRAM", "NAND", "HBM", "SSD", "美光", "Micron", "海力士", "報價上漲", "模組"],
    "PCB／ABF／CCL": ["PCB", "ABF", "CCL", "載板", "銅箔基板", "HDI", "南電", "欣興", "高階材料"],
    "CPO／光通訊": ["CPO", "矽光子", "光通訊", "光模組", "800G", "1.6T", "交換器"],
    "重電": ["重電", "變壓器", "電網", "電力", "電纜", "電線", "儲能"],
    "被動元件": ["被動元件", "MLCC", "電容", "電阻", "國巨", "華新科", "凱美"],
    "半導體": ["半導體", "晶圓代工", "先進製程", "封測", "CoWoS", "先進封裝", "台積電", "聯發科"],
    "功率半導體": ["功率半導體", "二極體", "MOSFET", "SiC", "GaN", "電源管理"],
    "面板": ["面板", "光電", "群創", "友達", "彩晶", "FOPLP", "Micro LED"],
    "低軌衛星": ["低軌衛星", "衛星通訊", "SpaceX", "Starlink", "通訊衛星"],
    "軍工電子": ["軍工", "無人機", "航太", "國防", "飛彈", "軍用"],
    "金融壽險": ["金融", "金控", "銀行", "壽險", "保險", "利率"],
    "營建資產": ["營建", "營造", "資產", "都更", "土地", "房市"],
    "航運": ["航運", "航空", "海運", "貨櫃", "運價", "油價"],
}


THEME_STOCKS = {
    "AI伺服器": ["2305", "2356", "2359", "2360", "2368", "2376", "2382", "2404", "2495", "3017", "3231", "3706", "4916", "6669"],
    "記憶體": ["2337", "2344", "2408", "2451", "3006", "3260", "4967", "6770", "8299"],
    "PCB／ABF／CCL": ["2313", "2367", "2368", "3037", "3189", "4958", "6213", "6274", "8046", "8358"],
    "CPO／光通訊": ["2313", "2345", "3163", "3363", "3450", "4979", "6442", "6530"],
    "重電": ["1504", "1513", "1514", "1605", "1618", "2371", "4533", "6441"],
    "被動元件": ["2327", "2375", "2478", "2492", "3042", "3357", "6173"],
    "半導體": ["2330", "2303", "2454", "3711", "2449", "6239", "8150"],
    "功率半導體": ["2481", "3016", "3675", "3707", "5425", "8261"],
    "面板": ["2409", "3149", "3481", "6116", "6456"],
    "低軌衛星": ["2314", "2412", "3017", "3105", "3491", "5388", "6285"],
    "軍工電子": ["2634", "4572", "8033", "8222"],
    "金融壽險": ["2820", "2881", "2882", "2885", "2886", "2891"],
    "營建資產": ["1316", "1436", "2520", "2536", "2537", "2542", "5522"],
    "航運": ["2603", "2609", "2610", "2618", "2637", "6757"],
}


def now_taipei() -> datetime:
    return datetime.now(TAIPEI_TZ)


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def strip_tags(value: str) -> str:
    cleaned = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.I | re.S)
    cleaned = re.sub(r"<style\b[^>]*>.*?</style>", " ", cleaned, flags=re.I | re.S)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    return normalize_space(html.unescape(cleaned))


def title_key(title: str) -> str:
    return re.sub(r"[\W_]+", "", (title or "").lower())


def is_similar_title(title: str, seen: list[str], threshold: float = 0.9) -> bool:
    key = title_key(title)
    return not key or any(difflib.SequenceMatcher(None, key, old).ratio() >= threshold for old in seen)


def is_real_url(url: str) -> bool:
    lowered = (url or "").lower()
    return lowered.startswith("http") and "example.com" not in lowered and "localhost" not in lowered


def is_news_article_url(url: str) -> bool:
    lowered = (url or "").lower()
    if "cmoney.tw/notes/note-detail.aspx" in lowered and "nid=" in lowered:
        return True
    if "news.cnyes.com/news/id/" in lowered:
        return True
    if "moneydj.com" in lowered and "newsviewer.aspx" in lowered:
        return True
    return False


def decode_response(raw: bytes, content_type: str) -> str:
    match = re.search(r"charset=([\w-]+)", content_type or "", flags=re.I)
    encodings = ([match.group(1)] if match else []) + ["utf-8", "big5", "cp950"]
    for encoding in encodings:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def fetch_html(url: str, timeout: int = 12) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AsuradaStockRadar/1.0",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        },
    )
    for context in (ssl.create_default_context(), ssl._create_unverified_context()):
        try:
            with urlopen(request, timeout=timeout, context=context) as response:
                return decode_response(response.read(), response.headers.get("Content-Type", ""))
        except Exception:
            last_error = sys.exc_info()[1]
    raise OSError(str(last_error))


def parse_event_datetime(value: str) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("T", " ").replace("+08:00", "").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[: len(datetime.now().strftime(fmt))], fmt).replace(tzinfo=TAIPEI_TZ)
        except ValueError:
            continue
    return None


def parse_source_datetime(text: str, current: datetime) -> tuple[str, str]:
    value = normalize_space(text)
    if not value:
        return "", "missing"
    time_match = re.search(r"(?P<hour>[01]?\d|2[0-3]):(?P<minute>[0-5]\d)", value)
    hour = int(time_match.group("hour")) if time_match else 0
    minute = int(time_match.group("minute")) if time_match else 0
    for pattern, status in (
        (r"(?P<year>20\d{2})[-/.年](?P<month>\d{1,2})[-/.月](?P<day>\d{1,2})", "full"),
        (r"(?P<month>\d{1,2})[-/.月](?P<day>\d{1,2})日?", "month_day"),
    ):
        match = re.search(pattern, value)
        if not match:
            continue
        try:
            dt = datetime(
                int(match.groupdict().get("year") or current.year),
                int(match.group("month")),
                int(match.group("day")),
                hour,
                minute,
                tzinfo=TAIPEI_TZ,
            )
        except ValueError:
            continue
        return dt.strftime("%Y-%m-%d %H:%M"), status
    if re.search(r"(今天|今日)", value) and time_match:
        return current.replace(hour=hour, minute=minute, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M"), "today_time"
    if time_match:
        return current.replace(hour=hour, minute=minute, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M"), "time_only"
    return "", "missing"


def is_within_recent_days(value: str, current: datetime, days: int = 5) -> bool:
    parsed = parse_event_datetime(value)
    return bool(parsed and timedelta(0) <= current - parsed <= timedelta(days=days))


def extract_anchor_candidates(source: NewsSource, page_html: str, current: datetime) -> list[dict[str, str]]:
    pattern = re.compile(r"<a\b(?P<attrs>[^>]*)>(?P<body>.*?)</a>", flags=re.I | re.S)
    href_pattern = re.compile(r"href=[\"'](?P<href>[^\"']+)[\"']", flags=re.I)
    items: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    seen_titles: list[str] = []
    for match in pattern.finditer(page_html):
        href_match = href_pattern.search(match.group("attrs") or "")
        if not href_match:
            continue
        url = urljoin(source.url, html.unescape(href_match.group("href")))
        title = re.sub(r"^(更多|more)\s*", "", strip_tags(match.group("body")), flags=re.I)
        if not title or len(title) < 8 or not is_real_url(url) or not is_news_article_url(url):
            continue
        if url in seen_urls or is_similar_title(title, seen_titles):
            continue
        context_html = page_html[max(0, match.start() - 650): min(len(page_html), match.end() + 650)]
        context = strip_tags(context_html)
        published_at, date_status = parse_source_datetime(context, current)
        seen_urls.add(url)
        seen_titles.append(title_key(title))
        items.append({"title": title, "url": url, "published_at": published_at, "date_status": date_status, "context": context})
    return items


def fetch_detail_date(url: str, current: datetime, warnings: list[str]) -> tuple[str, str]:
    try:
        detail = fetch_html(url, timeout=8)
    except Exception as exc:
        warnings.append(f"明細頁時間讀取失敗：{url}：{exc}")
        return "", "missing"
    for pattern in (
        r"<time[^>]+datetime=[\"']([^\"']+)[\"']",
        r"datePublished[\"']?\s*[:=]\s*[\"']([^\"']+)[\"']",
        r"pubdate[\"']?\s*[:=]\s*[\"']([^\"']+)[\"']",
    ):
        match = re.search(pattern, detail, flags=re.I)
        if match:
            parsed = parse_event_datetime(match.group(1))
            if parsed:
                return parsed.strftime("%Y-%m-%d %H:%M"), "detail"
    return parse_source_datetime(strip_tags(detail[:10000]), current)


def load_stock_master() -> dict[str, str]:
    result: dict[str, str] = {}
    for path in (DOCS_DATA / "stock-master.json", DOCS_DATA / "stocks-latest.json"):
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        values = raw.values() if isinstance(raw, dict) else raw if isinstance(raw, list) else []
        for item in values:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or item.get("stock_id") or item.get("symbol") or "").strip()
            name = str(item.get("name") or item.get("stock_name") or "").strip()
            if code and name:
                result[code] = name
    return result


def infer_category(text: str) -> str:
    upper = text.upper()
    best_theme = ""
    best_score = 0
    for theme, keywords in THEME_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword.upper() in upper)
        if score > best_score:
            best_theme = theme
            best_score = score
    return best_theme


def related_keywords_for(category: str) -> list[str]:
    return THEME_KEYWORDS.get(category, [])[:12]


def related_stocks_for(category: str, text: str, stock_master: dict[str, str]) -> list[str]:
    found: list[str] = []
    for code, name in stock_master.items():
        if code in text or (name and name in text):
            found.append(code)
    for code in THEME_STOCKS.get(category, []):
        if code not in found:
            found.append(code)
    return found[:12]


def infer_market_group(category: str) -> str:
    return "非電子股" if category in {"金融壽險", "營建資產", "航運"} else "電子股"


def infer_strength(text: str) -> str:
    high_words = ["漲停", "創高", "大漲", "急噴", "缺貨", "報價上漲", "財報優於", "上修"]
    mid_words = ["轉強", "受惠", "帶動", "需求", "訂單", "反彈", "回補"]
    if any(word in text for word in high_words):
        return "高"
    if any(word in text for word in mid_words):
        return "中"
    return "中"


def infer_impact(text: str) -> str:
    positive = ["上漲", "成長", "優於", "受惠", "缺貨", "漲價", "上修", "轉強", "買盤", "大漲"]
    negative = ["下修", "衰退", "利空", "虧損", "暴跌", "降評", "風險", "裁員", "取消"]
    pos = sum(1 for word in positive if word in text)
    neg = sum(1 for word in negative if word in text)
    if pos > neg:
        return "偏多"
    if neg > pos:
        return "偏空"
    return "中性"


def make_summary(title: str, category: str, source_name: str) -> str:
    return f"{source_name} 報導與「{category}」題材相關，需搭配族群漲跌與成交量確認資金是否延續。"


def make_analysis(category: str, related_stocks: list[str], stock_master: dict[str, str]) -> str:
    names = [f"{stock_master.get(code, '')} {code}".strip() for code in related_stocks[:6]]
    return f"{category} 題材若持續發酵，可觀察 {'、'.join(names)} 等相關個股的量價連動。"


def read_previous(output: Path) -> tuple[list[dict[str, object]], set[str]]:
    if not output.exists():
        return [], set()
    try:
        raw = json.loads(output.read_text(encoding="utf-8"))
    except Exception:
        return [], set()
    items = raw.get("items", raw) if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return [], set()
    urls = {str(item.get("source_url") or item.get("url") or "") for item in items if isinstance(item, dict)}
    return [item for item in items if isinstance(item, dict)], urls


def build_events(limit: int, output: Path) -> tuple[list[dict[str, object]], dict[str, object]]:
    current = now_taipei()
    stock_master = load_stock_master()
    previous_items, previous_urls = read_previous(output)
    events: list[dict[str, object]] = []
    seen_urls: set[str] = set()
    seen_titles: list[str] = []
    errors: list[str] = []
    warnings: list[str] = []
    source_success = 0

    for source in SOURCES:
        try:
            links = extract_anchor_candidates(source, fetch_html(source.url), current)
            source_success += 1
        except Exception as exc:
            errors.append(f"{source.name}: {exc}")
            continue
        for item in links:
            title = item["title"]
            url = item["url"]
            if url in seen_urls or is_similar_title(title, seen_titles):
                continue
            published_at = item["published_at"]
            date_status = item["date_status"]
            if not published_at:
                published_at, date_status = fetch_detail_date(url, current, warnings)
            if not is_within_recent_days(published_at, current):
                continue
            text = f"{title} {item.get('context', '')}"
            category = infer_category(text)
            if not category:
                continue
            related_stocks = related_stocks_for(category, text, stock_master)
            if not related_stocks:
                continue
            seen_urls.add(url)
            seen_titles.append(title_key(title))
            events.append({
                "date": published_at,
                "title": title,
                "source_name": source.name,
                "source_url": url,
                "url": url,
                "category": category,
                "market_group": infer_market_group(category),
                "news_region": source.region,
                "related_keywords": related_keywords_for(category),
                "related_stocks": related_stocks,
                "summary": make_summary(title, category, source.name),
                "asurada_analysis": make_analysis(category, related_stocks, stock_master),
                "event_strength": infer_strength(text),
                "impact": infer_impact(text),
                "date_status": date_status,
            })
            if len(events) >= limit:
                break
        if len(events) >= limit:
            break

    for old in previous_items:
        if len(events) >= limit:
            break
        title = str(old.get("title") or "")
        url = str(old.get("source_url") or old.get("url") or "")
        if not title or not is_real_url(url) or url in seen_urls or is_similar_title(title, seen_titles):
            continue
        if not is_within_recent_days(str(old.get("date") or ""), current):
            continue
        merged = dict(old)
        merged["carried_forward"] = True
        seen_urls.add(url)
        seen_titles.append(title_key(title))
        events.append(merged)

    events.sort(key=lambda item: parse_event_datetime(str(item.get("date") or "")) or datetime(1900, 1, 1, tzinfo=TAIPEI_TZ), reverse=True)
    new_urls = {str(item.get("source_url") or item.get("url") or "") for item in events}
    dated = [str(item.get("date") or "") for item in events if item.get("date")]
    report = {
        "success": bool(events) and source_success > 0,
        "generated_at": current.strftime("%Y-%m-%d %H:%M:%S Asia/Taipei"),
        "events_count": len(events),
        "new_items_count": len([url for url in new_urls if url and url not in previous_urls]),
        "content_latest_at": max(dated) if dated else "",
        "sources_attempted": len(SOURCES),
        "sources_success": source_success,
        "errors": errors,
        "warnings": warnings[:12],
        "output": str(output.relative_to(ROOT)).replace("\\", "/"),
    }
    return events, report


def write_events(events: list[dict[str, object]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch latest source-linked market news for GitHub Pages.")
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--min-events", type=int, default=5)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output

    events, report = build_events(limit=max(args.limit, 1), output=output)
    if len(events) < args.min_events:
        report["success"] = False
        report["status"] = "insufficient_events"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    write_events(events, output)
    report["status"] = "ok" if report["success"] else "partial"
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
