# -*- coding: utf-8 -*-
"""Refresh external search/video attention signals used by gameplay familiarity.

Bilibili is enabled by default because its anonymous public search response
contains both a capped result count and engagement metrics for the first page.
Bing is optional because its public result total is explicitly an estimate and
is slower to collect. Baidu Index and YouTube remain import slots until an
authorized export/API key is supplied; missing providers never invent a value.
"""

import argparse
import concurrent.futures
import html
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OPERATORS_PATH = ROOT / "server-data" / "operators.json"
OUTPUT_PATH = ROOT / "scripts" / "operator-attention-signals.json"
CACHE_PATH = ROOT / ".update-work" / "operator-attention-raw.json"
BILIBILI_SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type"
BILIBILI_SPI_URL = "https://api.bilibili.com/x/frontend/finger/spi"
BING_SEARCH_URL = "https://www.bing.com/search"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www.bilibili.com/",
    "Accept": "application/json, text/plain, */*",
}
REQUEST_DELAY = 0.0
REQUEST_LOCK = threading.Lock()
NEXT_REQUEST_AT = 0.0
MIN_PROVIDER_COVERAGE = 0.9


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def request_text(url, params, retries=3):
    global NEXT_REQUEST_AT
    target = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(target, headers=HEADERS)
    for attempt in range(retries):
        with REQUEST_LOCK:
            wait = max(0.0, NEXT_REQUEST_AT - time.monotonic())
            if wait:
                time.sleep(wait)
            NEXT_REQUEST_AT = time.monotonic() + REQUEST_DELAY
        try:
            with urllib.request.urlopen(request, timeout=24) as response:
                return response.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 == retries:
                raise
            time.sleep(2.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def initialize_bilibili_session():
    payload = json.loads(request_text(BILIBILI_SPI_URL, {}))
    if payload.get("code") != 0 or not payload.get("data"):
        raise RuntimeError("Could not create an anonymous Bilibili search session")
    data = payload["data"]
    HEADERS["Cookie"] = (
        f"buvid3={data['b_3']}; buvid4={data['b_4']}; "
        f"b_nut={int(time.time())}"
    )


def strip_markup(value):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(value or ""))).strip()


def numeric(value):
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    text = str(value or "").strip().lower().replace(",", "")
    multiplier = 1
    if text.endswith("万"):
        multiplier = 10000
        text = text[:-1]
    elif text.endswith("亿"):
        multiplier = 100000000
        text = text[:-1]
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group(0)) * multiplier if match else 0.0


def name_confidence(name):
    if len(name) == 1 or (name.isascii() and len(name) <= 2):
        return 0.52
    if len(name) == 2:
        return 0.78
    return 1.0


def fetch_bilibili(operator):
    name = operator["name"]
    data = None
    payload = None
    for attempt in range(3):
        payload = json.loads(request_text(BILIBILI_SEARCH_URL, {
            "search_type": "video",
            "keyword": f"明日方舟 {name}",
            "page": 1,
        }))
        if payload.get("code") == 0 and payload.get("data") and payload["data"].get("numResults"):
            data = payload["data"]
            break
        time.sleep(3 * (attempt + 1))
    if data is None:
        raise RuntimeError(
            f"Bilibili search failed or returned an empty soft-block response for {name}: "
            f"{(payload or {}).get('code')} {(payload or {}).get('message')}"
        )
    relevant = []
    lowered_name = name.lower()
    for video in data.get("result") or []:
        title = strip_markup(video.get("title"))
        tags = strip_markup(video.get("tag"))
        description = strip_markup(video.get("description"))
        searchable = f"{title} {tags} {description}".lower()
        if lowered_name not in searchable:
            continue
        gameText = f"{title} {tags} {description}"
        if "明日方舟" not in gameText and "方舟" not in gameText:
            continue
        relevant.append(video)
    top = relevant[:12]
    views = sum(numeric(video.get("play")) for video in top)
    engagement = sum(
        numeric(video.get("like"))
        + numeric(video.get("favorites"))
        + numeric(video.get("danmaku"))
        + numeric(video.get("review"))
        for video in top
    )
    result_count = int(data.get("numResults") or 0)
    raw = (
        0.18 * math.log1p(min(result_count, 1000))
        + 0.57 * math.log1p(views)
        + 0.25 * math.log1p(engagement)
    )
    relevance = clamp(len(relevant) / 10)
    reliability = name_confidence(name) * (0.4 + 0.6 * relevance)
    return {
        "raw": round(raw, 6),
        "resultCount": result_count,
        "relevantTopResults": len(relevant),
        "topViews": int(views),
        "topEngagement": int(engagement),
        "reliability": round(reliability, 3),
    }


