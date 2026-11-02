#!/usr/bin/env python3
"""
FLOVER-FLIX 신규 소스 탐지기 — "발견만 하고 등록은 사람이 승인"

  1) 새 재생목록: 이미 추적 중인 채널(메인 + extraChannels)의 재생목록 중 sources.json 에 없는 것
  2) 새 채널 후보: '프로미스나인' 등 키워드 검색(채널 제한 없음) 결과에서 추적 중이 아닌 채널

결과는 data/discoveries.json 에 누적되고, 이번 실행에서 처음 발견된 항목만
--report 파일(마크다운)로 써서 워크플로가 GitHub 이슈로 올립니다. 영상 데이터(videos.json)는 건드리지 않습니다.

사용법:
    export YOUTUBE_API_KEY=...
    python crawlers/discover.py --config crawlers/sources.json --out data \
        [--playlists-only] [--since 2026-10-01] [--report report.md]

쿼터: 재생목록 탐지 수 유닛, 채널 탐지는 검색어당 ~100 유닛 (주 1회 권장 → 워크플로 참고).

sources.json 의 "discovery" 블록(선택):
    {
      "queries": ["프로미스나인", "fromis_9"],   # 채널 탐지 검색어
      "maxPerQuery": 50,                          # 검색어당 최대 결과(50 단위)
      "minVideos": 2,                             # 후보로 올릴 최소 관련 영상 수
      "ignoreChannels": ["UC..."],                # 후보에서 영구 제외할 channelId
      "ignorePlaylists": ["PL..."]                # 새 재생목록 알림에서 영구 제외
    }
승인 방법: 후보를 등록하려면 sources.json 의 extraChannels 에 {handle|playlistId, category, label} 추가,
무시하려면 위 ignore* 에 ID 추가.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import youtube_crawler as yc  # noqa: E402


def uploads_to_channel(pl_id: str) -> str | None:
    return "UC" + pl_id[2:] if pl_id.startswith("UU") and len(pl_id) == 24 else None


def playlists_to_channels(ids: list[str], key: str) -> dict[str, str]:
    """재생목록 ID -> 소유 channelId (50개씩 1유닛)."""
    out: dict[str, str] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        data = yc.api_get("playlists", {"part": "snippet", "id": ",".join(chunk), "maxResults": 50}, key)
        for it in data.get("items", []):
            out[it["id"]] = it["snippet"]["channelId"]
    return out


def tracked(cfg: dict, key: str) -> tuple[set[str], set[str]]:
    """(추적 중인 channelId 집합, 추적 중인 playlistId 집합)"""
    cids: set[str] = set()
    pids: set[str] = set()
    if cfg.get("channelId"):
        cids.add(cfg["channelId"])
    elif cfg.get("handle"):
        c = yc.resolve_channel_id(cfg["handle"], key)
        if c:
            cids.add(c)
    unresolved: list[str] = []
    for p in cfg.get("playlists", []):
        if p.get("id"):
            pids.add(p["id"])
            unresolved.append(p["id"])
    for ex in cfg.get("extraChannels", []):
        if ex.get("handle") and not ex.get("playlistId"):
            c = yc.resolve_channel_id(ex["handle"], key)
            if c:
                cids.add(c)
                pids.add("UU" + c[2:])
        pid = ex.get("playlistId")
        if pid:
            pids.add(pid)
            c = uploads_to_channel(pid)
            if c:
                cids.add(c)
            else:
                unresolved.append(pid)
    # 일반 재생목록(PL..)의 소유 채널도 '이미 아는 채널'로 취급
    try:
        cids.update(playlists_to_channels(unresolved, key).values())
    except RuntimeError as e:
        print(f"[경고] 재생목록 소유 채널 해석 실패: {e}", file=sys.stderr)
    for s in cfg.get("search", []):
        cids.update(c for c in (s.get("channelIds") or []) if c)
        for h in s.get("channels") or []:
            c = yc.resolve_channel_id(h, key)
            if c:
                cids.add(c)
    for s in cfg.get("shortsChannels", []):
        if s.get("handle"):
            c = yc.resolve_channel_id(s["handle"], key)
            if c:
                cids.add(c)
    return cids, pids


def discover_playlists(cfg: dict, key: str, known_pids: set[str], ignore: set[str]) -> list[dict]:
    """추적 채널(메인 + extraChannels 전체채널)의 재생목록 중 미등록 항목."""
    channels: dict[str, str] = {}
    if cfg.get("channelId"):
        channels[cfg["channelId"]] = cfg.get("handle", "")
    for ex in cfg.get("extraChannels", []):
        c = uploads_to_channel(ex.get("playlistId", "")) if ex.get("playlistId") else None
        if not c and ex.get("handle"):
            c = yc.resolve_channel_id(ex["handle"], key)
        if c:
            channels[c] = ex.get("handle") or ex.get("label", "")
    found: list[dict] = []
    for cid, name in channels.items():
        try:
            items = yc.paginate("playlists", {"part": "snippet,contentDetails", "channelId": cid}, key, 200)
        except RuntimeError as e:
            print(f"[경고] {name or cid} 재생목록 조회 실패: {e}", file=sys.stderr)
            continue
        for it in items:
            pid = it["id"]
            if pid in known_pids or pid in ignore or it.get("contentDetails", {}).get("itemCount", 0) == 0:
                continue
            found.append({
                "kind": "playlist",
                "playlistId": pid,
                "title": it["snippet"].get("title", ""),
                "channelId": cid,
                "channel": it["snippet"].get("channelTitle", name),
                "itemCount": it["contentDetails"].get("itemCount", 0),
                "url": f"https://www.youtube.com/playlist?list={pid}",
            })
    print(f"새 재생목록 후보: {len(found)}개 (대상 채널 {len(channels)}개)")
    return found


def discover_channels(cfg: dict, key: str, known_cids: set[str], ignore: set[str], after: str) -> list[dict]:
    dc = cfg.get("discovery", {})
    queries = dc.get("queries") or ["프로미스나인", "fromis_9"]
    per = int(dc.get("maxPerQuery", 50))
    min_videos = int(dc.get("minVideos", 2))
    flt = cfg.get("defaultFilter", {})
    agg: dict[str, dict] = {}
    for q in queries:
        got, token = 0, None
        while got < per:
            p = {"part": "snippet", "type": "video", "q": q, "order": "date", "maxResults": min(50, per - got)}
            if after:
                p["publishedAfter"] = after
            if token:
                p["pageToken"] = token
            data = yc.api_get("search", p, key)
            for it in data.get("items", []):
                got += 1
                sn = it.get("snippet", {})
                cid = sn.get("channelId")
                vid = it.get("id", {}).get("videoId")
                if not cid or not vid or cid in known_cids or cid in ignore:
                    continue
                if not yc.apply_filter(it, flt):
                    continue
                e = agg.setdefault(cid, {"kind": "channel", "channelId": cid,
                                         "channel": sn.get("channelTitle", ""), "videos": {}})
                e["videos"][vid] = sn.get("title", "")
            token = data.get("nextPageToken")
            if not token:
                break
    found = []
    for cid, e in agg.items():
        if len(e["videos"]) < min_videos:
            continue
        titles = list(e["videos"].values())
        found.append({
            "kind": "channel", "channelId": cid, "channel": e["channel"],
            "videoCount": len(titles), "sample": titles[:3],
            "url": f"https://www.youtube.com/channel/{cid}",
        })
    found.sort(key=lambda x: -x["videoCount"])
    print(f"새 채널 후보: {len(found)}개")
    return found


def render_report(new: list[dict]) -> str:
    if not new:
        return ""
    lines = ["새로 발견된 YouTube 소스입니다. **등록은 자동으로 하지 않습니다** — 아래 방법으로 승인/무시해 주세요.\n"]
    pls = [x for x in new if x["kind"] == "playlist"]
    chs = [x for x in new if x["kind"] == "channel"]
    if pls:
        lines.append("## 새 재생목록\n")
        for x in pls:
            lines.append(f"- [{x['title']}]({x['url']}) — {x['channel']}, {x['itemCount']}개 · `{x['playlistId']}`")
        lines.append("")
    if chs:
        lines.append("## 새 채널 후보\n")
        for x in chs:
            lines.append(f"- [{x['channel']}]({x['url']}) — 관련 영상 {x['videoCount']}개 · `{x['channelId']}`")
            for t in x["sample"]:
                lines.append(f"  - {t}")
        lines.append("")
    lines += [
        "## 처리 방법",
        "- **등록**: `crawlers/sources.json` 의 `extraChannels` (또는 `playlists`)에 "
        "`{ \"handle\": \"@...\" 또는 \"playlistId\": \"...\", \"category\": \"...\", \"label\": \"...\" }` 추가. "
        "새 카테고리면 `assets/js/config.js` 의 `catLabels`/`nav` 에도 추가.",
        "- **무시**: `sources.json` 의 `discovery.ignoreChannels` / `discovery.ignorePlaylists` 에 ID 추가.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description="FLOVER-FLIX 신규 소스 탐지기")
    ap.add_argument("--config", default="crawlers/sources.json")
    ap.add_argument("--out", default="data")
    ap.add_argument("--api-key", default=os.environ.get("YOUTUBE_API_KEY", ""))
    ap.add_argument("--since", default="", help="채널 탐지 검색 시작일 (YYYY-MM-DD). 기본: 제한 없음")
    ap.add_argument("--playlists-only", action="store_true", help="채널 검색(쿼터 큼)은 건너뛰고 재생목록만 탐지")
    ap.add_argument("--report", default="", help="이번에 새로 발견된 항목의 마크다운 리포트 경로")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.api_key:
        sys.exit("[중단] YOUTUBE_API_KEY 환경변수 또는 --api-key 가 필요합니다.")

    cfg = yc.load_json(Path(args.config), {})
    dc = cfg.get("discovery", {})
    ign_ch, ign_pl = set(dc.get("ignoreChannels", [])), set(dc.get("ignorePlaylists", []))
    known_cids, known_pids = tracked(cfg, args.api_key)

    results = discover_playlists(cfg, args.api_key, known_pids, ign_pl)
    ran_channels = not args.playlists_only
    if ran_channels:
        after = args.since + "T00:00:00Z" if args.since and "T" not in args.since else args.since
        results += discover_channels(cfg, args.api_key, known_cids, ign_ch, after)

    # 누적 저장: 기존 항목은 firstSeen 유지, 이번 실행에서 처음 본 것만 new 로 취급
    path = Path(args.out) / "discoveries.json"
    prev = yc.load_json(path, {"items": []}).get("items", [])
    key = lambda x: x.get("playlistId") or x.get("channelId")  # noqa: E731
    prev_by = {key(x): x for x in prev}
    ts = yc.now_iso()
    current, new = [], []
    for x in results:
        old = prev_by.get(key(x))
        x["firstSeen"] = old["firstSeen"] if old else ts
        current.append(x)
        if not old:
            new.append(x)
    # 이번에 실행하지 않은 종류(채널 검색 생략 시)의 기존 항목은 유지, 실행한 종류에서 사라진(등록/무시된) 것은 제거
    ran = {"playlist"} | ({"channel"} if ran_channels else set())
    kept = [x for x in prev if x.get("kind") not in ran
            and key(x) not in ign_ch and key(x) not in ign_pl and key(x) not in known_cids and key(x) not in known_pids]
    items = current + kept

    print(f"탐지 결과: 누적 {len(items)}개 / 이번 신규 {len(new)}개 (쿼터 사용 ~{yc._units_used})")
    if args.dry_run:
        print("[dry-run] 파일 미기록")
        print(render_report(new))
        return
    Path(args.out).mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"updatedAt": ts, "items": items}, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    if args.report:
        Path(args.report).write_text(render_report(new), encoding="utf-8")


if __name__ == "__main__":
    main()
