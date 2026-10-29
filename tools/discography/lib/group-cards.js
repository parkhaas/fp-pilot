/* 그룹소개(프로미스나인 문서) 전용 변환: 밋밋한 표·글 덩어리를 카드로 바꾼다.
   build.js 의 docs 루프에서 그룹 문서의 소절 HTML 에 적용한다. cheerio 로 읽고 HTML 문자열을 돌려준다.
   - logoGallery : "로고" 소절 → 대표 로고 + 역대 활동별 로고 카드 격자
   - mvCards     : "뮤직비디오" 표(곡 정보·조회수·게시일·링크) → 조회수 막대가 있는 카드
   - activityCards : "활동" 소절 → 음악 방송 링크 카드 + 멤버 칩, 공연·행사 표 → 공연 카드 */
const cheerio = require("cheerio");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const txt = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/* ---------- 음반 + 로고 ---------- */
// "음반" 소절의 표(앨범명·종류·발매일·메모)를 [{ label, kind, date, notes[], albumId }] 로 읽는다.
function parseAlbumTable(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  const out = [];
  $("#r td").each((i, td) => {
    const lines = ($(td).html() || "").split(/<br\s*\/?>/).map((x) => txt(x)).filter(Boolean);
    const dateAt = lines.findIndex((l) => /^\d{4}\.\s*\d{1,2}/.test(l));
    if (dateAt < 1) return; // 앨범명·종류·발매일이 다 있는 칸만
    out.push({
      label: lines[0],
      kind: dateAt >= 2 ? lines[1] : "",
      date: lines[dateAt].replace(/\.$/, "").replace(/\s+/g, ""),
      notes: lines.slice(dateAt + 1).filter((l) => l !== "-"),
      albumId: $(td).find("a[data-album]").first().attr("data-album") || "",
    });
  });
  return out;
}

