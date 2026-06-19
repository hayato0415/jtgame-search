#!/usr/bin/env python3

import csv
import html
import json
import re
import shutil
import ssl
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SOURCE = "MoneyDJ"
LIST_URL = "https://www.moneydj.com/z/zg/zge/zge_E_E.djhtm"
CONCEPT_URL_TEMPLATE = "https://www.moneydj.com/z/zg/zge/zge_{code}_1.djhtm"

DATA_DIR = Path("data")
DOCS_DATA_DIR = Path("docs") / "data"
CATEGORY_CSV = DATA_DIR / "moneydj_concept_categories.csv"
STOCK_CSV = DATA_DIR / "moneydj_concept_stocks.csv"
REPORT_JSON = DATA_DIR / "moneydj_crawl_report.json"
DOCS_CATEGORY_CSV = DOCS_DATA_DIR / "moneydj_concept_categories.csv"
DOCS_STOCK_CSV = DOCS_DATA_DIR / "moneydj_concept_stocks.csv"

UPDATED_AT = date.today().isoformat()

REQUIRED_CHECKS = {
    "EH001276": {
        "3131": "\u5f18\u5851",
        "3037": "\u6b23\u8208",
    },
    "EH001253": {
        "5371": "\u4e2d\u5149\u96fb",
        "2412": "\u4e2d\u83ef\u96fb",
    },
}


def fetch_bytes(url):
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AsuradaMoneyDJCrawler/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.read()
    except ssl.SSLCertVerificationError:
        context = ssl._create_unverified_context()
        with urlopen(request, timeout=30, context=context) as response:
            return response.read()
    except URLError as exc:
        if isinstance(getattr(exc, "reason", None), ssl.SSLCertVerificationError):
            context = ssl._create_unverified_context()
            with urlopen(request, timeout=30, context=context) as response:
                return response.read()
        raise


def decode_html(raw_bytes):
    best_text = ""
    best_score = -10**9
    for encoding in ("cp950", "big5", "utf-8"):
        text = raw_bytes.decode(encoding, errors="replace")
        score = (
            text.count("\u6982\u5ff5\u80a1") * 20
            + text.count("GenLink2stk") * 10
            + len(re.findall(r"<select[^>]*name=[\"']M1[\"']", text, flags=re.I)) * 20
            - text.count("\ufffd") * 20
        )
        if score > best_score:
            best_text = text
            best_score = score
    return best_text


def fetch_html(url):
    return decode_html(fetch_bytes(url))


