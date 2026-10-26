"""나눔스퀘어라운드가 실제로 그리는 한글 음절만 unicode-range 로 지정한 @font-face 스타일시트를 만든다.
이 폰트는 일부 희귀 음절을 '글자는 있지만 윤곽이 없는(빈)' 글리프로 가지고 있어서, 브라우저가 다음 폰트로
넘어가지 못하고 빈칸을 그린다. 지원하는 음절만 range 에 넣으면 나머지는 자동으로 다음 폰트(Pretendard)로 넘어간다.
"""
import io
import sys
import urllib.request

from fontTools.ttLib import TTFont

BASE = "https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareRound/"
WEIGHTS = {400: "NanumSquareRoundR.woff", 700: "NanumSquareRoundB.woff", 800: "NanumSquareRoundEB.woff"}
HANGUL = range(0xAC00, 0xD7A4)


def fetch(name: str) -> bytes:
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def drawable_hangul(font: TTFont) -> set[int]:
    cmap = font.getBestCmap()
    glyf = font["glyf"]
    ok = set()
    for cp in HANGUL:
        name = cmap.get(cp)
        if name is None:
            continue  # cmap 에 없으면 브라우저가 알아서 다음 폰트로 넘어간다
        g = glyf[name]
        if g.numberOfContours != 0:  # 0 = 빈 글리프, -1 = 합성 글리프(비어 있지 않음)
            ok.add(cp)
    return ok


def to_ranges(cps: list[int]) -> str:
    out, s, p = [], None, None
    for cp in cps:
        if s is None:
            s = p = cp
        elif cp == p + 1:
            p = cp
        else:
            out.append((s, p))
            s = p = cp
    if s is not None:
        out.append((s, p))
    return ",".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in out)


def main() -> None:
    sets = {}
    for w, name in WEIGHTS.items():
        f = TTFont(io.BytesIO(fetch(name)))
        sets[w] = drawable_hangul(f)
        print(f"weight {w}: 그려지는 음절 {len(sets[w])}개", file=sys.stderr)
    common = sorted(set.intersection(*sets.values()))
    print(f"모든 굵기 공통: {len(common)}개", file=sys.stderr)

    # 한글 외 글자는 기본 라틴·숫자·문장부호·한글 호환 자모만 이 폰트로 그린다 (나머지는 Pretendard)
    latin = "U+20-7E,U+A0-FF,U+2010-2027,U+2030-205E,U+20A9,U+2190-2193,U+25A0-25CF,U+3000-303F,U+3131-318E,U+FF01-FF5E"
    rng = latin + "," + to_ranges(common)

    css = "/* 자동 생성: tools/gen_nanum_round.py — 나눔스퀘어라운드가 실제로 그리는 글자만 담당한다. 나머지는 Pretendard 로 넘어간다. */\n"
    for w, name in WEIGHTS.items():
        css += (
            f'@font-face {{ font-family: "NanumSquareRound"; font-weight: {w}; font-style: normal; font-display: swap;\n'
            f'  src: url("{BASE}{name}") format("woff");\n'
            f"  unicode-range: {rng}; }}\n"
        )
    out = sys.argv[1] if len(sys.argv) > 1 else "assets/css/nanum-round.css"
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(css)
    print(f"wrote {out}: {len(css):,} bytes, range {len(rng):,} chars", file=sys.stderr)


if __name__ == "__main__":
    main()
