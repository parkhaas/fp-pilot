base = "C:/Users/accur_twh0pu2/workspace/fp-pilot/tools/discography/"


def load(p):
    s = open(p, encoding="utf-8", newline="").read()
    return s.replace("\r\n", "\n"), "\r\n" in s


def save(p, s, crlf):
    if crlf:
        s = s.replace("\n", "\r\n")
    open(p, "w", encoding="utf-8", newline="").write(s)


def rep(s, a, b):
    assert a in s, a[:80]
    return s.replace(a, b, 1)


# ---------------- group-cards.js ----------------
p = base + "lib/group-cards.js"
s, c = load(p)

# 1) logoGallery: 로고 목록 기준, 메모 없음, 제목은 "로고"
a = s.index("  // 앨범 목록을 기준(없으면 로고 목록)으로")
b = s.index("  const out =\n    `<h3>음반과 로고</h3>`")
new_mid = '''  // 로고 목록 순서대로. 종류·발매일은 음반 표에서 같은 앨범을 찾아 붙인다(메모는 음반 소절에서 보여 준다)
  const infoById = new Map((albums || []).map((r) => [r.albumId, r]));
  const cards = logos.items
    .map((it) => {
      const id = (albumIdFor && albumIdFor(it.label)) || "";
      const info = (id && infoById.get(id)) || {};
      const label = txt(it.label).replace(/[(][(]([^)]*)[)][)]/g, "($1)");
      const tile = `<img src="data/discography/${it.files[0].file}" alt="${esc(label)} 로고" loading="lazy" decoding="async">`;
      const body = `<span class="dg-logo-img">${tile}</span><b>${esc(label)}</b><i>${esc([info.kind, info.date].filter(Boolean).join(" · "))}</i>`;
      return id
        ? `<a class="dg-logo-card" href="?view=discography&album=${encodeURIComponent(id)}" data-album="${esc(id)}">${body}</a>`
        : `<div class="dg-logo-card">${body}</div>`;
    })
    .join("");
'''
s = s[:a] + new_mid + s[b:]
s = rep(s, "    `<h3>음반과 로고</h3>` +", "    `<h3>로고</h3>` +")
s = rep(s, "    `<p class=\"dg-fold-label\">발매 순서 · 앨범마다 쓴 로고와 그때의 변화</p>` +", "    `<p class=\"dg-fold-label\">역대 활동별 로고</p>` +")

# 2) 음반 카드
s = rep(
    s,
    "/* ---------- 뮤직비디오 ---------- */",
    '''/* ---------- 음반 ---------- */
// 음반 표를 발매 순서의 커버 카드로. 데뷔·체제 변화·소속사 이적 같은 메모는 칩으로 붙인다.
function albumCards(albums, albumIdFor, coverFor) {
  const cards = albums
    .map((r) => {
      const id = r.albumId || (albumIdFor && albumIdFor(r.label)) || "";
      const cover = id && coverFor ? coverFor(id) : "";
      const label = txt(r.label).replace(/[(][(]([^)]*)[)][)]/g, "($1)");
      const notes = r.notes.length ? `<span class="dg-logo-notes">${r.notes.map((n) => `<em>${esc(n)}</em>`).join("")}</span>` : "";
      const body =
        `<span class="dg-album-cover">${cover ? `<img src="data/discography/${cover}" alt="${esc(label)} 앨범 커버" loading="lazy" decoding="async">` : ""}</span>` +
        `<b>${esc(label)}</b><i>${esc([r.kind, r.date].filter(Boolean).join(" · "))}</i>${notes}`;
      const cls = "dg-album-card" + (r.notes.length ? " has-note" : "");
      return id
        ? `<a class="${cls}" href="?view=discography&album=${encodeURIComponent(id)}" data-album="${esc(id)}">${body}</a>`
        : `<div class="${cls}">${body}</div>`;
    })
    .join("");
  return `<p class="dg-fold-label">발매 순서 · 분홍 카드는 그룹에 변화가 있었던 때</p><div class="dg-albums">${cards}</div>`;
}

/* ---------- 뮤직비디오 ---------- */''',
)
s = rep(s, "module.exports = { logoGallery, parseAlbumTable, mvCards, activityCards };", "module.exports = { logoGallery, albumCards, parseAlbumTable, mvCards, activityCards };")
save(p, s, c)

# ---------------- build.js ----------------
p = base + "build.js"
s, c = load(p)
s = rep(s, "const { logoGallery, parseAlbumTable, mvCards, activityCards }", "const { logoGallery, albumCards, parseAlbumTable, mvCards, activityCards }")
s = rep(s, '      if (d.kind === "group" && s.title === "음반" && groupAlbums && groupAlbums.length) continue;\n', "")
a = '        if (s.title === "특징") html = logoGallery('
assert a in s
s = rep(
    s,
    '        if (s.title === "음반" && false) {}',
    "",
) if '        if (s.title === "음반" && false) {}' in s else s
s = rep(
    s,
    a,
    '        if (s.title === "음반" && groupAlbums && groupAlbums.length) html = albumCards(groupAlbums, (label) => LINKS.albums[norm(label)], coverFor);\n' + a,
)
save(p, s, c)
print("ok")
