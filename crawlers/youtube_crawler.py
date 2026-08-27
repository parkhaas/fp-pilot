#!/usr/bin/env python3
"""
FROMIS-FLIX 데이터 수집기 — YouTube Data API v3 (공식 API 우선, 표준 라이브러리만 사용)

사용법:
    export YOUTUBE_API_KEY="..."      # 또는 --api-key 로 전달
    python crawlers/youtube_crawler.py --config crawlers/sources.json --out data

동작:
    1) sources.json 의 handle -> channelId -> uploads 재생목록 해석
    2) uploads + playlists + extraChannels 재생목록 + search(검색) 로 후보 수집
    3) videos.list 로 상세 조회, filter 규칙 적용(커버/리액션 제외 등)
    4) 카테고리 분류(소스 지정값 우선, "auto" 는 키워드/길이 휴리스틱)
    5) data/members.json 별칭으로 제목에서 멤버 추정
    6) 기존 data/videos.json 과 병합(addedAt 보존), data/meta.json 갱신

sources.json 주요 키:
    handle/channelId, includeUploads, uploadsCategory, maxPerPlaylist
    playlists[]      { id, category, members[], filter{} | filterKeywords[] }
    extraChannels[]  { playlistId, category, members[], filter{} | filterKeywords[] }
    search[]         { queries[], channels[]/channelIds[], category, members[],
                       order, maxPerQuery, publishedAfter, filter{} }
    defaultFilter{}  search 항목에 filter 가 없을 때 적용되는 공통 규칙
    searchPublishedAfter   search 기본 시작일(ISO8601)
    keywordRules{}, maxShortsSeconds   "auto" 분류용

주의: 영상 메타데이터만 저장하며 영상 자체는 저장/재배포하지 않습니다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_ROOT = "https://www.googleapis.com/youtube/v3"


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def api_get(path: str, params: dict, api_key: str, retries: int = 3) -> dict:
    params = {**params, "key": api_key}
    url = f"{API_ROOT}/{path}?" + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code in (403, 429) and "quota" in body.lower():
                sys.exit(f"[중단] YouTube API 쿼터 초과: {body[:300]}")
            last_err = f"HTTP {e.code}: {body[:300]}"
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"API 요청 실패 ({path}): {last_err}")


def paginate(path: str, params: dict, api_key: str, cap: int) -> list[dict]:
    items: list[dict] = []
    page_token = None
    while len(items) < cap:
        p = {**params, "maxResults": 50}
        if page_token:
            p["pageToken"] = page_token
        data = api_get(path, p, api_key)
        items.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return items[:cap]


# --------------------------------------------------------------------------- #
# 소스 해석
# --------------------------------------------------------------------------- #

def resolve_channel(cfg: dict, api_key: str) -> tuple[str, str]:
    """(channelId, uploadsPlaylistId) 반환"""
    channel_id = (cfg.get("channelId") or "").strip()
    if not channel_id:
        handle = (cfg.get("handle") or "").strip().lstrip("@")
        if not handle:
            sys.exit("[중단] sources.json 에 channelId 또는 handle 이 필요합니다.")
        data = api_get(
            "channels",
            {"part": "contentDetails,snippet", "forHandle": handle},
            api_key,
        )
        if not data.get("items"):
            sys.exit(f"[중단] 핸들 @{handle} 로 채널을 찾지 못했습니다.")
        channel_id = data["items"][0]["id"]
    data = api_get("channels", {"part": "contentDetails", "id": channel_id}, api_key)
    if not data.get("items"):
        sys.exit(f"[중단] channelId {channel_id} 조회 실패.")
    uploads = data["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
    return channel_id, uploads


def collect_playlist(playlist_id: str, api_key: str, cap: int) -> list[str]:
    """재생목록의 videoId 목록. 세부 필터링은 상세 조회 후 apply_filter 에서 처리."""
    raw = paginate(
        "playlistItems",
        {"part": "contentDetails", "playlistId": playlist_id},
        api_key,
        cap,
    )
    return [it["contentDetails"]["videoId"]
            for it in raw if it.get("contentDetails", {}).get("videoId")]


def resolve_channel_id(ref: str, api_key: str) -> str | None:
    """@handle 또는 UC... 문자열을 channelId 로. 실패 시 None."""
    ref = (ref or "").strip()
    if ref.startswith("UC") and len(ref) == 24:
        return ref
    handle = ref.lstrip("@")
    if not handle:
        return None
    data = api_get("channels", {"part": "id", "forHandle": handle}, api_key)
    if data.get("items"):
        return data["items"][0]["id"]
    # 폴백: 채널 검색 (100 쿼터)
    data = api_get("search",
                   {"part": "snippet", "type": "channel", "q": handle, "maxResults": 1},
                   api_key)
    items = data.get("items")
    return items[0]["snippet"]["channelId"] if items else None


def run_search(entry: dict, api_key: str, default_after: str) -> list[str]:
    """search.list 기반 수집. 호출당 100 쿼터이므로 queries/channels/maxPerQuery 로 범위를 좁힐 것.

    entry 필드:
      queries[]      필수. 검색어 목록
      channels[]     핸들(@..) 또는 UC.. — 이 채널들로 검색 제한 (권장; 노이즈↓)
      channelIds[]   channels 와 합쳐짐
      order          date | relevance | viewCount   (기본 date)
      maxPerQuery    쿼리·채널 조합당 최대 결과 (기본 50)
      publishedAfter / publishedBefore   ISO8601. 없으면 상위 searchPublishedAfter 사용
    """
    queries = entry.get("queries") or ([entry["query"]] if entry.get("query") else [])
    if not queries:
        return []
    cids = [c for c in (entry.get("channelIds") or []) if c]
    for h in entry.get("channels") or []:
        cid = resolve_channel_id(h, api_key)
        if cid:
            cids.append(cid)
        else:
            print(f"  [경고] 채널 해석 실패: {h}", file=sys.stderr)

    order = entry.get("order", "date")
    per = int(entry.get("maxPerQuery", 50))
    after = entry.get("publishedAfter") or default_after
    before = entry.get("publishedBefore")
    targets = cids or [None]

    found: list[str] = []
    calls = 0
    for q in queries:
        for cid in targets:
            base = {"part": "snippet", "type": "video", "q": q, "order": order}
            if cid:
                base["channelId"] = cid
            if after:
                base["publishedAfter"] = after
            if before:
                base["publishedBefore"] = before
            token, got = None, 0
            while got < per:
                p = dict(base, maxResults=min(50, per - got))
                if token:
                    p["pageToken"] = token
                data = api_get("search", p, api_key)
                calls += 1
                for it in data.get("items", []):
                    vid = it.get("id", {}).get("videoId")
                    if vid:
                        found.append(vid)
                        got += 1
                token = data.get("nextPageToken")
                if not token:
                    break
    uniq = list(dict.fromkeys(found))
    print(f"  검색 [{entry.get('label') or queries[0]}]: "
          f"{calls}회 호출(~{calls * 100} 쿼터) → 후보 {len(uniq)}개")
    return uniq


# --------------------------------------------------------------------------- #
# 필터 규칙
# --------------------------------------------------------------------------- #

def _any(text: str, terms) -> bool:
    return any(str(t).lower() in text for t in (terms or []))


def _all(text: str, terms) -> bool:
    return all(str(t).lower() in text for t in (terms or []))


def apply_filter(detail: dict, spec: dict) -> bool:
    """영상 상세(videos.list item)가 filter 규칙을 통과하는지.

    spec 필드 (모두 선택, 지정한 것만 검사):
      titleAny / titleAll      제목에 (하나 이상 / 전부)
      textAny  / textAll       제목+설명에 (하나 이상 / 전부)
      channelAny               channelTitle 에 하나 이상 (검색이 채널 제한 안 될 때 유용)
      excludeText              제목+설명에 하나라도 있으면 탈락 (커버/리액션 등)
      excludeChannels          channelTitle 에 하나라도 있으면 탈락
      minSec / maxSec          영상 길이(초) 하한/상한 (0 = 무제한)
      publishedAfter / publishedBefore   ISO8601 문자열 비교
    """
    if not spec:
        return True
    sn = detail.get("snippet", {})
    title = (sn.get("title") or "").lower()
    desc = (sn.get("description") or "").lower()
    text = title + "\n" + desc
    ch = (sn.get("channelTitle") or "").lower()
    dur = duration_seconds(detail.get("contentDetails", {}).get("duration", ""))
    pub = sn.get("publishedAt") or ""

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


# --------------------------------------------------------------------------- #
# 영상 상세 + 분류
# --------------------------------------------------------------------------- #

ISO_DUR = re.compile(r"P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def duration_seconds(iso: str) -> int:
    m = ISO_DUR.fullmatch(iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def fetch_details(video_ids: list[str], api_key: str) -> dict[str, dict]:
    details: dict[str, dict] = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        data = api_get(
            "videos",
            {"part": "snippet,contentDetails,status", "id": ",".join(chunk)},
            api_key,
        )
        for it in data.get("items", []):
            details[it["id"]] = it
    return details


def classify(title: str, desc: str, dur: int, rules: dict, max_shorts: int) -> str:
    text = f"{title}\n{desc}".lower()
    # shorts 는 길이 조건 우선
    if 0 < dur <= max_shorts or any(k in text for k in rules.get("shorts", [])):
        return "shorts"
    order = ["stage_fancam", "music_show", "mv_teaser", "self_content"]
    for cat in order:
        if any(k in text for k in rules.get(cat, [])):
            return cat
    return "variety_external"


def detect_members(title: str, members: list[dict]) -> list[str]:
    """제목에서만 멤버를 추정한다. 설명란 해시태그는 보통 전 멤버를 나열해
    필터 의미가 없어지므로 제외한다."""
    text = (title or "").lower()
    hits = []
    for m in members:
        if m["id"] == "all":
            continue
        if any(alias.lower() in text for alias in m.get("aliases", [])):
            hits.append(m["id"])
    return hits


# --------------------------------------------------------------------------- #
# 메인
# --------------------------------------------------------------------------- #

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def main() -> None:
    ap = argparse.ArgumentParser(description="FROMIS-FLIX YouTube 수집기")
    ap.add_argument("--config", default="crawlers/sources.json")
    ap.add_argument("--out", default="data", help="데이터 디렉터리")
    ap.add_argument("--api-key", default=os.environ.get("YOUTUBE_API_KEY", ""))
    ap.add_argument("--since", default="",
                    help="search 시작일 override (YYYY-MM-DD 또는 ISO8601). "
                         "정기 실행은 최근 N일만 검색해 쿼터를 아끼고, 생략 시 sources.json 의 "
                         "searchPublishedAfter(전체 백필)를 사용")
    ap.add_argument("--no-search", action="store_true",
                    help="search[] 항목을 건너뜀 (재생목록만 갱신, search 쿼터 절약)")
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 요약만 출력")
    args = ap.parse_args()

    if not args.api_key:
        sys.exit("[중단] YOUTUBE_API_KEY 환경변수 또는 --api-key 가 필요합니다.")

    cfg = load_json(Path(args.config), {})
    out_dir = Path(args.out)
    members = load_json(out_dir / "members.json", {"members": []}).get("members", [])
    existing = load_json(out_dir / "videos.json", {"videos": []}).get("videos", [])
    existing_by_id = {v["videoId"]: v for v in existing if v.get("videoId")}

    rules = cfg.get("keywordRules", {})
    max_shorts = int(cfg.get("maxShortsSeconds", 61))
    cap = int(cfg.get("maxPerPlaylist", 500))
    default_filter = cfg.get("defaultFilter", {})
    default_after = (args.since or cfg.get("searchPublishedAfter", "")).strip()
    if default_after and "T" not in default_after:
        default_after += "T00:00:00Z"
    if default_after:
        print(f"search 시작일: {default_after}")

    def shorthand(kw) -> dict:
        return {"titleAny": list(kw)} if kw else {}

    # 1) 후보 수집  vid -> (category, defaultMembers, filterSpec).  뒤 소스가 앞을 덮음.
    candidates: dict[str, tuple[str, list, dict]] = {}

    _, uploads_playlist = resolve_channel(cfg, args.api_key)
    if cfg.get("includeUploads", True):
        for vid in collect_playlist(uploads_playlist, args.api_key, cap):
            candidates[vid] = (cfg.get("uploadsCategory", "auto"), [], {})

    for pl in cfg.get("playlists", []):
        if not pl.get("id"):
            continue
        fspec = pl.get("filter") or shorthand(pl.get("filterKeywords"))
        try:
            for vid in collect_playlist(pl["id"], args.api_key, cap):
                candidates[vid] = (pl.get("category", "auto"), pl.get("members", []), fspec)
        except RuntimeError as e:
            print(f"[경고] 재생목록 {pl['id']} 건너뜀: {e}", file=sys.stderr)

    for ex in cfg.get("extraChannels", []):
        if not ex.get("playlistId"):
            continue
        fspec = ex.get("filter") or shorthand(ex.get("filterKeywords"))
        try:
            for vid in collect_playlist(ex["playlistId"], args.api_key, cap):
                candidates[vid] = (ex.get("category", "auto"), ex.get("members", []), fspec)
        except RuntimeError as e:
            print(f"[경고] 재생목록 {ex['playlistId']} 건너뜀: {e}", file=sys.stderr)

    for s in (cfg.get("search", []) if not args.no_search else []):
        fspec = s.get("filter")
        if fspec is None:
            fspec = default_filter
        try:
            for vid in run_search(s, args.api_key, default_after):
                # 명시 재생목록이 이미 잡은 영상은 그 분류를 유지
                candidates.setdefault(vid, (s.get("category", "auto"), s.get("members", []), fspec))
        except RuntimeError as e:
            print(f"[경고] 검색 [{s.get('label')}] 건너뜀: {e}", file=sys.stderr)

    if not candidates:
        sys.exit("[중단] 수집된 영상이 없습니다. sources.json 을 확인하세요.")

    # 2) 상세 조회
    details = fetch_details(list(candidates), args.api_key)

    # 3) 레코드 구성
    ts = now_iso()
    records: list[dict] = []
    skipped = skipped_filter = 0
    for vid, (hint, def_members, fspec) in candidates.items():
        d = details.get(vid)
        if not d:
            skipped += 1
            continue
        sn, st = d.get("snippet", {}), d.get("status", {})
        if st.get("privacyStatus") != "public" or st.get("embeddable") is False:
            skipped += 1
            continue
        if sn.get("liveBroadcastContent") in ("upcoming", "live"):
            skipped += 1
            continue
        if not apply_filter(d, fspec):
            skipped_filter += 1
            continue

        title = sn.get("title", "")
        desc = sn.get("description", "")
        dur = duration_seconds(d.get("contentDetails", {}).get("duration", ""))
        category = hint if hint and hint != "auto" else classify(title, desc, dur, rules, max_shorts)

        hits = detect_members(title, members)
        if def_members:
            mem = sorted(set(def_members) | set(hits))   # 코너 고정 멤버 + 제목에 언급된 게스트
        else:
            mem = hits or ["all"]

        prev = existing_by_id.get(vid)
        records.append(
            {
                "id": f"yt:{vid}",
                "videoId": vid,
                "title": title,
                "category": category,
                "channelTitle": sn.get("channelTitle", ""),
                "publishedAt": sn.get("publishedAt"),
                "addedAt": prev["addedAt"] if prev and prev.get("addedAt") else ts,
                "members": mem,
                "duration": d.get("contentDetails", {}).get("duration", ""),
                "source": "youtube",
            }
        )

    records.sort(key=lambda r: (r["addedAt"] or "", r["publishedAt"] or ""), reverse=True)

    counts: dict[str, int] = {}
    for r in records:
        counts[r["category"]] = counts.get(r["category"], 0) + 1

    meta = {
        "updatedAt": ts,
        "generator": "youtube-api",
        "total": len(records),
        "counts": counts,
    }

    print(f"수집 {len(records)}개 / 제외 {skipped}개 / 필터 제외 {skipped_filter}개 / 신규 "
          f"{sum(1 for r in records if r['addedAt'] == ts)}개")
    print("카테고리:", json.dumps(counts, ensure_ascii=False))

    if args.dry_run:
        print("[dry-run] 파일 미기록")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "videos.json").write_text(
        json.dumps({"videos": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"기록 완료 -> {out_dir/'videos.json'}, {out_dir/'meta.json'}")


if __name__ == "__main__":
    main()
