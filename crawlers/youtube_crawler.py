#!/usr/bin/env python3
"""
FROMIS-FLIX 데이터 수집기 — YouTube Data API v3 (공식 API 우선, 표준 라이브러리만 사용)

사용법:
    export YOUTUBE_API_KEY="..."      # 또는 --api-key 로 전달
    python crawlers/youtube_crawler.py --config crawlers/sources.json --out data

동작:
    1) sources.json 의 handle -> channelId -> uploads 재생목록 해석
    2) uploads + 지정 재생목록 + extraChannels 재생목록의 영상 수집
    3) videos.list 로 길이/공개여부/임베드 가능여부 확인
    4) 카테고리 분류(재생목록 지정값 우선, uploads 는 키워드/길이 휴리스틱)
    5) data/members.json 별칭으로 제목·설명에서 멤버 추정
    6) 기존 data/videos.json 과 병합(addedAt 보존), data/meta.json 갱신

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


def collect_playlist(playlist_id: str, api_key: str, cap: int,
                     filter_kw: list[str] | None = None) -> list[str]:
    """재생목록의 videoId 목록. filter_kw 가 있으면 제목에 그 키워드 중 하나라도
    포함된 항목만 남긴다(대소문자 무시, OR 조건). 외부 채널의 큰 재생목록에서
    특정 그룹/멤버 영상만 골라낼 때 사용."""
    raw = paginate(
        "playlistItems",
        {"part": "contentDetails,snippet", "playlistId": playlist_id},
        api_key,
        cap,
    )
    kw = [k.lower() for k in (filter_kw or [])]
    out = []
    for it in raw:
        vid = it.get("contentDetails", {}).get("videoId")
        if not vid:
            continue
        if kw:
            title = (it.get("snippet", {}).get("title") or "").lower()
            if not any(k in title for k in kw):
                continue
        out.append(vid)
    return out


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

    # 1) 소스 목록 구성
    _, uploads_playlist = resolve_channel(cfg, args.api_key)
    # (playlistId, category, defaultMembers, filterKeywords)
    tasks: list[tuple[str, str, list, list]] = []
    if cfg.get("includeUploads", True):
        tasks.append((uploads_playlist, cfg.get("uploadsCategory", "auto"), [], []))
    for pl in cfg.get("playlists", []):
        if pl.get("id"):
            tasks.append((pl["id"], pl.get("category", "auto"),
                          pl.get("members", []), pl.get("filterKeywords", [])))
    for ex in cfg.get("extraChannels", []):
        if ex.get("playlistId"):
            tasks.append((ex["playlistId"], ex.get("category", "auto"),
                          ex.get("members", []), ex.get("filterKeywords", [])))

    # 2) 수집 (뒤에 오는 소스의 category/members 가 우선)
    hint_by_id: dict[str, tuple[str, list]] = {}
    for playlist_id, category, def_members, filter_kw in tasks:
        try:
            for vid in collect_playlist(playlist_id, args.api_key, cap, filter_kw):
                hint_by_id[vid] = (category, def_members)
        except RuntimeError as e:
            print(f"[경고] 재생목록 {playlist_id} 건너뜀: {e}", file=sys.stderr)

    if not hint_by_id:
        sys.exit("[중단] 수집된 영상이 없습니다. sources.json 을 확인하세요.")

    # 3) 상세 조회
    details = fetch_details(list(hint_by_id), args.api_key)

    # 4) 레코드 구성
    ts = now_iso()
    records: list[dict] = []
    skipped = 0
    for vid, (hint, def_members) in hint_by_id.items():
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

    print(f"수집 {len(records)}개 / 제외 {skipped}개 / 신규 "
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
