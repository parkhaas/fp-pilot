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

Shorts 판정 (길이로 판정하지 않음):
  - 신호 #1: 영상 URL 이 /shorts/ 형태 (= YouTube 가 Shorts 로 분류) → shorts.
            sources.json 의 shortsChannels[] 로 채널 /shorts 탭을 통째로 수집.
  - --shorts-aspect: shorts 아닌 3분 이내 후보를 (a) youtube.com/shorts/<id> 리다이렉트로
            확인(200=Shorts) → 재분류, (b) 남은 것 중 세로(height>width) → 재분류.
            (세로직캠은 3분↑ 이라 후보 아님. (b)는 영상별 조회라 느림)
  - 참고: yt-dlp/API 키워드·해시태그 검색은 Shorts 를 결과로 돌려주지 않음(테스트 확인).
          그래서 Shorts 는 채널 /shorts 탭이 유일한 확실한 소스.

주의:
  - search[] 는 "채널 내 검색" 탭( youtube.com/channel/<ID>/search?query= )을 flat 추출합니다.
    flat 모드엔 description 이 없어 textAny/textAll 은 제목 기준으로만 검사됩니다.
  - GitHub Actions IP 에서는 yt-dlp 가 봇 차단을 자주 맞습니다. 정기 수집은
    youtube_crawler.py(API) 를 쓰고, 이 스크립트는 로컬 백필용으로 쓰세요.
  - 기존 data/videos.json 과 병합합니다(addedAt 보존). API 데이터 위에 얹혀도 됩니다.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
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

SHORT_MAX_SEC = 180  # Shorts 판정 시 최대 길이(3분). 세로직캠(3분↑)은 Shorts 아님.


def is_short_url(entry: dict) -> bool:
    """신호 #1 — YouTube 가 이 영상을 Shorts 로 분류(URL 이 /shorts/ 형태)."""
    return "/shorts/" in (entry.get("url") or entry.get("webpage_url") or "")


_NO_REDIRECT = urllib.request.build_opener(type(
    "NR", (urllib.request.HTTPRedirectHandler,),
    {"redirect_request": lambda *a, **k: None})())


def probe_is_short(vid: str) -> bool:
    """신호 #2 — youtube.com/shorts/<id> 가 200(유지)이면 Shorts, 303(→/watch)이면 아님.
    검색으로 모은 임의 채널 영상에 쓴다(API·yt-dlp flat 로는 Shorts 여부를 못 주므로)."""
    req = urllib.request.Request(f"https://www.youtube.com/shorts/{vid}", method="HEAD",
                                 headers={"User-Agent": "Mozilla/5.0"})
    try:
        with _NO_REDIRECT.open(req, timeout=10) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        return e.code == 200
    except Exception:  # noqa: BLE001
        return False


def probe_shorts(ids: list[str]) -> set[str]:
    out: set[str] = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for vid, ok in zip(ids, ex.map(probe_is_short, ids)):
            if ok:
                out.add(vid)
    print(f"  /shorts/ 확인: {len(ids)}개 중 {len(out)}개가 Shorts")
    return out


def classify(title: str, rules: dict) -> str:
    t = (title or "").lower()
    if any(k in t for k in rules.get("shorts", [])):  # 제목에 #shorts
        return "shorts"
    for cat in ("stage_fancam", "music_show", "mv_teaser", "self_content"):
        if any(k in t for k in rules.get(cat, [])):
            return cat
    return "variety_external"


