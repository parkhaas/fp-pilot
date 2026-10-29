#!/usr/bin/env node
/* source/ 의 마크다운(나무위키 변환본)을 읽어 사이트가 쓰는 데이터로 만든다.

   만드는 것:
     data/discography/index.json        앨범 목록(메타·트랙·크레딧). 최신순
     data/discography/albums/<id>.json  앨범 상세(소개·곡 해설·사양·성적·활동·여담 등 HTML 섹션)
     data/discography/extras.json       방송/OST/참여 음반, 여담 등 앨범이 아닌 내용
     data/discography/covers/<id>.webp  커버 썸네일(640px). 원본 URL 은 JSON 에 기록
     source/covers.md                   앨범별 커버 원본 URL 목록(HTML 작성용 참고)

   사용:  node build.js            (커버는 이미 있으면 다시 받지 않는다)
          node build.js --covers   커버를 다시 받는다
   새 앨범이 나오면: node fetch.js → node build.js → node check.js  (README 참고) */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");
const { marked } = require("marked");
// 나무위키 글의 기간 표기("6월 15일~10월 21일")에서 물결표 한 쌍이 취소선으로 해석되던 것을 막는다: 취소선 대신 글자 그대로 되돌려 쓴다
marked.use({ renderer: { del(text) { return "~" + text + "~"; } } });
const sharp = require("sharp");
const { hidePointers, isPointerOnly } = require("./lib/pointers");
const { mergeMusicShows } = require("./lib/music-shows");
const { logoGallery, albumCards, parseAlbumTable, mvCards, activityCards, galleryTables } = require("./lib/group-cards");

