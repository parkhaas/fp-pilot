#!/usr/bin/env python3
"""
[비활성화됨] 이 수집기는 현재 사용하지 않습니다.
공식 경로는 crawlers/youtube_crawler.py (YouTube Data API v3) 입니다.
다시 쓰려면 환경변수 ALLOW_YTDLP=1 을 설정하고 실행하세요.

FROMIS-FLIX 데이터 수집기 (API 키 불필요, yt-dlp 사용)

YouTube Data API 키가 없을 때 쓰는 대체 수집기입니다. 공개 페이지의 메타데이터만
읽어 data/videos.json 을 만듭니다. 영상 자체는 저장/재배포하지 않습니다.

준비:
    python -m pip install --user yt-dlp

사용법:
    python crawlers/collect_ytdlp.py --config crawlers/collect.json --out data
    python crawlers/collect_ytdlp.py --config crawlers/collect.json --out data --dry-run

동작:
    1) collect.json 의 playlists 각각 -> 그 재생목록의 category/members 로 태깅
    2) channels[].includeUploads -> 재생목록에 없는 업로드 영상은 uploadsCategory
       (길이<=maxShortsSeconds 또는 #shorts 는 shorts)
    3) channels[].includeShorts -> /shorts 탭 -> category "shorts"
    4) data/members.json 별칭으로 제목에서 멤버 추정
    5) 기존 data/videos.json 의 addedAt 보존, 병합 후 저장
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ts_to_iso(ts) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except (ValueError, OSError, OverflowError):
        return None


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def ytdlp_flat(url: str, cap: int) -> list[dict]:
    """재생목록/채널 탭을 평면(flat) 추출. 영상별 상세 요청 없이 목록만 가져옴."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--flat-playlist", "--dump-single-json",
        "--extractor-args", "youtubetab:approximate_date",
        "--playlist-end", str(cap),
        "--no-warnings",
        url,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=300)
    except subprocess.TimeoutExpired:
        print(f"[경고] 시간 초과: {url}", file=sys.stderr)
        return []
    if out.returncode != 0 or not out.stdout.strip():
        print(f"[경고] 추출 실패: {url}\n{(out.stderr or '').strip()[:300]}", file=sys.stderr)
        return []
    data = json.loads(out.stdout)
    entries = data.get("entries") or []
    # 중첩(채널 탭이 재생목록들을 담는 경우) 방어
    flat = []
    for e in entries:
        if e and e.get("entries"):
            flat.extend(x for x in e["entries"] if x)
        elif e:
            flat.append(e)
    return flat


def detect_members(title: str, members: list[dict], default: list[str]) -> list[str]:
    text = (title or "").lower()
    hits = [m["id"] for m in members
            if m["id"] != "all" and any(a.lower() in text for a in m.get("aliases", []))]
    if hits:
        return sorted(set(hits))
    return list(default) if default else ["all"]


def is_short(title: str, dur, max_short: int, kw: list[str]) -> bool:
    t = (title or "").lower()
    if any(k in t for k in kw):
        return True
    try:
        return 0 < int(dur) <= max_short
    except (TypeError, ValueError):
        return False


def main() -> None:
    ap = argparse.ArgumentParser(description="FROMIS-FLIX yt-dlp 수집기 (API 키 불필요)")
    ap.add_argument("--config", default="crawlers/collect.json")
    ap.add_argument("--out", default="data")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if os.environ.get("ALLOW_YTDLP") != "1":
        sys.exit(
            "[비활성화됨] yt-dlp 수집은 현재 막혀 있습니다. "
            "공식 경로는 crawlers/youtube_crawler.py 입니다. "
            "그래도 실행하려면 ALLOW_YTDLP=1 을 설정하세요."
        )

    cfg = load_json(Path(args.config), {})
    out_dir = Path(args.out)
    members = load_json(out_dir / "members.json", {"members": []}).get("members", [])
    existing = load_json(out_dir / "videos.json", {"videos": []}).get("videos", [])
    added_at_by_id = {v["videoId"]: v["addedAt"] for v in existing
                      if v.get("videoId") and v.get("addedAt")}

    kw_shorts = cfg.get("keywordRules", {}).get("shorts", ["#shorts"])
    max_short = int(cfg.get("maxShortsSeconds", 61))
    cap = int(cfg.get("maxPerSource", 1000))
    ts = now_iso()

    records: dict[str, dict] = {}   # videoId -> record (뒤 소스가 앞을 덮음)

    def add(entry: dict, category: str, default_members: list[str]):
        vid = entry.get("id")
        if not vid or len(vid) != 11:
            return
        title = entry.get("title") or ""
        if title.lower() in ("[private video]", "[deleted video]", "[unavailable video]"):
            return
        records[vid] = {
            "id": f"yt:{vid}",
            "videoId": vid,
            "title": title,
            "category": category,
            "channelTitle": entry.get("channel") or entry.get("uploader") or "",
            "publishedAt": ts_to_iso(entry.get("timestamp")),
            "addedAt": added_at_by_id.get(vid, ts),
            "members": detect_members(title, members, default_members),
            "duration": entry.get("duration"),
            "source": "youtube",
        }

    # 1) 재생목록 (명시 카테고리 우선)
    for pl in cfg.get("playlists", []):
        if not pl.get("url"):
            continue
        entries = ytdlp_flat(pl["url"], cap)
        for e in entries:
            add(e, pl.get("category", "sp_etc"), pl.get("members", []))
        print(f"재생목록 [{pl.get('label') or pl['url']}]: {len(entries)}개")

    claimed = set(records)

    # 2) 채널 업로드 (재생목록에 없는 것만)
    for ch in cfg.get("channels", []):
        base = ch["url"].rstrip("/")
        if ch.get("includeUploads", True):
            entries = ytdlp_flat(f"{base}/videos", cap)
            new = 0
            for e in entries:
                vid = e.get("id")
                if not vid or vid in claimed:
                    continue
                cat = "shorts" if is_short(e.get("title"), e.get("duration"), max_short, kw_shorts) \
                    else ch.get("uploadsCategory", "sp_etc")
                add(e, cat, [])
                new += 1
            print(f"채널 업로드 [{base}]: {len(entries)}개 중 신규 {new}개")

        if ch.get("includeShorts"):
            entries = ytdlp_flat(f"{base}/shorts", cap)
            new = 0
            for e in entries:
                vid = e.get("id")
                if not vid or vid in claimed:
                    continue
                add(e, "shorts", [])
                new += 1
            print(f"채널 쇼츠 [{base}]: {len(entries)}개 중 신규 {new}개")

    rows = list(records.values())
    rows.sort(key=lambda r: (r["publishedAt"] or "", r["addedAt"] or ""), reverse=True)

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["category"]] = counts.get(r["category"], 0) + 1

    meta = {
        "updatedAt": ts,
        "generator": "yt-dlp",
        "total": len(rows),
        "counts": counts,
    }

    print(f"\n합계 {len(rows)}개 / 신규 {sum(1 for r in rows if r['addedAt'] == ts)}개")
    print("카테고리:", json.dumps(counts, ensure_ascii=False))

    if args.dry_run:
        print("[dry-run] 파일 미기록")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "videos.json").write_text(
        json.dumps({"videos": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"기록 완료 -> {out_dir/'videos.json'}, {out_dir/'meta.json'}")


if __name__ == "__main__":
    main()