def clean_text(value):
    value = re.sub(r"<script\b[\s\S]*?</script>", "", value or "", flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def parse_categories(page_html):
    select_match = re.search(
        r"<select[^>]*name=[\"']M1[\"'][^>]*>(.*?)</select>",
        page_html,
        flags=re.I | re.S,
    )
    if not select_match:
        return []

    rows = []
    seen = set()
    option_pattern = re.compile(r'<option\s+value="([^"]+)"[^>]*>(.*?)</option>', flags=re.I | re.S)
    for match in option_pattern.finditer(select_match.group(1)):
        concept_code = match.group(1).strip().upper()
        concept_name = clean_text(match.group(2))
        if not concept_code or not concept_name or concept_code in seen:
            continue
        seen.add(concept_code)
        rows.append(
            {
                "display_order": len(rows) + 1,
                "concept_code": concept_code,
                "concept_name": concept_name,
                "source": SOURCE,
                "updated_at": UPDATED_AT,
                "status": "active",
            }
        )
    return rows


def parse_quote_date(page_html):
    match = re.search(r'<div[^>]*class=["\']t11["\'][^>]*>\s*\u65e5\u671f:\s*([^<]+)</div>', page_html, flags=re.I)
    return clean_text(match.group(1)) if match else ""


def parse_table_cells(row_html):
    return [clean_text(match.group(1)) for match in re.finditer(r"<td\b[^>]*>([\s\S]*?)</td>", row_html, flags=re.I)]


def parse_concept_stocks(page_html):
    quote_date = parse_quote_date(page_html)
    rows = []
    table_rows = re.findall(r"<tr\b[^>]*>([\s\S]*?)</tr>", page_html, flags=re.I)
    stock_pattern = re.compile(r"GenLink2stk\(['\"]AS(\d{4})['\"],['\"]([^'%\"]+)['\"]\)")

    for row_html in table_rows:
        stock_match = stock_pattern.search(row_html)
        if not stock_match:
            continue
        cells = parse_table_cells(row_html)
        if len(cells) < 5:
            continue
        rows.append(
            {
                "stock_id": stock_match.group(1),
                "stock_name": clean_text(stock_match.group(2)),
                "close_price": cells[1],
                "price_change": cells[2],
                "change_pct": cells[3],
                "volume": cells[4],
                "quote_date": quote_date,
            }
        )
    return rows


def concept_url(concept_code):
    return CONCEPT_URL_TEMPLATE.format(code=concept_code)


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_report(report):
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def validate_required(stock_rows):
    errors = []
    by_concept = {}
    for row in stock_rows:
        by_concept.setdefault(row["concept_code"], {})[row["stock_id"]] = row

    for concept_code, required_stocks in REQUIRED_CHECKS.items():
        concept_rows = by_concept.get(concept_code, {})
        for stock_id, stock_name in required_stocks.items():
            row = concept_rows.get(stock_id)
            if not row or row["stock_name"] != stock_name:
                errors.append(f"{concept_code} missing {stock_id} {stock_name}")
            if concept_code == "EH001253" and stock_id == "5371" and row:
                for field in ("close_price", "price_change", "change_pct", "volume"):
                    if not row.get(field):
                        errors.append(f"EH001253 5371 missing {field}")
    return errors


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    failed_concepts = []
    parse_errors = []
    stock_rows = []

    try:
        list_html = fetch_html(LIST_URL)
        categories = parse_categories(list_html)
        if not categories:
            raise RuntimeError('No concepts found from select[name="M1"] option.')

        for category in categories:
            source_url = concept_url(category["concept_code"])
            try:
                page_html = fetch_html(source_url)
                stocks = parse_concept_stocks(page_html)
                if not stocks:
                    failed_concepts.append(
                        {
                            "concept_code": category["concept_code"],
                            "concept_name": category["concept_name"],
                            "source_url": source_url,
                            "error": "0 stocks parsed",
                        }
                    )
                    continue
                for index, stock in enumerate(stocks, start=1):
                    stock_rows.append(
                        {
                            "display_order": category["display_order"],
                            "concept_code": category["concept_code"],
                            "concept_name": category["concept_name"],
                            "stock_order": index,
                            "stock_id": stock["stock_id"],
                            "stock_name": stock["stock_name"],
                            "close_price": stock["close_price"],
                            "price_change": stock["price_change"],
                            "change_pct": stock["change_pct"],
                            "volume": stock["volume"],
                            "quote_date": stock["quote_date"],
                            "source": SOURCE,
                            "source_url": source_url,
                            "updated_at": UPDATED_AT,
                            "status": "active",
                        }
                    )
            except (HTTPError, URLError, TimeoutError, OSError) as exc:
                failed_concepts.append(
                    {
                        "concept_code": category["concept_code"],
                        "concept_name": category["concept_name"],
                        "source_url": source_url,
                        "error": str(exc),
                    }
                )

        parse_errors.extend(validate_required(stock_rows))
        if failed_concepts:
            parse_errors.append(f"{len(failed_concepts)} concepts failed")

        report = {
            "categories_total": len(categories),
            "stocks_total": len(stock_rows),
            "unique_stocks_total": len({row["stock_id"] for row in stock_rows}),
            "failed_concepts": failed_concepts,
            "parse_errors": parse_errors,
            "updated_at": UPDATED_AT,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

        if parse_errors:
            write_report(report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1

        category_fields = ["display_order", "concept_code", "concept_name", "source", "updated_at", "status"]
        stock_fields = [
            "display_order",
            "concept_code",
            "concept_name",
            "stock_order",
            "stock_id",
            "stock_name",
            "close_price",
            "price_change",
            "change_pct",
            "volume",
            "quote_date",
            "source",
            "source_url",
            "updated_at",
            "status",
        ]
        write_csv(CATEGORY_CSV, categories, category_fields)
        write_csv(STOCK_CSV, stock_rows, stock_fields)
        write_report(report)
        shutil.copyfile(CATEGORY_CSV, DOCS_CATEGORY_CSV)
        shutil.copyfile(STOCK_CSV, DOCS_STOCK_CSV)

        eh001276 = [row for row in stock_rows if row["concept_code"] == "EH001276"]
        eh001253 = [row for row in stock_rows if row["concept_code"] == "EH001253"]
        stock_5371 = next((row for row in eh001253 if row["stock_id"] == "5371"), None)
        print(f"categories: {len(categories)}")
        print(f"stocks: {len(stock_rows)}")
        print(f"unique_stocks: {report['unique_stocks_total']}")
        print(f"EH001276_stocks: {len(eh001276)}")
        print(f"EH001253_stocks: {len(eh001253)}")
        print(f"EH001276_has_3131: {'yes' if any(row['stock_id'] == '3131' and row['stock_name'] == REQUIRED_CHECKS['EH001276']['3131'] for row in eh001276) else 'no'}")
        print(f"EH001276_has_3037: {'yes' if any(row['stock_id'] == '3037' and row['stock_name'] == REQUIRED_CHECKS['EH001276']['3037'] for row in eh001276) else 'no'}")
        print(f"EH001253_has_5371: {'yes' if stock_5371 else 'no'}")
        print(f"EH001253_5371_quote: {stock_5371 if stock_5371 else ''}")
        print(f"failed_concepts: {len(failed_concepts)}")
        return 0
    except Exception as exc:
        report = {
            "categories_total": 0,
            "stocks_total": 0,
            "unique_stocks_total": 0,
            "failed_concepts": [],
            "parse_errors": [str(exc)],
            "updated_at": UPDATED_AT,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
        write_report(report)
        print(f"crawl failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