const ROOT = __dirname;
const SRC = path.join(ROOT, "source");
const REPO = path.resolve(ROOT, "..", "..");
const OUT = path.join(REPO, "data", "discography");
const IMG_CACHE = path.join(ROOT, ".cache", "img");
const redoCovers = process.argv.includes("--covers");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MAIN_URL = "https://namu.wiki/w/%ED%94%84%EB%A1%9C%EB%AF%B8%EC%8A%A4%EB%82%98%EC%9D%B8/%EC%9D%8C%EB%B0%98";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (t) =>
  t
    .replace(/\(프로미스나인\)$/, "")
    .replace(/^프로미스나인\//, "")
    .replace(/[^0-9A-Za-z가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
const norm = (t) => t.toLowerCase().replace(/[^0-9a-z가-힣]+/g, "");

/* ---------- 마크다운 → 안전한 HTML ---------- */
const ALLOWED = new Set(["p", "br", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "a", "strong", "em", "del", "h3", "h4", "h5", "blockquote", "code", "hr"]);

// 나무위키 링크를 사이트 안 주소로 바꾸기 위한 표 (실행할 때 채운다): 정규화한 문서명 → 슬러그 / 앨범 id
const LINKS = { docs: {}, albums: {} };

// 나무위키 주소가 사이트 안 문서·앨범으로 이어지는지
const resolvable = (url) => {
  const m = url.match(/^https?:\/\/namu\.wiki\/w\/([^#?]+)/);
  if (!m) return false;
  const t = decodeURIComponent(m[1]);
  const k = norm(t.replace(/\(프로미스나인\)$/, ""));
  return !!(LINKS.docs[k] || LINKS.docs[norm(t)] || LINKS.albums[k]);
};

/* X(트위터)·YouTube 링크에 앱 아이콘 클래스를 붙인다. 글자가 "X Corp"·"▶ YouTube"·"#" 처럼 이름표뿐이면 글자를 지우고 아이콘만 남긴다. */
const BRANDS = [
  { cls: "dg-x", host: /^(www[.]|mobile[.])?(x|twitter)[.]com$/, label: "X (트위터)", bare: /^(X Corp[.]?|X|트위터|Twitter|#)?$/i },
  { cls: "dg-yt", host: /^((www|m)[.])?youtube[.]com$|^youtu[.]be$/, label: "YouTube", bare: /^(▶ *)?(YouTube|유튜브|영상 보기|영상|#)?$/i },
  { cls: "dg-ig", host: /(^|[.])instagram[.]com$/, label: "인스타그램", bare: /^(인스타그램|Instagram|인스타|#)?$/i },
  { cls: "dg-tt", host: /(^|[.])(tiktok|douyin)[.]com$/, label: "틱톡", bare: /^(틱톡|TikTok|抖音|도우인|#)?$/i },
  { cls: "dg-fb", host: /(^|[.])facebook[.]com$/, label: "페이스북", bare: /^(페이스북|Facebook|#)?$/i },
  { cls: "dg-nv", host: /^(m[.])?tv[.]naver[.]com$/, label: "네이버TV", bare: /^(네이버 *TV|네이버TV|#)?$/i },
  { cls: "dg-xhs", host: /(^|[.])xiaohongshu[.]com$/, label: "샤오훙슈", bare: /^(샤오홍슈|샤오훙슈|小红书|Xiaohongshu|#)?$/i },
];
function brandLinks(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $("#r a[href]").each((i, a) => {
    let host = "";
    try { host = new URL($(a).attr("href")).hostname; } catch { return; }
    const b = BRANDS.find((x) => x.host.test(host));
    if (!b) return;
    $(a).addClass(b.cls);
    $(a).find("i[data-lucide=play]").remove();
    if (!$(a).hasClass("dg-vid") && b.bare.test($(a).text().trim()) && !$(a).find("img").length) {
      $(a).empty().attr("aria-label", b.label).attr("title", b.label).addClass("dg-brand-only");
    }
  });
  return $("#r").html();
}

/* 나무위키 각주 번호 흔적("[15]", "[2]")을 지운다. 태그 사이의 글자에서만 찾는다. */
function stripFootnotes(html) {
  // 나무위키의 접기 버튼 글자("[ 펼치기 · 접기 ]")도 같이 지운다: 그것뿐인 표 행·빈 문단까지
  html = html
    .replace(/<tr>\s*<td>\s*\[ 펼치기 · 접기 \]\s*(<br>)?\s*<\/td>\s*(<td>\s*<\/td>\s*)*<\/tr>/g, "")
    .replace(/\[ 펼치기 · 접기 \]\s*(<br>)?/g, "")
    .replace(/<p>\s*<\/p>/g, "")
    // 문단 전체가 굵은 글씨 하나뿐이면 굵은 소제목으로 표시한다 (문장 중간의 굵은 글씨는 그대로 이어서 흐른다)
    .replace(/<p>\s*(<strong>[^<]*<\/strong>)\s*<\/p>/g, '<p class="dg-boldhead">$1</p>')
    // 접힌 블록의 제목("[ 데뷔 후 ]")은 작은 구분 표시로
    .replace(/<p>\s*\[ ([^\]<]{1,14}) \]\s*<\/p>/g, '<p class="dg-fold-label">$1</p>');
  // 짝이 맞는 **굵게**는 앞 단계에서 <strong> 이 되었다. 남은 별표는 나무위키 원문에 오타로 들어 있는 것("3,7**장", "8*장")이라 지운다.
  return html.replace(/>([^<]*)</g, (m, t) => ">" + t.replace(/ *[[][0-9]{1,3}[\]]/g, "").replace(/[*][*]/g, "").replace(/([0-9])[*]+(?=장)/g, "$1") + "<");
}

/* 멤버 문서의 활동 표(날짜 | 방송사 | 프로그램 | 역할 | 비고 …)를 행마다 카드로 바꾼다.
   표는 칸 너비가 내용에 끌려가 날짜가 두 줄로 꺾이고 짧은 칸에서 이름이 글자째 쪼개졌다. 카드는 칸 너비와 상관없이 읽힌다.
   연도 행은 소제목, 날짜·방송사·제목·역할·비고를 자리별로 나눠 배치한다. 로고 이미지 글자가 겹친 칸("MBCMBC / MBC / 프로그램")도 정리한다. */
const RC_DATE = /^(날짜|연도|방영일|출연일|발매일|방송 날짜|수상 연도|호수)$/;
const RC_TITLE = ["프로그램명", "프로그램", "방송 프로그램", "제목", "콘텐츠", "곡명", "작품", "브랜드명", "광고명", "브랜드", "채널명", "채널"];
const RC_SRC = /^(방송사|채널|채널명|가수|아티스트|잡지명|기업\/기관|기업명|시상식)$/;
const RC_CHIP = /^(역할|배역|분류|활동|구분)$/;
function rowCards(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  const txt = (x) => x.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
  const dbl = (t) => t.length > 1 && t.length % 2 === 0 && t.slice(0, t.length / 2) === t.slice(t.length / 2);
  const lines = (h) => {
    const L = h.split(/<br\s*\/?>\s*/).map((x) => x.trim()).filter((x) => txt(x) || /<img/.test(x));
    if (L.length >= 2 && dbl(txt(L[0]))) L.shift();
    if (L.length >= 2 && txt(L[0]) === txt(L[1])) L.shift();
    return L;
  };
  const oneLine = (h) => h.replace(/<br\s*\/?>\s*~\s*<br\s*\/?>/g, " ~ ").replace(/<br\s*\/?>/g, " ").replace(/<\/?strong>/g, "").trim();
  $("#r table").each((i, t) => {
    const ths = $(t).find("thead th").toArray().map((th) => $(th).text().replace(/\s+/g, " ").trim());
    if (ths.length < 3 || !(RC_DATE.test(ths[0]) || /^(분류|기업명)$/.test(ths[0]))) return;
    let ti = -1;
    for (const k of RC_TITLE) { const j = ths.indexOf(k); if (j > 0) { ti = j; break; } }
    if (ti < 0) ti = 1;
    const si = ths.findIndex((h, j) => j !== ti && j > 0 && RC_SRC.test(h));
    const groups = [{ head: "", cards: [] }];
    $(t).find("tbody tr").each((j, tr) => {
      if ($(tr).hasClass("dg-yearrow") || $(tr).hasClass("dg-titlerow")) {
        groups.push({ head: $(tr).text().replace(/\s+/g, " ").trim(), cards: [] });
        return;
      }
      const cells = $(tr).children("td,th").toArray().map((c) => $(c).html() || "");
      if (cells.length < ths.length) return;
      const date = RC_DATE.test(ths[0]) ? oneLine(cells[0]) : "";
      let src = si >= 0 ? lines(cells[si])[0] || "" : "";
      const tl = lines(cells[ti]);
      let title = tl.join(" ");
      if (tl.length >= 2 && si < 0) { src = tl[0]; title = tl.slice(1).join(" "); }
      const chips = [];
      const notes = [];
      cells.forEach((c, k) => {
        if (k === 0 && RC_DATE.test(ths[0])) return;
        if (k === ti || k === si) return;
        const v = oneLine(c);
        if (!txt(v) && !/<a /.test(v)) return;
        (RC_CHIP.test(ths[k]) ? chips : notes).push(v);
      });
      if (!txt(title) && !/<a /.test(title)) title = txt(src) || "";
      groups[groups.length - 1].cards.push(
        `<article class="dg-rowcard">` +
          (date ? `<time class="dg-rc-date">${date}</time>` : "") +
          (src ? `<p class="dg-rc-src">${src}</p>` : "") +
          `<h5 class="dg-rc-title">${title}</h5>` +
          (chips.length ? `<p class="dg-rc-chips">${chips.map((x) => `<span>${x}</span>`).join("")}</p>` : "") +
          (notes.length ? `<p class="dg-rc-note">${notes.join(" · ")}</p>` : "") +
          `</article>`
      );
    });
    const body = groups
      .filter((g) => g.cards.length)
      .map((g) => (g.head ? `<h4 class="dg-rows-year">${g.head}</h4>` : "") + `<div class="dg-rowcards">${g.cards.join("")}</div>`)
      .join("");
    $(t).replaceWith(`<div class="dg-rows">${body}</div>`);
  });
  return $("#r").html();
}

function sanitize(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $("#r *").each((i, e) => {
    const tag = e.tagName;
    if (!ALLOWED.has(tag)) {
      $(e).replaceWith($(e).contents());
      return;
    }
    for (const a of Object.keys(e.attribs)) if (!(tag === "a" && a === "href")) delete e.attribs[a];
    if (tag === "a") {
      const h = e.attribs.href || "";
      const wiki = h.match(/^https?:\/\/namu\.wiki\/w\/([^#?]+)/);
      if (wiki) {
        // 나무위키 링크: 사이트 안에 같은 문서가 있으면 그쪽으로, 없으면 링크를 풀어 글자만 남긴다
        const t = decodeURIComponent(wiki[1]).replace(/\(프로미스나인\)$/, "");
        const doc = LINKS.docs[norm(t)] || LINKS.docs[norm(decodeURIComponent(wiki[1]))];
        const album = LINKS.albums[norm(t)];
        if (doc) {
          e.attribs = { href: `?view=discography&doc=${encodeURIComponent(doc)}`, "data-doc": doc };
        } else if (album) {
          e.attribs = { href: `?view=discography&album=${encodeURIComponent(album)}`, "data-album": album };
        } else $(e).replaceWith($(e).contents());
      } else if (!/^https?:\/\//.test(h) || /^https?:\/\/namu\.wiki\//.test(h)) $(e).replaceWith($(e).contents()); // 상대 주소, /w/ 가 아닌 나무위키 주소(이력 등)
      else {
        e.attribs.target = "_blank";
        e.attribs.rel = "noopener noreferrer";
      }
    }
  });
  $("table").each((i, t) => {
    if (!$(t).text().trim()) $(t).remove();
  });
  $("tr").each((i, t) => {
    if (!$(t).text().trim()) $(t).remove();
  });
  $("p,li").each((i, t) => {
    if (!$(t).text().trim() && !$(t).find("a").length) $(t).remove();
  });
  // 연도 구분 행("2019년" 뒤로 빈 칸이 이어지는 행)과 표 맨 위의 제목 행은 한 칸으로 합친다. 마크다운 표에는 colspan 이 없어 칸이 쪼개져 있다.
  $("table").each((i, t) => {
    $(t).find("tr").each((ri, tr) => {
      const cells = $(tr).children("th,td").toArray();
      if (cells.length < 2) return;
      const first = $(cells[0]).text().trim();
      const restEmpty = cells.slice(1).every((c) => !$(c).text().trim());
      const firstRow = $(tr).prevAll("tr").length === 0;
      if (!restEmpty || !first) return;
      // 연도 행, 표 맨 위 제목 행, 그리고 날짜가 아닌 글자만 있는 구분 행(앨범명 등)
      const subRow = cells.length > 2 && !/^[\d.~\s월일:()-]*$/.test(first);
      if (/^\d{4}\s*년?$/.test(first) || (firstRow && cells.length > 2) || subRow) {
        $(cells[0]).attr("colspan", String(cells.length));
        $(tr).addClass(/^\d{4}/.test(first) ? "dg-yearrow" : "dg-titlerow");
        cells.slice(1).forEach((c) => $(c).remove());
      }
    });
  });
  // 앨범 사양 표(2열: 구분 | 내용, 맨 윗줄은 "Photobook Ver." 같은 제목만): 제목 줄을 한 칸으로 합치고, "- " 로 시작하는 줄은 목록으로 바꾼다
  $("table").each((i, t) => {
    const rows = $(t).find("tr").toArray().map((tr) => $(tr).children("th,td").toArray());
    if (!rows.length || !rows.every((c) => c.length === 2)) return;
    if (!$(rows[0][0]).text().trim() || $(rows[0][1]).text().trim()) return;
    // 이미지(로고·상세 사진)만 있던 행은 이미지를 싣지 않아 텅 빈 행이 된다 → 버린다
    $(t).find("tr").each((j, tr) => {
      if (j > 0 && !$(tr).text().trim()) $(tr).remove();
    });
    $(t).addClass("dg-spec");
    $(rows[0][0]).attr("colspan", "2");
    $(rows[0][1]).remove();
    $(t).find("tr").first().addClass("dg-spec-h");
    $(t).find("tr").slice(1).each((j, tr) => {
      const td = $(tr).children("td,th").eq(1);
      const parts = (td.html() || "").split(/<br\s*\/?>\s*/);
      if (parts.filter((x) => /^\s*- /.test(x)).length < 2) return;
      let out = "", list = [];
      const flush = () => { if (list.length) out += "<ul>" + list.map((x) => `<li>${x}</li>`).join("") + "</ul>"; list = []; };
      for (const x of parts) {
        if (/^\s*- /.test(x)) list.push(x.replace(/^\s*- /, "").trim());
        else { flush(); if (x.trim()) out += `<p>${x.trim()}</p>`; }
      }
      flush();
      td.html(out);
    });
  });
  // 유튜브 링크가 든 표(멤버별 영상 등)는 "이름 + 재생 버튼" 목록으로 바꾼다.
  // 표는 [링크 행, 이름 행]이 번갈아 나오므로 같은 칸 위치의 아래 행을 이름으로 쓴다.
  $("table").each((i, t) => {
    const rows = $(t).find("tr").toArray().map((tr) => $(tr).children("th,td").toArray());
    const isYt = (c) => $(c).find('a[href*="youtube.com/watch"]').length > 0;
    // 첫 행이 영상 링크(또는 빈 칸)뿐인 표만 목록으로 바꾼다. 날짜·제목이 있는 일반 표(방송·웹 콘텐츠 등)는 그대로 둔다.
    if (!rows.length || !rows[0].some(isYt) || !rows[0].every((c) => isYt(c) || !$(c).text().trim())) return;
    const items = [];
    rows.forEach((r, ri) => {
      r.forEach((c, ci) => {
        if (!isYt(c)) return;
        const href = $(c).find("a").first().attr("href");
        const below = rows[ri + 1] && rows[ri + 1][ci];
        const name = below && !isYt(below) ? $(below).text().replace(/\s+/g, " ").trim() : "";
        items.push({ href, name });
      });
    });
    const list = items
      .map((v) => `<a class="dg-vid" href="${v.href}" target="_blank" rel="noopener noreferrer"><i data-lucide="play"></i><span>${(v.name || "영상 보기").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]))}</span></a>`)
      .join("");
    $(t).replaceWith(`<div class="dg-videos">${list}</div>`);
  });
  // 링크 하나뿐인 문단도 같은 버튼 모양으로, 굵은 소제목의 줄바꿈은 공백으로
  $("p").each((i, p) => {
    const a = $(p).children("a[href*='youtube.com/watch']");
    if (a.length === 1 && $(p).text().trim() === a.text().trim()) {
      $(p).replaceWith(`<div class="dg-videos"><a class="dg-vid" href="${a.attr("href")}" target="_blank" rel="noopener noreferrer"><i data-lucide="play"></i><span>영상 보기</span></a></div>`);
    }
  });
  $("p > strong").each((i, s) => {
    $(s).text($(s).text().replace(/\s*\n\s*/g, " "));
  });
  return $("#r").html().trim();
}

// 국기 이미지: 사이트에는 작은 svg 만 data/discography/flags/ 로 내려받아 쓴다 (이름 → 원본 주소)
const FLAGS = new Map();
const flagName = (alt) => slugify(alt.replace(/\s*국기.*$/, "")) || "flag";
const flagImg = (name, label) => `<img class="dg-nation" src="data/discography/flags/${name}.svg" alt="${label}" title="${label}" height="14">`;

// 이미지가 본문인 문서(layout: cards)를 만드는 동안만 켠다: { 원본URL: { file, w, h } } (fetch-doc-images.js 가 만든 source/doc-images.json)
let DOC_IMAGES = null;

function mdToHtml(md) {
  const noImg = md
    // 국기 이미지(링크로 감싼 것 포함)는 자리표시로 바꿔 두었다가 sanitize 뒤에 <img> 로 넣는다
    .replace(/\[?!\[([^\]]*국기)\]\(([^)\s]+)\)(?:\]\((?:[^()\s]|\([^()]*\))+(?: "[^"]*")?\))?/g, (m, alt, src) => {
      const n = flagName(alt);
      FLAGS.set(n, src);
      return `@@FLAG:${n}:${alt.replace(/[@:]/g, "")}@@`;
    })
    // 받아 둔 이미지는 자리표시로 바꿔 두었다가 sanitize 뒤에 <img> 로 넣는다 (링크로 감싼 이미지는 링크를 그대로 둔다). 목록에 없는 이미지는 아래 규칙대로 처리된다.
    .replace(/!\[([^\]]*)\]\((https?:[/][/][^)\s]+)\)/g, (m, alt, src) => {
      const im = DOC_IMAGES && DOC_IMAGES[src];
      return im ? `@@IMG:${im.file};${encodeURIComponent(alt.trim())}@@` : m;
    })
    // 이미지로만 된 문서 링크 [![alt](이미지)](주소 "문서 이름"): 이미지는 빼고 문서 이름을 글자로 남긴다 (표의 방송·채널·앨범 칸)
    .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(((?:[^()\s]|\([^()]*\))+)(?: "([^"]*)")?\)/g, (m, alt, url, title) => {
      const label = (title || alt || "").replace(/^\[+|\]+$/g, "").replace(/\([^)]*\)\s*$/, "").replace(/\s*(로고|아이콘).*$/, "").trim();
      return label ? `[${label}](${url})` : "";
    })
    // 이미지는 싣지 않는다(커버·프로필만 따로 저장). 다만 방송·채널 "로고" 이미지는 이름표 역할이라 alt 글자로 대신한다.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (/로고\s*$|로고[ (]/.test(alt) ? alt.replace(/\([^)]*\)/g, "").replace(/\s*로고.*$/, "").trim() : ""))
    .replace(/^\[ (?:펼치기 · 접기|펼치기|접기) \]\s*$/gm, "")
    .replace(/(^|\n)\[?CC-white[\s\S]*?(?=\n[ \t]*\n|$)/g, "$1") //"CC-white 이 문단의 내용 중 전체 또는 일부는 … 문서의 r3679 판에서 가져왔습니다" 같은 나무위키 문단 출처 안내
    // 이미지 캡션 링크("[2022 fromis_9 1st concert2022\ fromis\_9\ 1st\ concert](주소)"): 이미지 설명이 이스케이프된 채 한 번 더 붙은 줄이라 뺀다
    .replace(/^\[[^\]\n]*\\ [^\]\n]*\]\([^)\n]*\)[ \t]*$/gm, "")
    .replace(/(\S)\[\d{1,3}\](?!\()/g, "$1") // 각주 번호([13] 등)는 각주 본문을 싣지 않으므로 뺀다
    // 굵게(**…**): 닫는 ** 앞이 문장부호이고 뒤가 한글일 때(`**나인(9)**는`) CommonMark 가 강조로 보지 않아 별표가 그대로 남았다.
    // 한 줄 안에서 짝이 맞는 것은 <strong> 으로 직접 바꾼다 (안쪽의 링크 등 마크다운은 그대로 처리된다).
    .replace(/[*][*]([^*\n]+?)[*][*]/g, "<strong>$1</strong>");
  return stripFootnotes(
    brandLinks(
      sanitize(marked.parse(noImg, { gfm: true, breaks: false }))
        .replace(/@@FLAG:([^:@]+):([^@]*)@@/g, (m, n, label) => flagImg(n, label))
        .replace(/@@IMG:([^;@]+)[;]([^@]*)@@/g, (m, file, alt) => `<img class="dg-pic" src="data/discography/${file}" alt="${escHtml(decodeURIComponent(alt))}" loading="lazy" decoding="async">`)
    )
  );
}

const plain = (s) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/\(\(([^()]*)\)\)/g, "($1)")
    .replace(/\s+/g, " ")
    .trim();

/* ---------- 메인 문서 파싱 ---------- */
function splitRow(l) {
  return l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((s) => s.trim());
}

function parseTracks(lines) {
  const i0 = lines.findIndex((l) => /^\| \*\*곡 정보\*\*/.test(l));
  if (i0 < 0) return [];
  const tracks = [];
  let t = null;
  for (let i = i0 + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const [c1, c2 = ""] = splitRow(lines[i]);
    if (c1) {
      const parts = c1.split(/<br>/).map((s) => s.trim()).filter(Boolean);
      const title = plain(parts[0] || "");
      const numPart = parts.find((p) => /^\*\*\d+\*\*/.test(p)) || "";
      const m = numPart.match(/^\*\*(\d+)\*\*\s*(\S+)?/);
      t = {
        no: m ? Number(m[1]) : tracks.length + 1,
        title,
        runtime: m && m[2] && /^\d+:\d+$/.test(m[2]) ? m[2] : "",
        isTitle: parts.some((p) => /\*\*TITLE\*\*|^TITLE$/.test(p)),
        credits: {},
      };
      tracks.push(t);
    }
    if (t && c2) {
      const m = c2.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
      if (m) {
        const names = m[2].split("｜").map(plain).filter((x) => x && x !== "-");
        if (names.length) t.credits[m[1].trim()] = names;
      }
    }
  }
  return tracks;
}

/* "방송 / OST / 참여 음반": 항목마다 [![커버](이미지)\n\n**곡**\n**프로그램**\n날짜｜시간｜N곡](출처) 가 한 덩어리의 링크로 이어져 있어서 일반 마크다운으로는 깨졌다.
   덩어리마다 커버·제목·날짜·곡 수와 트랙 표(곡 정보 | 크레딧)를 읽어 카드로 만든다. */
async function partAlbums(lines) {
  const text = lines.join("\n");
  const blocks = text.split(/\n(?=\[!\[)/).map((b) => b.trim()).filter((b) => /^\[!\[/.test(b));
  const cards = [];
  for (const b of blocks) {
    const linkAt = b.search(/\]\(https:\/\/namu\.wiki/);
    const head = linkAt > 0 ? b.slice(0, linkAt) : b;
    const info = head.match(/(\d{4}\. \d{2}\. \d{2}\.)[^｜\n]*｜([^｜\n]*)｜(\d+)곡/);
    const bold = [...head.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => plain(m[1]).trim()).filter(Boolean);
    if (!info || !bold.length) continue;
    const src = (b.slice(linkAt).match(/ "([^"]*)"\)/) || [])[1] || "";
    const coverUrl = (b.match(/!\[[^\]]*\]\((https:\/\/i\.namu\.wiki\/[^)\s]+)\)/) || [])[1] || "";
    // 표 맨 끝의 앨범 소개 행("…｜Digital Single")은 곡이 아니다
    const tracks = parseTracks(b.split("\n")).filter((t) => !t.title.includes("｜"));
    const id = `part-${dateIso(info[1])}-${slugify(bold[0])}`;
    let cover = null;
    try {
      cover = await getCover({ id, coverSource: coverUrl });
    } catch (e) {
      console.warn(`  [경고] 참여 음반 커버 실패 ${bold[0]}: ${e.message}`);
    }
    const trackHtml = tracks
      .map((t) => {
        const cr = Object.entries(t.credits).map(([k, v]) => `${escHtml(k)} ${escHtml(v.join(", "))}`).join(" · ");
        return `<li><span class="n">${String(t.no).padStart(2, "0")}</span><b>${escHtml(t.title)}${t.isTitle ? ' <em class="dg-tt-badge">타이틀</em>' : ""}</b>${t.runtime ? `<time>${t.runtime}</time>` : ""}${cr ? `<i>${cr}</i>` : ""}</li>`;
      })
      .join("");
    const runtime = /^\d+['’:]/.test(info[2].trim()) ? info[2].trim() : "";
    cards.push(
      `<article class="dg-extra-album">` +
        `<span class="dg-album-cover">${cover ? `<img src="data/discography/${cover.file}" alt="${escHtml(bold[0])} 커버" loading="lazy" decoding="async">` : ""}</span>` +
        `<div class="dg-extra-info"><h5>${escHtml(bold[0])}</h5>` +
        (bold.length > 1 ? `<p class="dg-extra-sub">${escHtml(bold.slice(1).join(" "))}</p>` : "") +
        `<p class="dg-extra-meta">${escHtml([info[1].replace(/\.$/, "").replace(/\. /g, "."), runtime, info[3] + "곡"].filter(Boolean).join(" · "))}</p>` +
        (src ? `<p class="dg-extra-src">출처 · ${escHtml(src)}</p>` : "") +
        (trackHtml ? `<ol class="dg-extra-tracks">${trackHtml}</ol>` : "") +
        `</div></article>`
    );
  }
  return cards.length ? `<div class="dg-extra-albums">${cards.join("")}</div>` : "";
}

const dateIso = (d) => d.replace(/\.\s*/g, "-").replace(/-$/, "");

function parseMain(md) {
  const lines = md.split("\n");
  let region = "";
  let category = "";
  let cur = null;
  const albums = [];
  const extras = {};

  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join("\n");
    const cover = text.match(/!\[[^\]]*\]\((https:\/\/i\.namu\.wiki\/[^)\s]+)\)/);
    const info = text.match(/(\d{4}\. \d{2}\. \d{2}\.)(?:\s*\(([^)]*)\))?｜([^｜]*)｜(\d+)곡/);
    const bold = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    // 종류 표기(예: THE 1st ALBUM): 날짜 바로 앞의 굵은 글씨의 마지막 줄
    const lab = text.match(/\*\*([^*]+)\*\*\s*\n\s*\d{4}\. \d{2}\. \d{2}\./);
    const label = lab ? lab[1].split("\n").map((s) => s.trim()).filter(Boolean).pop() : "";
    const tracks = parseTracks(cur.lines);
    // 트랙 표 뒤의 안내/덧붙임 (상세 문서 안내 문장은 제외)
    const tEnd = cur.lines.reduce((acc, l, i) => (l.startsWith("|") ? i : acc), -1);
    const after = cur.lines.slice(tEnd + 1).join("\n").replace(/^.*자세한 내용은.*문서를 참고하십시오.*$/m, "").trim();
    albums.push({
      region: cur.region,
      group: cur.category,
      seq: cur.seq,
      title: cur.title,
      note: cur.extra,
      label,
      releaseDate: info ? dateIso(info[1]) : "",
      dateNote: info && info[2] ? info[2] : "",
      runtime: info && /^\d+:\d+/.test(info[3].trim()) ? info[3].trim() : "",
      trackCount: info ? Number(info[4]) : tracks.length,
      coverSource: cover ? cover[1] : "",
      tracks,
      after,
      _boldDebug: bold.length,
    });
    cur = null;
  };

  for (const line of lines) {
    const h = line.match(/^(#{2,4}) (.+)$/);
    if (h) {
      const lvl = h[1].length;
      const text = h[2].trim();
      if (lvl === 2) {
        flush();
        region = text;
        category = "";
        extras[region] = [];
        continue;
      }
      if (region === "국내 음반" && lvl === 3) {
        flush();
        category = text;
        continue;
      }
      const m = text.match(/^(.*?)\s*《(.+)》\s*(.*)$/);
      if (m && ((region === "국내 음반" && lvl === 4) || (region === "일본 음반" && lvl === 3))) {
        flush();
        cur = { region, category: region === "일본 음반" ? "일본" : category, seq: m[1].trim(), title: m[2].trim(), extra: m[3].trim(), lines: [] };
        continue;
      }
    }
    if (cur) cur.lines.push(line);
    else if (extras[region]) extras[region].push(line);
  }
  flush();
  return { albums, extras };
}

/* ---------- 그룹 문서의 멤버 소개: 5열 표 대신 나이순 세로 카드 ---------- */
function memberSection(md, profilePath, infoAll) {
  const dotted = (s) => {
    const m = (s || "").match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  };
  const ageOf = (iso) => {
    const b = new Date(iso);
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  };
  const rows = (t) => t.split("\n").filter((l) => l.startsWith("|"));
  const [curPart, formerPart = ""] = md.split(/\n### 전 멤버\n/);

  const members = [];
  const ct = rows(curPart); // 사진 / 구분선 / 이름 / 생년월일·포지션 / 참고 사항
  if (ct.length >= 4) {
    const names = splitRow(ct[2]);
    const info = splitRow(ct[3]);
    names.forEach((n, i) => {
      const parts = (info[i] || "").split(/<br>/).map((x) => x.trim()).filter(Boolean);
      members.push({
        name: plain(n),
        birth: dotted(parts[0]),
        pos: parts.slice(1).filter((p) => !/국기/.test(p)).map((p) => p.replace(/\*\*/g, "").trim()).filter(Boolean),
        flag: (() => {
          const fm = (parts.find((p) => /국기/.test(p)) || "").match(/!\[([^\]]*국기)\]\(([^)\s]+)\)/);
          if (!fm) return null;
          FLAGS.set(flagName(fm[1]), fm[2]);
          return { name: flagName(fm[1]), label: fm[1] };
        })(),
        status: "current",
      });
    });
  }
  for (const l of rows(formerPart).slice(2)) {
    const [n, b, p, out] = splitRow(l);
    members.push({
      name: plain(n),
      birth: dotted(b),
      pos: plain(p).split(/[,/]/).map((x) => x.trim()).filter(Boolean),
      left: dotted(out),
      status: "former",
    });
  }

  const noteCell = ct[4] ? splitRow(ct[4])[0] : "";
  const noteMd = noteCell.replace(/<br>\s*(?=- )/g, "\n\n").replace(/<br>/g, "\n\n");
  const noteHtml = noteMd ? mdToHtml(noteMd) : "";

  // 카드에 보여 줄 인물 정보 항목 (원문 인물 정보 표에서). 출생은 첫 줄(날짜)만.
  const FACTS = ["별자리", "신체", "MBTI", "상징 색", "좌우명", "별명"];
  const facts = (slug) => {
    const raw = infoAll && infoAll[slug];
    if (!raw) return { names: "", rows: [] };
    const built = buildInfo(slug, raw, {});
    const rows = [];
    for (const k of FACTS) {
      const r = built && built.rows.find((x) => x.k.replace(/\s+/g, " ") === k);
      if (!r) continue;
      let html = r.html;
      if (k === "출생") html = html.split("<br>")[0];
      if (k === "신체") html = html.replace(/<br>/g, " ");
      rows.push(`<div><dt>${k}</dt><dd>${html}</dd></div>`);
    }
    const n = raw.name || {};
    return { names: [n.hanja, n.en].filter(Boolean).map(escHtml).join(" <span>｜</span> "), rows };
  };
  const card = (m) => {
    const slug = LINKS.docs[norm(m.name)];
    const img = slug && profilePath[slug];
    const link = (inner, cls) => (slug ? `<a class="${cls}" href="?view=discography&doc=${encodeURIComponent(slug)}" data-doc="${slug}">${inner}</a>` : inner);
    const f = facts(slug);
    return (
      `<li class="dg-member">` +
      link(img ? `<img src="data/discography/${img}" alt="${m.name} 프로필 사진" loading="lazy" decoding="async">` : `<span class="dg-member-noimg"></span>`, "dg-member-photo") +
      `<div class="dg-member-info"><h4>${link(m.name, "dg-member-name")}</h4>` +
      (f.names ? `<p class="dg-member-names">${f.names}</p>` : "") +
      (m.pos.length ? `<p class="dg-member-pos">${m.pos.map((p) => `<span>${p.replace(/ *[[][0-9]{1,3}[\]]/g, "")}</span>`).join("")}</p>` : "") +
      (m.birth ? `<p class="dg-member-birth">${m.flag ? flagImg(m.flag.name, m.flag.label) : ""}${m.birth.replace(/-/g, ".")} (${ageOf(m.birth)}세)</p>` : "") +
      (m.left ? `<p class="dg-member-left">탈퇴 ${m.left.replace(/-/g, ".")}</p>` : "") +
      (f.rows.length ? `<dl class="dg-member-facts">${f.rows.join("")}</dl>` : "") +
      `</div></li>`
    );
  };
  const list = (st) =>
    `<ul class="dg-members">${members
      .filter((m) => m.status === st)
      .sort((a, b) => a.birth.localeCompare(b.birth)) // 나이순(생년월일이 빠른 순)
      .map(card)
      .join("")}</ul>`;

  return (
    `<h3>현재 멤버</h3>${list("current")}` +
    // 접지 않고 펼친 소제목 카드로 보여 준다 (본문 앞의 같은 이름 구분 칩은 중복이라 뺀다)
    (noteHtml ? `<h3>포지션 관련 참고 사항</h3>${noteHtml.replace(/<p class="dg-fold-label">포지션 관련 참고 사항<\/p>/, "")}` : "") +
    `<h3>전 멤버</h3>${list("former")}`
  );
}

/* 그룹소개 "팬덤" 소절: flover 문서(source/docs/flover.md)의 팬덤명·규모·성비를 발췌하고 flover·굿즈 문서로 가는 카드를 붙인다 */
const docHrefFor = (slug) => `?view=discography&doc=${encodeURIComponent(slug)}`;
function fandomSection(docHref) {
  const file = path.join(SRC, "docs", "flover.md");
  if (!fs.existsSync(file)) return "";
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // "### 제목" 아래 ~ 다음 제목 전까지의 글을 빈 줄 기준 덩어리로 나눠 앞에서 max 개만
  const excerpt = (title, max) => {
    const i = lines.findIndex((l) => l.trim() === "### " + title);
    if (i < 0) return "";
    let j = i + 1;
    while (j < lines.length && !/^#{2,3} /.test(lines[j])) j++;
    const blocks = lines.slice(i + 1, j).join("\n").split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b && !/^[|!]/.test(b));
    return mdToHtml(blocks.slice(0, max).join("\n\n"));
  };
  const card = (title, body) => (body ? `<h3>${title}</h3>${body}` : "");
  // 큰 링크 카드 대신, 첫 카드 제목 오른쪽에 "더 알아보기" 버튼 하나
  const more = `<a class="dg-more" href="${docHref("flover")}" data-doc="flover">더 알아보기</a>`;
  const cheer = `<a class="dg-more" href="${docHref("응원법")}" data-doc="응원법">더 알아보기</a>`;
  return (
    card(`팬덤명 · flover${more}`, excerpt("팬덤명", 3)) +
    card("규모", excerpt("규모", 3)) +
    card("성비", excerpt("성비", 2)) +
    card(`응원법${cheer}`, "<p>앨범과 곡별 응원법을 발매 순서대로 정리한 문서입니다.</p>")
  );
}

/* ---------- 멤버 인물 정보 표 (extract-profile-info.js 가 만든 source/profile-info.json) ---------- */
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function zodiac(month, day) {
  const edges = [[1, 20, "염소자리"], [2, 19, "물병자리"], [3, 21, "물고기자리"], [4, 20, "양자리"], [5, 21, "황소자리"], [6, 22, "쌍둥이자리"], [7, 23, "게자리"], [8, 23, "사자자리"], [9, 24, "처녀자리"], [10, 24, "천칭자리"], [11, 23, "전갈자리"], [12, 22, "사수자리"]];
  let name = "염소자리";
  for (const [m, d, n] of edges) if (month > m || (month === m && day >= d)) name = n;
  return name;
}

// 조각 목록 → 안전한 HTML. signFiles: 서명 이미지 { light, dark } (저장된 상대 경로)
function renderInfoParts(parts, ctx) {
  return parts
    .map((p) => {
      if (p.t === "text") return escHtml(p.v);
      if (p.t === "br") return "<br>";
      if (p.t === "img") {
        if (/국기/.test(p.alt)) {
          FLAGS.set(flagName(p.alt), p.src);
          return flagImg(flagName(p.alt), p.alt);
        }
        return ""; // 서명 등 그 밖의 이미지는 따로 처리
      }
      if (p.t === "a") {
        const inner = renderInfoParts(p.parts, ctx);
        const wiki = p.href.match(/^https?:\/\/namu\.wiki\/w\/([^#?]+)/);
        if (wiki) {
          const t = decodeURIComponent(wiki[1]).replace(/\(프로미스나인\)$/, "");
          const doc = LINKS.docs[norm(t)];
          return doc ? `<a href="?view=discography&doc=${encodeURIComponent(doc)}" data-doc="${doc}">${inner}</a>` : inner;
        }
        if (!/^https?:\/\//.test(p.href)) return inner;
        // 아이콘뿐인 외부 링크(인스타그램 등): 이름표 글자를 붙인다
        const icon = p.parts.find((x) => x.t === "img");
        const label = inner.replace(/<[^>]*>/g, "").trim() || (icon ? icon.alt.replace(/\s*(아이콘|로고).*$/, "").trim() : "") || new URL(p.href).hostname.replace(/^www\./, "");
        return `<a class="dg-ext" href="${escHtml(p.href)}" target="_blank" rel="noopener noreferrer">${inner.replace(/<[^>]*>/g, "").trim() ? inner : escHtml(label)}</a>`;
      }
      return "";
    })
    .join("");
}

function buildInfo(slug, info, signFiles) {
  if (!info) return undefined;
  const rows = [];
  for (const r of info.rows) {
    let html;
    if (r.k === "서명") {
      const s = signFiles[slug];
      if (!s) continue;
      html = `<img class="dg-sign" src="data/discography/${s.light}" alt="${escHtml(info.name.ko)} 서명">` + (s.dark ? `<img class="dg-sign dg-sign-dark" src="data/discography/${s.dark}" alt="">` : "");
    } else {
      html = renderInfoParts(r.parts, {});
    }
    html = html.replace(/\[\s*이전 소속사[^\]]*\]/g, "").replace(/(<br>)+$/, "").replace(/^(<br>)+/, "").trim();
    html = html.replace(/\(데뷔일로부터[^)]*\)/g, "").replace(/(<br>\s*){2,}/g, "<br>").replace(/(<br>\s*)+$/, "");
    if (r.k === "링크") html = html.replace(/<\/a><a /g, "</a> <a ");
    // 상징 색: 색 견본을 붙인다
    if (/상징\s*색/.test(r.k)) html = html.replace(/(#[0-9A-Fa-f]{6})/, '<i class="dg-swatch" style="background:$1"></i>$1');
    if (!html.replace(/<[^>]*>/g, "").trim() && !/<img/.test(html)) continue;
    html = stripFootnotes(brandLinks(html));
    rows.push({ k: r.k, html });
    // 출생 아래에는 계산한 별자리를 덧붙인다 (원문 표에는 따로 없다)
    if (r.k === "출생") {
      const m = html.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (m) rows.push({ k: "별자리", html: zodiac(Number(m[2]), Number(m[3])) });
    }
  }
  return { name: info.name, rows };
}

/* ---------- 상세 문서 파싱 ---------- */
function parseDetail(md) {
  const body = md.replace(/^---[\s\S]*?---\n/, "").replace(/^> 이 문서는[^\n]*\n/m, "");
  const upd = body.match(/\*최근 수정 시각: ([^*]+)\*/);
  const parts = body.split(/\n(?=## )/);
  const sections = [];
  for (const p of parts) {
    const m = p.match(/^## (.+)\n?([\s\S]*)$/);
    if (!m) continue;
    const title = m[1].trim();
    const text = m[2].trim();
    // "자세한 내용은 [문서] 문서를 참고하십시오" 뿐인 소절은 숨긴다 (hidden). 내용은 JSON 의 hidden 목록과 HTML 주석에 남겨 나중에 되살릴 수 있다.
    if (isPointerOnly(text, resolvable)) sections.push({ title, md: text, hidden: true });
    else sections.push({ title, md: hidePointers(text, resolvable) });
  }
  return { updated: upd ? upd[1].trim() : "", sections };
}

/* 수록곡 섹션: ### 곡명 단위로 쪼개서 해당 트랙의 해설로 붙인다 */
function splitTrackNotes(md) {
  const chunks = md.split(/\n(?=### )/);
  const intro = chunks[0].startsWith("### ") ? "" : chunks.shift();
  return { intro, notes: chunks.map((c) => ({ title: c.match(/^### (.+)/)[1].trim(), md: c.replace(/^### .+\n?/, "").trim() })) };
}

/* ---------- 커버 ---------- */
// 커버에서 대표색(채도·빈도가 높은 색)을 뽑는다. 앨범 상세 화면의 강조색으로 쓴다.
async function accentOf(file) {
  const { data } = await sharp(file).resize(24, 24, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (mx < 70 || sat < 0.28) continue; // 어둡거나 탁한 색은 제외
    const key = [r, g, b].map((v) => v >> 5).join(",");
    const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    e.n++; e.r += r; e.g += g; e.b += b; e.sat += sat;
    bins.set(key, e);
  }
  let best = null;
  for (const e of bins.values()) if (!best || e.n * (e.sat / e.n + 0.5) > best.n * (best.sat / best.n + 0.5)) best = e;
  if (!best) return "";
  const hex = [best.r, best.g, best.b].map((v) => Math.round(v / best.n).toString(16).padStart(2, "0")).join("");
  return "#" + hex;
}

async function getCover(album) {
  if (!album.coverSource) return null;
  const outFile = path.join(OUT, "covers", album.id + ".webp");
  if (!redoCovers && fs.existsSync(outFile)) {
    const meta = await sharp(outFile).metadata();
    return { file: `covers/${album.id}.webp`, w: meta.width, h: meta.height, accent: await accentOf(outFile) };
  }
  const key = crypto.createHash("sha1").update(album.coverSource).digest("hex");
  const cacheFile = path.join(IMG_CACHE, key);
  let buf;
  if (fs.existsSync(cacheFile)) buf = fs.readFileSync(cacheFile);
  else {
    const res = await fetch(album.coverSource, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`커버 HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(IMG_CACHE, { recursive: true });
    fs.writeFileSync(cacheFile, buf);
    await sleep(800);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const info = await sharp(buf).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 80 }).toFile(outFile);
  return { file: `covers/${album.id}.webp`, w: info.width, h: info.height, accent: await accentOf(outFile) };
}

/* ---------- 실행 ---------- */
(async () => {
  const mainMd = fs.readFileSync(path.join(SRC, "00-음반-목록.md"), "utf8");
  const details = JSON.parse(fs.readFileSync(path.join(SRC, "details.json"), "utf8"));
  const detailBySlug = Object.fromEntries(details.map((d) => [d.slug, d]));
  const { albums, extras } = parseMain(mainMd);

  fs.mkdirSync(path.join(OUT, "albums"), { recursive: true });
  const index = [];

  // 링크 표: 주요 문서(docs.json)와 앨범은 사이트 안 주소로 연결한다
  const docList = JSON.parse(fs.readFileSync(path.join(ROOT, "docs.json"), "utf8"));
  for (const d of docList) {
    d.slug = slugify(d.title);
    LINKS.docs[norm(d.title.replace(/\(프로미스나인\)$/, ""))] = d.slug;
    LINKS.docs[norm(d.title)] = d.slug;
  }
  // 다른 문서에 합쳐진 문서(직캠 → 음악 방송)로 가는 링크는 합친 문서로 보낸다
  for (const d of docList) {
    if (!d.mergeInto) continue;
    const target = slugify(d.mergeInto);
    LINKS.docs[norm(d.title)] = target;
    LINKS.docs[norm(d.title.replace(/^프로미스나인[/]/, ""))] = target;
  }
  for (const a of albums) {
    a.id = `${a.releaseDate || "undated"}-${slugify(a.title)}`;
    LINKS.albums[norm(a.title)] = a.id;
  }

  for (const a of albums) {
    const slug = slugify(a.title);
    const d = detailBySlug[slug];
    const detailFile = d ? path.join(SRC, "albums", d.slug + ".md") : "";
    a.namu = d ? { title: d.title, url: d.url } : null;

    a.cover = await getCover(a).catch((e) => {
      console.warn(`  [경고] 커버 실패 ${a.id}: ${e.message}`);
      return null;
    });

    // 트랙 해설·섹션
    let detail = null;
    if (detailFile && fs.existsSync(detailFile)) {
      const dd = parseDetail(fs.readFileSync(detailFile, "utf8"));
      const sections = [];
      const hidden = [];
      let summary = "";
      for (const s of dd.sections) {
        if (s.hidden) {
          hidden.push({ title: s.title, md: s.md });
          continue;
        }
        if (s.title === "개요") {
          summary = mdToHtml(s.md);
          continue;
        }
        if (s.title === "수록곡") {
          const { intro, notes } = splitTrackNotes(s.md);
          let left = "";
          for (const n of notes) {
            const t = a.tracks.find((x) => norm(x.title) === norm(n.title) || norm(x.title).startsWith(norm(n.title)) || norm(n.title).startsWith(norm(x.title)));
            if (t && !t.note) t.note = mdToHtml(n.md);
            else left += `### ${n.title}\n\n${n.md}\n\n`;
          }
          const html = mdToHtml((intro + "\n\n" + left).trim());
          if (html) sections.push({ id: "tracks", title: "수록곡 정보", html });
          continue;
        }
        // 콘셉트 티저의 "이미지" 소절은 사진뿐이라(저장하지 않음) 뺀다. 영상 소절은 유튜브 링크로 남는다.
        const src = s.title === "콘셉트 티저" ? s.md.replace(/(^|\n)### 이미지\n[\s\S]*?(?=\n### |$)/, "$1") : s.md;
        const html = mdToHtml(src);
        if (html) sections.push({ id: slugify(s.title) || "sec", title: s.title, html });
      }
      detail = { id: a.id, updated: dd.updated, summary, sections, hidden: hidden.length ? hidden : undefined };
    }

    const afterHtml = a.after ? mdToHtml(a.after) : "";
    const meta = {
      id: a.id,
      region: a.region === "일본 음반" ? "japan" : "korea",
      group: a.group,
      seq: a.seq,
      title: a.title,
      status: /발매 취소|무산/.test(a.note + a.dateNote) ? "cancelled" : "released",
      label: a.label,
      releaseDate: a.releaseDate,
      runtime: a.runtime,
      trackCount: a.trackCount,
      titleTracks: a.tracks.filter((t) => t.isTitle).map((t) => t.title),
      cover: a.cover,
      coverSource: a.coverSource,
      namu: a.namu,
      hasDetail: !!detail,
      note: afterHtml || undefined,
      tracks: a.tracks.map((t) => ({ ...t, note: t.note ? true : undefined })),
    };
    index.push({ meta, trackNotes: Object.fromEntries(a.tracks.filter((t) => t.note).map((t) => [t.no, t.note])), detail });
  }

  index.sort((x, y) => (y.meta.releaseDate || "").localeCompare(x.meta.releaseDate || ""));

  for (const it of index) {
    if (it.detail) {
      const out = { ...it.detail, trackNotes: it.trackNotes };
      fs.writeFileSync(path.join(OUT, "albums", it.meta.id + ".json"), JSON.stringify(out) + "\n", "utf8");
    }
  }
  // 주요 문서(그룹·멤버·응원법 등): 섹션별 HTML 로 저장
  fs.mkdirSync(path.join(OUT, "docs"), { recursive: true });
  const SKIP = new Set(["둘러보기", "역대 프로필 사진", "각주"]);
  const docsMeta = [];

  // 멤버 프로필 사진: 480px WebP 로 저장 (source/profiles.json 은 node fetch-profiles.js 가 만든다)
  const profilesFile = path.join(SRC, "profiles.json");
  const profiles = fs.existsSync(profilesFile) ? JSON.parse(fs.readFileSync(profilesFile, "utf8")) : {};
  const profilePath = {};
  for (const [slug, p] of Object.entries(profiles)) {
    try {
      const out = path.join(OUT, "profiles", slug + ".webp");
      if (redoCovers || !fs.existsSync(out)) {
        const key = crypto.createHash("sha1").update(p.url).digest("hex");
        const cacheFile = path.join(IMG_CACHE, key);
        let buf;
        if (fs.existsSync(cacheFile)) buf = fs.readFileSync(cacheFile);
        else {
          const res = await fetch(p.url, { headers: { "User-Agent": UA } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
          fs.mkdirSync(IMG_CACHE, { recursive: true });
          fs.writeFileSync(cacheFile, buf);
          await sleep(800);
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await sharp(buf).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
      }
      profilePath[slug] = `profiles/${slug}.webp`;
    } catch (e) {
      console.warn(`  [경고] 프로필 사진 실패 ${slug}: ${e.message}`);
    }
  }
  // 인물 정보 표의 서명 이미지(작은 svg)를 내려받는다. 밝은 배경용과 어두운 배경용(화이트) 두 장이 있다.
  const infoFile = path.join(SRC, "profile-info.json");
  const infoAll = fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile, "utf8")) : {};
  const docImgFile = path.join(SRC, "doc-images.json");
  const docImages = fs.existsSync(docImgFile) ? JSON.parse(fs.readFileSync(docImgFile, "utf8")) : {};
  const logoFile = path.join(SRC, "group-logos.json");
  const groupLogos = fs.existsSync(logoFile) ? JSON.parse(fs.readFileSync(logoFile, "utf8")) : null;
  const signFiles = {};
  for (const [slug, info] of Object.entries(infoAll)) {
    const row = info.rows.find((r) => r.k === "서명");
    const imgs = row ? row.parts.filter((x) => x.t === "img") : [];
    if (!imgs.length) continue;
    const light = imgs.find((x) => !/화이트|white/i.test(x.alt)) || imgs[0];
    const dark = imgs.find((x) => /화이트|white/i.test(x.alt));
    signFiles[slug] = {};
    for (const [key, im, suffix] of [["light", light, ""], ["dark", dark, "-w"]]) {
      if (!im) continue;
      const rel = `profiles/sign-${slug}${suffix}${/\.svg(\?|$)/.test(im.src) ? ".svg" : ".webp"}`;
      const out = path.join(OUT, rel);
      try {
        if (!fs.existsSync(out)) {
          const res = await fetch(im.src, { headers: { "User-Agent": UA } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          fs.mkdirSync(path.dirname(out), { recursive: true });
          if (rel.endsWith(".svg")) fs.writeFileSync(out, buf);
          else await sharp(buf).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 85 }).toFile(out);
          await sleep(500);
        }
        signFiles[slug][key] = rel;
      } catch (e) {
        console.warn(`  [경고] 서명 이미지 실패 ${slug}: ${e.message}`);
      }
    }
  }

  for (const d of docList) {
    const file = path.join(SRC, "docs", d.slug + ".md");
    if (!fs.existsSync(file)) {
      console.warn(`  [경고] 문서 없음: ${d.title} (node fetch.js 로 받으세요)`);
      continue;
    }
    if (d.mergeInto) continue; // 다른 문서에 합쳐진 문서는 따로 페이지를 만들지 않는다
    const dd = parseDetail(fs.readFileSync(file, "utf8"));
    // 이미지가 본문인 문서는 받아 둔 이미지(source/doc-images.json)를 문서에 싣는다
    DOC_IMAGES = d.layout === "cards" && !d.noImages ? docImages : null;
    const url = "https://namu.wiki/w/" + encodeURIComponent(d.title).replace(/%2F/g, "/");
    let summary = "";
    const sections = [];
    const hidden = [];
    // 그룹소개: "음반" 표는 "로고" 소절과 겹치므로 읽어 두었다가 로고 카드에 합치고, 따로 소절로는 싣지 않는다
    let groupAlbums = null;
    if (d.kind === "group") {
      const albumSec = dd.sections.find((x) => x.title === "음반");
      groupAlbums = albumSec ? parseAlbumTable(mdToHtml(albumSec.md)) : null;
    }
    for (const s of dd.sections) {
      if (SKIP.has(s.title)) continue;
      if (d.kind === "group" && s.title === "여담") continue; // 안내뿐인 원문 소절은 아래에서 음반 문서의 여담으로 대신한다
      if (d.kind === "group" && s.title === "팬덤") {
        // 나무위키의 이 소절은 flover·응원법·굿즈 문서 안내뿐이다. 응원법은 "모아보기"에 있으니 빼고, flover 문서에서 팬덤 소개를 가져와 채운다.
        const fh = fandomSection(docHrefFor);
        if (fh) sections.push({ id: "팬덤", title: "팬덤", html: fh });
        continue;
      }
      if (s.hidden) {
        hidden.push({ title: s.title, md: s.md });
        continue;
      }
      let html = d.kind === "group" && s.title === "멤버" ? memberSection(s.md, profilePath, infoAll) : mdToHtml(s.md);
      if (!html) continue;
      // 숨겨진 안내 주석뿐이라 화면에 보일 내용이 없는 소절은 제목만 남지 않게 뺀다
      if (!html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").trim() && !/<img/.test(html)) continue;
      if (d.kind === "member") html = rowCards(html);
      if (d.layout === "cards") html = galleryTables(html);
      if (d.kind === "group") {
        // 그룹소개: 밋밋한 표·글 덩어리를 카드로
        const docHref = (slug) => `?view=discography&doc=${encodeURIComponent(slug)}`;
        const people = docList
          .filter((x) => x.kind === "member")
          .map((x) => ({ name: x.title.replace(/[(]프로미스나인[)]$/, ""), slug: slugify(x.title), status: x.status || "current" }));
        const coverFor = (id) => (fs.existsSync(path.join(OUT, "covers", id + ".webp")) ? `covers/${id}.webp` : "");
        if (s.title === "음반" && groupAlbums && groupAlbums.length) html = albumCards(groupAlbums, (label) => LINKS.albums[norm(label)], coverFor);
        if (s.title === "특징") html = logoGallery(html, groupLogos, (label) => LINKS.albums[norm(label)], groupAlbums, coverFor);
        if (s.title === "뮤직비디오") html = mvCards(html);
        if (s.title === "활동") html = activityCards(html, people, docHref);
      }
      if (s.title === "개요") summary = html;
      else sections.push({ id: slugify(s.title) || "sec", title: s.title, html });
    }
    // 그룹소개 맨 아래: 음반 문서에 있던 여담(초동 판매량 기록 등)
    if (d.kind === "group" && extras["여담"]) {
      const gossip = mdToHtml(extras["여담"].join("\n").trim());
      if (gossip.replace(/<[^>]*>/g, "").trim()) sections.push({ id: "여담", title: "여담", html: gossip });
    }
    // 음악 방송: 직캠 문서와 합쳐 무대마다 [무대 영상 + 그 무대의 직캠] 카드로
    if (docList.some((x) => x.mergeInto === d.title)) {
      const camDoc = docList.find((x) => x.mergeInto === d.title);
      const camFile = path.join(SRC, "docs", camDoc.slug + ".md");
      if (fs.existsSync(camFile)) {
        const camSections = parseDetail(fs.readFileSync(camFile, "utf8")).sections.filter((x) => !x.hidden).map((x) => ({ title: x.title, html: mdToHtml(x.md) }));
        const merged = mergeMusicShows(sections.map((x) => ({ title: x.title, html: x.html })), camSections);
        sections.length = 0;
        merged.forEach((m) => sections.push(m));
      }
    }
    const shown = d.title.replace(/\(프로미스나인\)$/, "").replace(/^프로미스나인\//, "프로미스나인 ");
    fs.writeFileSync(path.join(OUT, "docs", d.slug + ".json"), JSON.stringify({ slug: d.slug, title: shown, kind: d.kind, label: d.label, layout: d.layout || undefined, updated: dd.updated, profile: profilePath[d.slug] || undefined, info: buildInfo(d.slug, infoAll[d.slug], signFiles), source: { title: d.title, url }, summary, sections, hidden: hidden.length ? hidden : undefined }) + "\n", "utf8");
    docsMeta.push({ slug: d.slug, title: shown, kind: d.kind, label: d.label, layout: d.layout || undefined, nolist: d.nolist || undefined });
  }

  const idx = {
    docs: docsMeta,
    aliases: Object.fromEntries(docList.filter((x) => x.mergeInto).map((x) => [slugify(x.title), slugify(x.mergeInto)])), // 합쳐진 문서의 옛 주소 → 합친 문서
    updatedAt: new Date().toISOString().slice(0, 10),
    source: { name: "나무위키", title: "프로미스나인/음반", url: MAIN_URL, license: "CC BY-NC-SA 2.0 KR", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/" },
    albums: index.map((it) => it.meta),
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(idx) + "\n", "utf8");

  // extras: 앨범이 아닌 내용. 노래방 수록 목록은 내용이 없어 뺐고, 여담은 그룹소개로 옮겼다.
  const ex = {};
  const partKey = "방송 / OST / 참여 음반";
  if (extras[partKey]) {
    const html = await partAlbums(extras[partKey]);
    if (html) ex[partKey] = html;
  }
  fs.writeFileSync(path.join(OUT, "extras.json"), JSON.stringify(ex) + "\n", "utf8");

  // 국기 svg 내려받기 (이미 있으면 건너뜀)
  fs.mkdirSync(path.join(OUT, "flags"), { recursive: true });
  for (const [name, src] of FLAGS) {
    const out = path.join(OUT, "flags", name + ".svg");
    if (fs.existsSync(out)) continue;
    try {
      const res = await fetch(src.replace(/^\/\//, "https://"), { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      await sleep(500);
    } catch (e) {
      console.warn(`  [경고] 국기 ${name} 실패: ${e.message}`);
    }
  }

  // 커버 URL 목록(HTML 작성용 참고)
  let cov = "# 앨범 커버 원본 URL\n\n> 나무위키 문서에서 수집한 앨범 커버 이미지 주소입니다. 저작권은 각 음반사에 있으며, 사이트에는 640px 썸네일만 저장합니다 (`data/discography/covers/`).\n\n| 발매일 | 구분 | 앨범 | 커버 원본 URL | 저장 파일 |\n| --- | --- | --- | --- | --- |\n";
  for (const it of index) {
    const m = it.meta;
    cov += `| ${m.releaseDate || "-"} | ${m.seq} | ${m.title.replace(/\|/g, "\\|")} | ${m.coverSource || "(없음)"} | ${m.cover ? "data/discography/" + m.cover.file : "-"} |\n`;
  }
  fs.writeFileSync(path.join(SRC, "covers.md"), cov, "utf8");

  const size = (p) => (fs.statSync(p).size / 1024).toFixed(0) + " KB";
  console.log(`앨범 ${index.length}개 → data/discography/index.json (${size(path.join(OUT, "index.json"))})`);
  console.log(`상세 ${index.filter((i) => i.detail).length}개 · 커버 ${index.filter((i) => i.meta.cover).length}개 · extras ${Object.keys(ex).length}개`);
})();