def fetch_bing(operator):
    name = operator["name"]
    response = request_text(BING_SEARCH_URL, {
        "q": f'"明日方舟" "{name}"',
        "count": 10,
    })
    match = re.search(r'class="sb_count"[^>]*>\s*(?:About\s+)?([\d,]+)', response, re.I)
    if not match:
        raise RuntimeError(f"Bing result estimate missing for {name}")
    result_count = int(match.group(1).replace(",", ""))
    return {
        "raw": round(math.log1p(result_count), 6),
        "resultCount": result_count,
        "reliability": round(0.48 * name_confidence(name), 3),
    }


def valid_provider_record(provider, record):
    if not record or not math.isfinite(record.get("raw", math.nan)):
        return False
    if provider == "bilibiliVideo" and record.get("resultCount", 0) <= 0:
        return False
    return True


def percentile_indexes(records, provider):
    ranked = sorted(
        (record[provider]["raw"], operator_id)
        for operator_id, record in records.items()
        if valid_provider_record(provider, record.get(provider))
    )
    if not ranked:
        return
    size = len(ranked)
    position = 0
    while position < size:
        end = position + 1
        while end < size and ranked[end][0] == ranked[position][0]:
            end += 1
        percentile = 50.0 if size == 1 else 100 * ((position + end - 1) / 2) / (size - 1)
        for _, operator_id in ranked[position:end]:
            reliability = records[operator_id][provider]["reliability"]
            index = 50 + reliability * (percentile - 50)
            records[operator_id][provider]["index"] = round(clamp(index, 0, 100), 1)
        position = end


def main():
    global REQUEST_DELAY
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", default="bilibili", help="Comma-separated: bilibili,bing")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--delay", type=float, default=0.25, help="Global delay between HTTP requests")
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument(
        "--sanitize-only",
        action="store_true",
        help="Remove invalid cached responses and recompute coverage without making HTTP requests",
    )
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    REQUEST_DELAY = max(0.0, args.delay)

    operators = list(json.loads(OPERATORS_PATH.read_text(encoding="utf-8")).values())
    operators.sort(key=lambda item: item["id"])
    if args.limit:
        operators = operators[:args.limit]
    requested = [source.strip() for source in args.sources.split(",") if source.strip()]
    fetchers = {
        "bilibili": ("bilibiliVideo", fetch_bilibili),
        "bing": ("bingWeb", fetch_bing),
    }
    unknown = sorted(set(requested) - set(fetchers))
    if unknown:
        raise ValueError(f"Unknown providers: {', '.join(unknown)}")
    if "bilibili" in requested and not args.sanitize_only:
        initialize_bilibili_session()

    existing = {}
    if not args.no_resume and args.output.is_file():
        existing = json.loads(args.output.read_text(encoding="utf-8")).get("operators", {})
    records = {operator["id"]: dict(existing.get(operator["id"], {})) for operator in operators}
    failures = []
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    for requested_name in requested:
        provider, fetcher = fetchers[requested_name]
        for operator in operators:
            operator_record = records[operator["id"]]
            if provider in operator_record and not valid_provider_record(provider, operator_record[provider]):
                del operator_record[provider]
        pending = [] if args.sanitize_only else [
            operator for operator in operators
            if not valid_provider_record(provider, records[operator["id"]].get(provider))
        ]
        print(f"{provider}: resuming with {len(pending)} pending")
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
            futures = {executor.submit(fetcher, operator): operator for operator in pending}
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                operator = futures[future]
                try:
                    records[operator["id"]][provider] = future.result()
                except Exception as error:
                    failures.append({
                        "provider": provider,
                        "id": operator["id"],
                        "name": operator["name"],
                        "error": str(error),
                    })
                if index % 25 == 0 or index == len(pending):
                    print(f"{provider}: {index}/{len(pending)}")
        percentile_indexes(records, provider)

    captured = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    provider_coverage = {}
    for requested_name in requested:
        provider = fetchers[requested_name][0]
        valid_count = sum(
            1 for record in records.values()
            if valid_provider_record(provider, record.get(provider))
        )
        coverage = valid_count / len(operators) if operators else 0
        provider_coverage[provider] = {
            "valid": valid_count,
            "expected": len(operators),
            "coverage": round(coverage, 4),
            "minimum": MIN_PROVIDER_COVERAGE,
            "enabled": coverage >= MIN_PROVIDER_COVERAGE,
        }
    output = {
        "_meta": {
            "version": f"{captured[:10]}-attention-1",
            "capturedAt": captured,
            "queries": len(operators),
            "providers": [fetchers[name][0] for name in requested],
            "providerCoverage": provider_coverage,
            "failures": failures,
            "method": (
                "Per-provider percentile rank; ambiguous short names and weakly relevant result pages are "
                "shrunk toward neutral. A provider is eligible for gameplay only at 90% or greater coverage."
            ),
        },
        "operators": {operator_id: value for operator_id, value in records.items() if value},
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    CACHE_PATH.write_text(json.dumps(output, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "operators": len(output["operators"]),
        "failures": len(failures),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
