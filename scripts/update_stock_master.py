import json
import re
import ssl
import tempfile
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TWSE_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L"
TPEX_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
TAIPEI_TZ = timezone(timedelta(hours=8))


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 asurada-stock-radar"})
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        context = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=40, context=context) as response:
            raw = response.read()

    last_error = None
    for encoding in ("utf-8-sig", "utf-8", "cp950", "big5"):
        try:
            return json.loads(raw.decode(encoding)), encoding
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Cannot decode {url}: {last_error}")


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def add_record(master, code, name, market, industry, source_date):
    code = clean_text(code)
    name = clean_text(name)
    industry = clean_text(industry)
    if not re.fullmatch(r"\d{4}", code) or not name:
        return False
    master[code] = {
        "name": name,
        "market": market,
        "industry": industry,
        "source_date": clean_text(source_date),
    }
    return True


def build_master():
    listed_rows, listed_encoding = fetch_json(TWSE_URL)
    otc_rows, otc_encoding = fetch_json(TPEX_URL)
    master = OrderedDict()
    stats = {
        "listed_count": 0,
        "otc_count": 0,
        "listed_encoding": listed_encoding,
        "otc_encoding": otc_encoding,
        "listed_source_url": TWSE_URL,
        "otc_source_url": TPEX_URL,
    }

    for row in listed_rows:
        if add_record(
            master,
            row.get("公司代號"),
            row.get("公司簡稱") or row.get("公司名稱"),
            "上市",
            row.get("產業別"),
            row.get("出表日期"),
        ):
            stats["listed_count"] += 1

    for row in otc_rows:
        if add_record(
            master,
            row.get("SecuritiesCompanyCode"),
            row.get("CompanyAbbreviation") or row.get("CompanyName"),
            "上櫃",
            row.get("SecuritiesIndustryCode"),
            row.get("Date"),
        ):
            stats["otc_count"] += 1

    return OrderedDict(sorted(master.items(), key=lambda item: item[0])), stats


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False, dir=str(path.parent)) as tmp:
        tmp.write(text)
        temp_name = tmp.name
    Path(temp_name).replace(path)


def main():
    master, stats = build_master()
    required = {
        "2330": "台積電",
        "2337": "旺宏",
        "2376": "技嘉",
        "3673": "TPK-KY",
    }
    errors = []
    for code, expected_name in required.items():
        actual = master.get(code, {}).get("name")
        if actual != expected_name:
            errors.append(f"{code} expected {expected_name}, got {actual}")
    if stats["listed_count"] < 900 or stats["otc_count"] < 700:
        errors.append(f"Unexpected counts listed={stats['listed_count']} otc={stats['otc_count']}")
    if errors:
        raise SystemExit("\n".join(errors))

    updated_at = datetime.now(TAIPEI_TZ).strftime("%Y-%m-%d %H:%M:%S Asia/Taipei")
    report = {
        "updated_at": updated_at,
        "success": True,
        "total_count": len(master),
        **stats,
        "output_files": [
            "data/stock-master.json",
            "docs/data/stock-master.json",
            "data/stock-master-report.json",
            "docs/data/stock-master-report.json",
        ],
    }
    master_text = json.dumps(master, ensure_ascii=False, indent=2) + "\n"
    report_text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    for rel in ("data/stock-master.json", "docs/data/stock-master.json"):
        atomic_write(ROOT / rel, master_text)
    for rel in ("data/stock-master-report.json", "docs/data/stock-master-report.json"):
        atomic_write(ROOT / rel, report_text)

    print(f"listed={stats['listed_count']}")
    print(f"otc={stats['otc_count']}")
    print(f"total={len(master)}")
    print("verified=2330,2337,2376,3673")


if __name__ == "__main__":
    main()
