#!/usr/bin/env python3
"""
FLOVER-FLIX 무(無)API 수집기 — yt-dlp 로 공개 페이지를 스크래핑 (API 키·쿼터 불필요)

crawlers/sources.json 을 그대로 읽어 playlists / extraChannels / search[] 를 처리합니다.
영상 메타데이터만 저장하며 영상 자체는 내려받지 않습니다.

준비:
    python -m pip install --user yt-dlp

사용 (로컬 전체 백필):
    python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data
    python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data --only search --dry-run

주의:
  - search[] 는 "채널 내 검색" 탭( youtube.com/channel/<ID>/search?query= )을 flat 추출합니다.
    flat 모드엔 description 이 없어 textAny/textAll 은 제목 기준으로만 검사됩니다.
  - GitHub Actions IP 에서는 yt-dlp 가 봇 차단을 자주 맞습니다. 정기 수집은
    youtube_crawler.py(API) 를 쓰고, 이 스크립트는 로컬 백필용으로 쓰세요.
  - 기존 data/videos.json 과 병합합니다(addedAt 보존). API 데이터 위에 얹혀도 됩니다.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ts_to_iso(ts) -> str | None:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(microsecond=0)\
            .isoformat().replace("+00:00", "Z")
    except (ValueError, OSError, OverflowError):
        return None


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


ISO_DUR = re.compile(r"P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def dur_seconds(v) -> int:
    if isinstance(v, (int, float)):
        return int(v)
    m = ISO_DUR.fullmatch(str(v or ""))
    if not m:
        return 0
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def ytdlp_flat(url: str, cap: int, retries: int = 2) -> list[dict]:
    """재생목록 / 채널 탭 / 채널내검색 을 flat 추출."""
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--flat-playlist", "--dump-single-json",
        "--extractor-args", "youtubetab:approximate_date",
        "--playlist-end", str(cap),
        "--no-warnings", "--ignore-errors",
        url,
    ]
    last = ""
    for attempt in range(retries + 1):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True,
                                 encoding="utf-8", timeout=600)
        except subprocess.TimeoutExpired:
            last = "timeout"
            time.sleep(2 * (attempt + 1))
            continue
        if out.returncode == 0 and out.stdout.strip():
            try:
                data = json.loads(out.stdout)
            except json.JSONDecodeError:
                last = "json decode error"
                continue
            flat: list[dict] = []
            for e in data.get("entries") or []:
                if e and e.get("entries"):
                    flat.extend(x for x in e["entries"] if x)
                elif e:
                    flat.append(e)
            return flat
        last = (out.stderr or "").strip()[-300:]
        time.sleep(2 * (attempt + 1))
    print(f"[경고] 추출 실패: {url}\n  {last}", file=sys.stderr)
    return []


# --------------------------------------------------------------------------- #
# 분류 / 필터 / 멤버 (youtube_crawler.py 와 동일 규칙, 제목 기준)
# --------------------------------------------------------------------------- #

def classify(title: str, dur: int, rules: dict, max_shorts: int) -> str:
    t = (title or "").lower()
    if 0 < dur <= max_shorts or any(k in t for k in rules.get("shorts", [])):
        return "shorts"
    for cat in ("stage_fancam", "music_show", "mv_teaser", "self_content"):
        if any(k in t for k in rules.get(cat, [])):
            return cat
    return "variety_external"


def _any(text: str, terms) -> bool:
    return any(str(t).lower() in text for t in (terms or []))


def _all(text: str, terms) -> bool:
    return all(str(t).lower() in text for t in (terms or []))


def passes(entry: dict, spec: dict) -> bool:
    if not spec:
        return True
    title = (entry.get("title") or "").lower()
    ch = (entry.get("channel") or entry.get("uploader") or "").lower()
    dur = dur_seconds(entry.get("duration"))
    pub = ts_to_iso(entry.get("timestamp")) or ""
    text = title  # flat 모드엔 description 이 없음
    if spec.get("titleAny") and not _any(title, spec["titleAny"]):
        return False
    if spec.get("titleAll") and not _all(title, spec["titleAll"]):
        return False
    if spec.get("textAny") and not _any(text, spec["textAny"]):
        return False
    if spec.get("textAll") and not _all(text, spec["textAll"]):
        return False
    if spec.get("channelAny") and not _any(ch, spec["channelAny"]):
        return False
    if spec.get("excludeText") and _any(text, spec["excludeText"]):
        return False
    if spec.get("excludeChannels") and _any(ch, spec["excludeChannels"]):
        return False
    if spec.get("minSec") and dur and dur < int(spec["minSec"]):
        return False
    if spec.get("maxSec") and dur and dur > int(spec["maxSec"]):
        return False
    if spec.get("publishedAfter") and pub and pub < spec["publishedAfter"]:
        return False
    if spec.get("publishedBefore") and pub and pub > spec["publishedBefore"]:
        return False
    return True


def detect_members(title: str, members: list[dict], default: list[str]) -> list[str]:
    text = (title or "").lower()
    hits = sorted({m["id"] for m in members
                   if m["id"] != "all"
                   and any(a.lower() in text for a in m.get("aliases", []))})
    if default:
        return sorted(set(default) | set(hits))
    return hits or ["all"]


def search_urls(entry: dict, query: str) -> list[str]:
    q = urllib.parse.quote(query)
    cids = [c for c in (entry.get("channelIds") or []) if c]
    handles = [h.lstrip("@") for h in (entry.get("channels") or []) if h]
    urls = [f"https://www.youtube.com/channel/{c}/search?query={q}" for c in cids]
    urls += [f"https://www.youtube.com/@{h}/search?query={q}" for h in handles]
    if not urls:  # 채널 제한 없으면 전체 검색(날짜순)
        urls = [f"ytsearchdate{int(entry.get('maxPerQuery', 200))}:{query}"]
    return urls


# --------------------------------------------------------------------------- #
# 메인
# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(description="FLOVER-FLIX yt-dlp 수집기 (API 불필요)")
    ap.add_argument("--config", default="crawlers/sources.json")
    ap.add_argument("--out", default="data")
    ap.add_argument("--only", choices=["all", "search", "playlists"], default="all")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_json(Path(args.config), {})
    out_dir = Path(args.out)
    members = load_json(out_dir / "members.json", {"members": []}).get("members", [])
    existing = load_json(out_dir / "videos.json", {"videos": []}).get("videos", [])
    existing_by_id = {v["videoId"]: v for v in existing if v.get("videoId")}

    rules = cfg.get("keywordRules", {})
    max_shorts = int(cfg.get("maxShortsSeconds", 61))
    pl_cap = int(cfg.get("maxPerPlaylist", 800))
    default_filter = cfg.get("defaultFilter", {})
    ts = now_iso()

    do_pl = args.only in ("all", "playlists")
    do_search = args.only in ("all", "search")

    def shorthand(kw) -> dict:
        return {"titleAny": list(kw)} if kw else {}

    # vid -> (flat_entry, category, default_members, filter_spec).  먼저 담긴 소스가 우선.
    cand: dict[str, tuple[dict, str, list, dict]] = {}

    def take(entry: dict, category: str, mem: list, fspec: dict, overwrite: bool):
        vid = entry.get("id")
        if not vid or len(vid) != 11:
            return
        t = (entry.get("title") or "").lower()
        if t in ("[private video]", "[deleted video]", "[unavailable video]"):
            return
        if overwrite or vid not in cand:
            cand[vid] = (entry, category, mem, fspec)

    # 1) playlists + extraChannels (명시 카테고리 우선 → overwrite)
    if do_pl:
        srcs = [s for s in cfg.get("playlists", []) if s.get("id")]
        srcs += [s for s in cfg.get("extraChannels", []) if s.get("playlistId")]
        for s in srcs:
            pid = s.get("id") or s.get("playlistId")
            fspec = s.get("filter") or shorthand(s.get("filterKeywords"))
            ents = ytdlp_flat(f"https://www.youtube.com/playlist?list={pid}", pl_cap)
            for e in ents:
                take(e, s.get("category", "auto"), s.get("members", []), fspec, overwrite=True)
            print(f"재생목록 [{s.get('label') or pid}]: {len(ents)}개")

    # 2) search[] (setdefault — 재생목록이 이미 잡은 건 그 분류 유지)
    if do_search:
        for entry in cfg.get("search", []):
            fspec = entry.get("filter")
            if fspec is None:
                fspec = default_filter
            cap = int(entry.get("maxPerQuery", 200))
            queries = entry.get("queries") or ([entry["query"]] if entry.get("query") else [])
            got = 0
            for q in queries:
                for url in search_urls(entry, q):
                    ents = ytdlp_flat(url, cap)
                    got += len(ents)
                    for e in ents:
                        take(e, entry.get("category", "auto"),
                             entry.get("members", []), fspec, overwrite=False)
            print(f"검색 [{entry.get('label') or (queries[0] if queries else '?')}]: 원시 {got}개")

    if not cand:
        sys.exit("[중단] 수집된 후보가 없습니다. sources.json 을 확인하세요.")

    # 3) 필터 → 레코드
    records: list[dict] = []
    dropped = 0
    for vid, (e, hint, def_mem, fspec) in cand.items():
        if not passes(e, fspec):
            dropped += 1
            continue
        title = e.get("title") or "(제목 없음)"
        dur = dur_seconds(e.get("duration"))
        category = hint if hint and hint != "auto" else classify(title, dur, rules, max_shorts)
        prev = existing_by_id.get(vid)
        records.append({
            "id": f"yt:{vid}",
            "videoId": vid,
            "title": title,
            "category": category,
            "channelTitle": e.get("channel") or e.get("uploader") or "",
            "publishedAt": ts_to_iso(e.get("timestamp")),
            "addedAt": prev["addedAt"] if prev and prev.get("addedAt") else ts,
            "members": detect_members(title, members, def_mem),
            "duration": e.get("duration"),
            "source": "youtube",
        })

    # 병합: 이번 실행에서 다시 만나지 않은 기존 영상은 그대로 유지
    #  (스크래핑 일부 실패·부분 실행 대비. 신규가 기존보다 우선)
    seen = {r["videoId"] for r in records}
    kept = sum(1 for v in existing if v.get("videoId") not in seen)
    records += [v for v in existing if v.get("videoId") not in seen]
    if kept:
        print(f"기존 데이터 유지: {kept}개")

    records.sort(key=lambda r: (r["addedAt"] or "", r["publishedAt"] or ""), reverse=True)

    counts: dict[str, int] = {}
    for r in records:
        counts[r["category"]] = counts.get(r["category"], 0) + 1

    meta = {"updatedAt": ts, "generator": "yt-dlp", "total": len(records), "counts": counts}

    print(f"\n합계 {len(records)}개 / 필터 제외 {dropped}개 / "
          f"신규 {sum(1 for r in records if r['addedAt'] == ts)}개")
    print("카테고리:", json.dumps(counts, ensure_ascii=False))

    if args.dry_run:
        print("[dry-run] 파일 미기록")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "videos.json").write_text(
        json.dumps({"videos": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"기록 완료 -> {out_dir/'videos.json'}, {out_dir/'meta.json'}")


if __name__ == "__main__":
    main()