def fetch_portrait_ids(ids: list[str]) -> set[str]:
    """신호 #3 — 세로(portrait) 비율인 영상 id 집합. 영상별 상세 1회씩 조회(느림).
    호출부에서 '길이 3분 이내' 후보로만 좁혀서 넘길 것."""
    portrait: set[str] = set()
    for i in range(0, len(ids), 40):
        chunk = ids[i:i + 40]
        cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--no-warnings",
               "--ignore-errors", "--print", "%(id)s\t%(width)s\t%(height)s"]
        cmd += [f"https://www.youtube.com/watch?v={v}" for v in chunk]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True,
                                 encoding="utf-8", timeout=600)
        except subprocess.TimeoutExpired:
            continue
        for line in (out.stdout or "").splitlines():
            parts = line.strip().split("\t")
            if len(parts) == 3:
                vid, w, h = parts
                try:
                    if int(h) > int(w):
                        portrait.add(vid)
                except ValueError:
                    pass
        print(f"  세로비율 확인: {i + len(chunk)}/{len(ids)}")
    return portrait


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
    ap.add_argument("--only", choices=["all", "search", "playlists", "shorts"], default="all")
    ap.add_argument("--shorts-aspect", action="store_true",
                    help="신호 #3: 3분 이내 후보를 영상별로 조회해 세로비율이면 shorts 로 재분류 (느림)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_json(Path(args.config), {})
    out_dir = Path(args.out)
    members = load_json(out_dir / "members.json", {"members": []}).get("members", [])
    existing = load_json(out_dir / "videos.json", {"videos": []}).get("videos", [])
    existing_by_id = {v["videoId"]: v for v in existing if v.get("videoId")}

    rules = cfg.get("keywordRules", {})
    pl_cap = int(cfg.get("maxPerPlaylist", 800))
    default_filter = cfg.get("defaultFilter", {})
    ts = now_iso()

    do_pl = args.only in ("all", "playlists")
    do_search = args.only in ("all", "search")
    do_shorts = args.only in ("all", "shorts")

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

    # 2.5) shortsChannels — 채널 /shorts 탭 = YouTube 가 Shorts 로 분류한 것(신호 #1)
    if do_shorts:
        for sc in cfg.get("shortsChannels", []):
            ref = (sc.get("handle") or sc.get("channelId") or "").strip()
            if not ref:
                continue
            if ref.startswith("UC") and len(ref) == 24:
                url = f"https://www.youtube.com/channel/{ref}/shorts"
            else:
                url = f"https://www.youtube.com/@{ref.lstrip('@')}/shorts"
            fspec = sc.get("filter") or shorthand(sc.get("filterKeywords"))
            ents = ytdlp_flat(url, int(sc.get("cap", 2000)))
            for e in ents:
                take(e, sc.get("category", "shorts"), sc.get("members", []), fspec, overwrite=True)
            print(f"쇼츠 탭 [{ref}]: {len(ents)}개")

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
        if is_short_url(e):                       # 신호 #1: YouTube 분류가 Shorts
            category = "shorts"
        elif hint and hint != "auto":
            category = hint
        else:
            category = classify(title, rules)
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

    # 3.5) --shorts-aspect (opt-in): shorts 아닌 3분 이내 후보를
    #   (a) youtube.com/shorts/<id> 리다이렉트로 확인(신호 #2, 빠름) → Shorts 면 재분류
    #   (b) 남은 것 중 세로비율(신호 #3) → 재분류. (세로직캠은 3분↑ 이라 후보 아님)
    if args.shorts_aspect:
        cands = [r for r in records
                 if r["category"] != "shorts"
                 and 0 < dur_seconds(r.get("duration")) <= SHORT_MAX_SEC]
        print(f"Shorts 재확인 대상: {len(cands)}개 (3분 이내, shorts 아님)")
        ids = [r["videoId"] for r in cands]
        by_probe = probe_shorts(ids)
        rest = [v for v in ids if v not in by_probe]
        by_aspect = fetch_portrait_ids(rest) if rest else set()
        promote = by_probe | by_aspect
        moved = 0
        for r in records:
            if r["videoId"] in promote and r["category"] != "shorts":
                r["category"] = "shorts"
                moved += 1
        print(f"→ shorts 재분류: {moved}개 (리다이렉트 {len(by_probe)} + 세로비율 {len(by_aspect)})")

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