// html: "특징" 소절 전체. logos: source/group-logos.json. albums: parseAlbumTable 결과(없으면 로고 목록만).
// albumIdFor(label) → 앨범 id, coverFor(id) → 커버 상대 경로(없으면 "")
function logoGallery(html, logos, albumIdFor, albums, coverFor) {
  if (!logos || !logos.main) return html;
  const a = html.indexOf("<h3>로고</h3>");
  if (a < 0) return html;
  const b = html.indexOf("<h3>", a + 5);
  const block = html.slice(a, b < 0 ? html.length : b);
  const film = (block.match(/<p><a href="https:\/\/youtu[^"]*"[^>]*>[\s\S]*?<\/a><\/p>/) || [""])[0];
  const imgs = (m) =>
    `<img class="dg-logo-light" src="data/discography/${m.light}" alt="프로미스나인 로고" loading="lazy">` +
    (m.dark ? `<img class="dg-logo-dark" src="data/discography/${m.dark}" alt="" aria-hidden="true" loading="lazy">` : "");
  // 로고 목록 순서대로. 종류·발매일은 음반 표에서 같은 앨범을 찾아 붙인다(메모는 음반 소절에서 보여 준다)
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
  const out =
    `<h3>로고</h3>` +
    `<div class="dg-logo-main">${imgs(logos.main)}</div>` +
    film +
    `<p class="dg-fold-label">역대 활동별 로고</p>` +
    `<div class="dg-logo-grid">${cards}</div>`;
  return html.slice(0, a) + out + (b < 0 ? "" : html.slice(b));
}

/* ---------- 음반 ---------- */
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

/* ---------- 뮤직비디오 ---------- */
function mvCards(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $("#r table").each((i, t) => {
    const heads = $(t).find("thead th").toArray().map((x) => $(x).text().trim());
    if (heads[0] !== "곡 정보" || !heads.includes("조회수")) return;
    const rows = $(t).find("tbody tr").toArray().map((tr) => {
      const c = $(tr).children("td").toArray();
      const first = $(c[0]);
      const link = first.find("a").first();
      const [song, no] = txt(link.text()).split("｜");
      const albumLink = first.find("a").last();
      const lines = first.html().split(/<br\s*\/?>/).map((x) => txt(x)).filter(Boolean);
      const kind = lines.length > 2 ? lines[1] : "";
      const views = Number(txt($(c[1]).text()).replace(/[^0-9]/g, "")) || 0;
      const date = txt($(c[2]).text()).replace(/\.$/, "").replace(/\s+/g, "");
      const vids = $(c[3]).find("a").toArray().map((a) => $(a).attr("href"));
      return { song: song || txt(link.text()), no: no || "", kind, album: txt(albumLink.text()), albumId: albumLink.attr("data-album") || "", views, date, vids };
    });
    const max = Math.max(...rows.map((r) => r.views), 1);
    const cards = rows
      .map((r) => {
        const pct = Math.max(3, Math.round((r.views / max) * 100));
        const alb = r.albumId ? `<a href="?view=discography&album=${encodeURIComponent(r.albumId)}" data-album="${esc(r.albumId)}">${esc(r.album)}</a>` : esc(r.album);
        const vids = r.vids.map((v, k) => `<a class="dg-mv-play" href="${esc(v)}" target="_blank" rel="noopener noreferrer"><span>${k === 0 ? "MV" : "영상 " + (k + 1)}</span></a>`).join("");
        return (
          `<article class="dg-mv">` +
          `<header><span class="dg-mv-no">${esc(r.no)}</span><h5>${esc(r.song)}</h5></header>` +
          `<p class="dg-mv-album">${r.kind ? esc(r.kind) + " · " : ""}${alb}</p>` +
          `<p class="dg-mv-views"><b>${r.views.toLocaleString("ko")}</b><span>회</span></p>` +
          `<span class="dg-mv-bar" style="--w:${pct}%"><i></i></span>` +
          `<footer><time>${esc(r.date)}</time><span class="dg-mv-links">${vids}</span></footer>` +
          `</article>`
        );
      })
      .join("");
    $(t).replaceWith(`<div class="dg-mvs">${cards}</div>`);
  });
  return $("#r").html();
}

/* ---------- 활동 ---------- */
// members: [{ name, slug, status }] (현재/전 멤버 칩에 쓴다), docLinks: { "음악-방송": {title, href}, ... }
function activityCards(html, members, docHref) {
  // 1) 음악 방송 소절: 링크 카드 둘 + 멤버 칩
  const a = html.indexOf("<h3>음악 방송</h3>");
  const b = html.indexOf("<h3>공연 및 행사</h3>");
  let out = html;
  if (a >= 0 && b > a) {
    const block =
      `<h3>음악 방송<a class="dg-more" href="${docHref("음악-방송")}" data-doc="음악-방송">더 알아보기</a></h3>` +
      `<p>음반별 무대 영상과 그 무대의 직캠을 한곳에서 볼 수 있습니다.</p>`;
    out = out.slice(0, a) + block + out.slice(b);
  }
  // 2) 공연·행사 표: 칸마다 공연 카드 (제목 / 부제 / 기간). 글자만 있는 캡션 행은 버린다.
  const $ = cheerio.load(`<div id="r">${out}</div>`, null, false);
  $("#r table").each((i, t) => {
    const cards = [];
    $(t).find("td").each((j, td) => {
      const lines = ($(td).html() || "").split(/<br\s*\/?>/).map((x) => txt(x)).filter(Boolean);
      if (lines.length < 2) return;
      const [title, sub, date] = lines.length >= 3 ? lines : [lines[0], "", lines[1]];
      cards.push(`<article class="dg-event"><h5>${esc(title)}</h5>${sub ? `<p class="dg-event-sub">${esc(sub)}</p>` : ""}<time>${esc(date)}</time></article>`);
    });
    if (cards.length) $(t).replaceWith(`<div class="dg-events">${cards.join("")}</div>`);
  });
  return $("#r").html();
}


/* ---------- 이미지 갤러리 표 ---------- */
// flover·굿즈 문서에는 "이미지 행 + 캡션 행"이 번갈아 나오는 표가 많다(역대 로고, 멤버십 카드, 응원봉·MD 사진).
// 이미지가 있는 표는 칸마다 [이미지 + 캡션] 카드로 바꿔 격자로 보여 준다. 이미지가 없는 표는 건드리지 않는다.
function galleryTables(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $("#r table").each((i, t) => {
    if (!$(t).find("img.dg-pic").length) return;
    // 사양 표(dg-spec)라도 한 행에 이미지가 둘 이상 나란히 있으면 사진 갤러리다(멤버십 카드 연도별 등). 이미지가 하나뿐인 사양 표는 그대로 둔다.
    if ($(t).hasClass("dg-spec") && !$(t).find("tr").toArray().some((tr) => $(tr).find("img.dg-pic").length >= 2)) return;
    const trs = $(t).find("tr").toArray();
    const grid = trs.map((tr) => $(tr).children("td,th").toArray());
    const isImg = (cell) => $(cell).find("img.dg-pic").length > 0;
    // 글자만 있는 칸이 이미지·캡션이 아니면(= 가격표 같은 데이터 표) 그대로 둔다
    let title = "";
    const figs = [];
    let ok = true;
    grid.forEach((cells, r) => {
      const filled = cells.filter((cl) => txt($(cl).text()) || isImg(cl));
      if (!filled.length) return;
      if (!cells.some(isImg)) {
        // 이미지 없는 행: 맨 위의 제목 행이거나, 바로 위 이미지 행의 캡션 행
        const prevHasImg = r > 0 && grid[r - 1].some(isImg);
        if (r === 0 || filled.length === 1 && !figs.length) {
          title = txt($(filled[0]).text());
        } else if (!prevHasImg) {
          ok = false;
        }
        return;
      }
      cells.forEach((cl, k) => {
        if (!isImg(cl)) return;
        const next = grid[r + 1] && grid[r + 1].some((x) => !isImg(x)) && !grid[r + 1].some(isImg) ? grid[r + 1][k] : null;
        const own = txt($(cl).clone().find("img").remove().end().text());
        const caption = (next ? txt($(next).text()) : "") || own;
        const imgs = $(cl).find("img.dg-pic").toArray().map((im) => $.html(im)).join("");
        const link = $(cl).find("a[href]").first().attr("href");
        figs.push({ imgs, caption, link });
      });
    });
    if (!ok || !figs.length) return;
    const body = figs
      .map((f) => {
        const inner = `<span class="dg-gal-img">${f.imgs}</span>${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ""}`;
        // 사진(webp)은 칸을 꽉 채워 보여 주고, 로고(svg)는 여백을 두고 전체를 보여 준다
        const photo = /[.]webp"/.test(f.imgs);
        return `<figure class="dg-gal-item${photo ? " is-photo" : ""}">${inner}</figure>`;
      })
      .join("");
    $(t).replaceWith(`<div class="dg-gallery">${title ? `<p class="dg-fold-label">${esc(title)}</p>` : ""}<div class="dg-gal-grid">${body}</div></div>`);
  });
  return $("#r").html();
}

module.exports = { logoGallery, albumCards, parseAlbumTable, mvCards, activityCards, galleryTables };
