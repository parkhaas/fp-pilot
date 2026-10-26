#!/usr/bin/env python3
"""
FLOVER-FLIX SBS 인기가요 '현장포토' 수집기 (사진 원본 URL + 썸네일)

SBS 게시판(visualboards/54795)이 쓰는 공개 목록 API 를 그대로 호출한다.
 - 목록 응답의 본문(CONTENT)에 원본 이미지 URL 이 이미 들어 있어 상세 페이지를 따로 열지 않는다.
 - "더보기" = offset 을 15씩 올리는 호출. 최신순이라 증분 실행은 새 게시물이 없는 페이지에서 멈춘다.
 - 원본은 저장하지 않고 URL 만 보관한다. 저장소에는 작은 썸네일(WebP)만 둔다.

재탐색 방지:
 - data/photos.json 에 이미 있는 게시물은 건드리지 않는다(이미지 다운로드·썸네일 생성 없음).
 - 증분 실행은 목록에서 '이미 아는 게시물만' 나온 페이지에서 페이징을 중단한다.
 - 전체 재조회(--full)는 삭제된 게시물 정리용이며, 그때도 이미 처리한 이미지는 다시 받지 않는다.
 - 이전 실행에서 못 끝낸 이미지(todo)만 다음 실행에서 이어서 처리한다.

사용:
    pip install pillow
    python crawlers/collect_sbs_photos.py --out data                 # 증분 (정기 실행)
    python crawlers/collect_sbs_photos.py --out data --full          # 전체 재조회 + 삭제분 정리
    python crawlers/collect_sbs_photos.py --out data --dry-run       # 목록만 보고 쓰지 않음
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.board.sbs.co.kr/bbs/V2.0/basic/board/lists"
BOARD_CODE = "inkigayo_pt01"
BOARD_URL = "https://programs.sbs.co.kr/enter/gayo/visualboards/54795"
REFERER = "https://programs.sbs.co.kr/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
IMG_RX = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
JSONP_RX = re.compile(r"^\s*[A-Za-z_$][\w$]*\((.*)\)\s*;?\s*$", re.S)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_get(url: str, timeout: int = 60, retries: int = 3) -> bytes:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": REFERER})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"요청 실패: {url[:110]} ({last})")


def fetch_page(offset: int, keyword: str) -> list[dict]:
    q = urllib.parse.urlencode({
        "board_code": BOARD_CODE, "offset": offset, "limit": 15, "action_type": "callback",
        "searchOption": "title", "searchKeyword": keyword, "callback": "cb",
    })
    text = http_get(f"{API}?{q}").decode("utf-8")
    m = JSONP_RX.match(text)
    if not m:
        raise RuntimeError("목록 응답 형식을 해석하지 못했습니다(JSONP 아님).")
    return json.loads(m.group(1)).get("list") or []


def parse_post(raw: dict) -> dict:
    urls: list[str] = []
    for m in IMG_RX.finditer(raw.get("CONTENT") or ""):
        u = html.unescape(m.group(1)).strip()
        if u.startswith("//"):
            u = "https:" + u
        if u.startswith("http") and u not in urls:
            urls.append(u)
    return {
        "no": int(raw["NO"]),
        "title": html.unescape(raw.get("TITLE") or "").strip(),
        "date": (raw.get("REG_DATE") or "")[:10],
        "urls": urls,
    }


def make_thumb(url: str, out_dir: Path, width: int, quality: int) -> dict:
    from PIL import Image, ImageOps  # 지연 import (--dry-run 에는 불필요)

    rel = f"photos/{hashlib.sha1(url.encode()).hexdigest()[:16]}.webp"
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(http_get(url))))
    ow, oh = im.size
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if ow > width:
        im = im.resize((width, max(1, round(oh * width / ow))), Image.LANCZOS)
    path = out_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=quality, method=4)
    return {"u": url, "t": rel, "w": ow, "h": oh}


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser(description="SBS 인기가요 현장포토 수집기")
    ap.add_argument("--out", default="data")
    ap.add_argument("--keyword", default="프로미스나인", help="제목 검색어")
    ap.add_argument("--full", action="store_true", help="목록 전체 재조회 + 삭제된 게시물 정리")
    ap.add_argument("--max-pages", type=int, default=100, help="목록 페이지 상한(15건/페이지)")
    ap.add_argument("--max-new-images", type=int, default=400,
                    help="한 번에 새로 처리할 이미지 상한(남은 건 다음 실행에서 이어서)")
    ap.add_argument("--thumb-width", type=int, default=480)
    ap.add_argument("--quality", type=int, default=72)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    data_path = out / "photos.json"
    old = json.loads(data_path.read_text(encoding="utf-8")) if data_path.exists() else {}
    stored = {p["no"]: p for p in old.get("posts", [])}
    img_index = {im["u"]: im for p in stored.values() for im in p.get("images", [])}
    print(f"기존 게시물 {len(stored)}개 / 이미지 {len(img_index)}개")

    # 1) 목록 조회 — 증분은 '아는 게시물만' 나온 페이지에서 중단
    listed: dict[int, dict] = {}
    new_nos: list[int] = []
    offset = pages = 0
    while pages < args.max_pages:
        raw_list = fetch_page(offset, args.keyword)
        pages += 1
        if not raw_list:
            break
        offset += len(raw_list)
        unknown_in_page = 0
        for raw in raw_list:
            if raw.get("DELETED") == "Y":
                continue
            p = parse_post(raw)
            listed[p["no"]] = p
            if p["no"] not in stored:
                unknown_in_page += 1
                new_nos.append(p["no"])
        if not args.full and unknown_in_page == 0:
            break
        time.sleep(0.5)
    print(f"목록 {pages}쪽 조회 → 새 게시물 {len(new_nos)}개"
          f"{' (전체 재조회)' if args.full else ''}")

    # 2) 처리할 이미지: 새 게시물 + 이전에 못 끝낸(todo) 게시물만. 이미 처리한 게시물은 건드리지 않는다.
    work_posts: dict[int, dict] = {no: listed[no] for no in new_nos}
    for no, p in stored.items():
        if p.get("todo"):
            work_posts[no] = {"no": no, "title": p["title"], "date": p["date"],
                              "urls": [im["u"] for im in p["images"]] + p["todo"]}
    tasks: list[tuple[int, str]] = []
    for no, p in work_posts.items():
        for u in p["urls"]:
            if u not in img_index and (no, u) not in tasks:
                tasks.append((no, u))
    reuse = sum(1 for p in work_posts.values() for u in p["urls"] if u in img_index)
    todo_n = len(tasks)
    tasks = tasks[: args.max_new_images]
    print(f"이미지: 새로 처리 {len(tasks)}개 (대기 {todo_n - len(tasks)}개), 기존 재사용 {reuse}개")

    if args.dry_run:
        print("[dry-run] 파일 미기록")
        return

    def run(t: tuple[int, str]):
        time.sleep(0.15)
        try:
            return t, make_thumb(t[1], out, args.thumb_width, args.quality), None
        except Exception as e:  # noqa: BLE001
            return t, None, e

    failed = 0
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for (no, u), entry, err in ex.map(run, tasks):
            done += 1
            if entry:
                img_index[u] = entry
            else:
                failed += 1
                print(f"  [실패] 게시물 {no} {u[-40:]}: {err}", file=sys.stderr)
            if done % 50 == 0:
                print(f"  진행 {done}/{len(tasks)}")

    # 3) 게시물 조립 (원본 순서 유지, 못 끝낸 이미지는 todo 로 남겨 다음 실행에서 이어감)
    posts: dict[int, dict] = {no: dict(p) for no, p in stored.items()}
    for no, p in work_posts.items():
        imgs = [img_index[u] for u in p["urls"] if u in img_index]
        todo = [u for u in p["urls"] if u not in img_index]
        entry = {"no": no, "title": p["title"], "date": p["date"], "images": imgs}
        if todo:
            entry["todo"] = todo
        if imgs or todo:
            posts[no] = entry

    # 4) 전체 재조회일 때만: SBS 에서 사라진 게시물 정리 (목록이 비정상적으로 줄었으면 중단)
    if args.full:
        gone = [no for no in posts if no not in listed]
        if gone and len(listed) >= len(posts) * 0.5:
            for no in gone:
                del posts[no]
            print(f"삭제된 게시물 정리: {len(gone)}개")
        elif gone:
            print(f"[경고] 목록이 절반 미만이라 정리를 건너뜀 ({len(listed)}/{len(posts)})", file=sys.stderr)
        keep = {im["t"] for p in posts.values() for im in p["images"]}
        removed = 0
        for f in (out / "photos").glob("*.webp"):
            if f"photos/{f.name}" not in keep:
                f.unlink()
                removed += 1
        if removed:
            print(f"참조 없는 썸네일 삭제: {removed}개")

    ordered = sorted(posts.values(), key=lambda p: (p["date"], p["no"]), reverse=True)
    body = {"board": BOARD_URL, "posts": ordered}
    if json.dumps(body, ensure_ascii=False, sort_keys=True) == json.dumps(
            {"board": old.get("board"), "posts": old.get("posts", [])}, ensure_ascii=False, sort_keys=True):
        print("변경 없음 — 파일 미기록")
        return

    out.mkdir(parents=True, exist_ok=True)
    payload = {"updatedAt": now_iso(), **body}
    tmp = data_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(data_path)
    total_imgs = sum(len(p["images"]) for p in ordered)
    pending = sum(len(p.get("todo", [])) for p in ordered)
    print(f"기록 완료: 게시물 {len(ordered)}개 / 이미지 {total_imgs}개 / 대기 {pending}개 / 실패 {failed}개")


if __name__ == "__main__":
    main()
