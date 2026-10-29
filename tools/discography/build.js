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
const sharp = require("sharp");
const { hidePointers, isPointerOnly } = require("./lib/pointers");

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
  return html.replace(/>([^<]*)</g, (m, t) => ">" + t.replace(/ *[[][0-9]{1,3}[\]]/g, "") + "<");
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

function mdToHtml(md) {
  const noImg = md
    // 국기 이미지(링크로 감싼 것 포함)는 자리표시로 바꿔 두었다가 sanitize 뒤에 <img> 로 넣는다
    .replace(/\[?!\[([^\]]*국기)\]\(([^)\s]+)\)(?:\]\((?:[^()\s]|\([^()]*\))+(?: "[^"]*")?\))?/g, (m, alt, src) => {
      const n = flagName(alt);
      FLAGS.set(n, src);
      return `@@FLAG:${n}:${alt.replace(/[@:]/g, "")}@@`;
    })
    // 이미지로만 된 문서 링크 [![alt](이미지)](주소 "문서 이름"): 이미지는 빼고 문서 이름을 글자로 남긴다 (표의 방송·채널·앨범 칸)
    .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(((?:[^()\s]|\([^()]*\))+)(?: "([^"]*)")?\)/g, (m, alt, url, title) => {
      const label = (title || alt || "").replace(/^\[+|\]+$/g, "").replace(/\([^)]*\)\s*$/, "").replace(/\s*(로고|아이콘).*$/, "").trim();
      return label ? `[${label}](${url})` : "";
    })
    // 이미지는 싣지 않는다(커버·프로필만 따로 저장). 다만 방송·채널 "로고" 이미지는 이름표 역할이라 alt 글자로 대신한다.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (/로고\s*$|로고[ (]/.test(alt) ? alt.replace(/\([^)]*\)/g, "").replace(/\s*로고.*$/, "").trim() : ""))
    .replace(/^\[ (?:펼치기 · 접기|펼치기|접기) \]\s*$/gm, "")
    .replace(/(\S)\[\d{1,3}\](?!\()/g, "$1"); // 각주 번호([13] 등)는 각주 본문을 싣지 않으므로 뺀다
  return stripFootnotes(brandLinks(sanitize(marked.parse(noImg, { gfm: true, breaks: false })).replace(/@@FLAG:([^:@]+):([^@]*)@@/g, (m, n, label) => flagImg(n, label))));
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
function memberSection(md, profilePath) {
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

  const card = (m) => {
    const slug = LINKS.docs[norm(m.name)];
    const img = slug && profilePath[slug];
    const link = (inner, cls) => (slug ? `<a class="${cls}" href="?view=discography&doc=${encodeURIComponent(slug)}" data-doc="${slug}">${inner}</a>` : inner);
    return (
      `<li class="dg-member">` +
      link(img ? `<img src="data/discography/${img}" alt="${m.name} 프로필 사진" loading="lazy" decoding="async">` : `<span class="dg-member-noimg"></span>`, "dg-member-photo") +
      `<div class="dg-member-info"><h4>${link(m.name, "dg-member-name")}</h4>` +
      (m.birth ? `<p class="dg-member-birth">${m.flag ? flagImg(m.flag.name, m.flag.label) : ""}${m.birth.replace(/-/g, ".")} (${ageOf(m.birth)}세)</p>` : "") +
      (m.pos.length ? `<p class="dg-member-pos">${m.pos.map((p) => `<span>${p.replace(/ *[[][0-9]{1,3}[\]]/g, "")}</span>`).join("")}</p>` : "") +
      (m.left ? `<p class="dg-member-left">탈퇴 ${m.left.replace(/-/g, ".")}</p>` : "") +
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
    (noteHtml ? `<details class="dg-note"><summary>포지션 관련 참고 사항</summary><div class="dg-prose">${noteHtml}</div></details>` : "") +
    `<h3>전 멤버</h3>${list("former")}`
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
    html = brandLinks(html);
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
async function getCover(album) {
  if (!album.coverSource) return null;
  const outFile = path.join(OUT, "covers", album.id + ".webp");
  if (!redoCovers && fs.existsSync(outFile)) {
    const meta = await sharp(outFile).metadata();
    return { file: `covers/${album.id}.webp`, w: meta.width, h: meta.height };
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
  return { file: `covers/${album.id}.webp`, w: info.width, h: info.height };
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
    const dd = parseDetail(fs.readFileSync(file, "utf8"));
    const url = "https://namu.wiki/w/" + encodeURIComponent(d.title).replace(/%2F/g, "/");
    let summary = "";
    const sections = [];
    const hidden = [];
    for (const s of dd.sections) {
      if (SKIP.has(s.title)) continue;
      if (s.hidden) {
        hidden.push({ title: s.title, md: s.md });
        continue;
      }
      const html = d.kind === "group" && s.title === "멤버" ? memberSection(s.md, profilePath) : mdToHtml(s.md);
      if (!html) continue;
      if (s.title === "개요") summary = html;
      else sections.push({ id: slugify(s.title) || "sec", title: s.title, html });
    }
    const shown = d.title.replace(/\(프로미스나인\)$/, "").replace(/^프로미스나인\//, "프로미스나인 ");
    fs.writeFileSync(path.join(OUT, "docs", d.slug + ".json"), JSON.stringify({ slug: d.slug, title: shown, kind: d.kind, label: d.label, updated: dd.updated, profile: profilePath[d.slug] || undefined, info: buildInfo(d.slug, infoAll[d.slug], signFiles), source: { title: d.title, url }, summary, sections, hidden: hidden.length ? hidden : undefined }) + "\n", "utf8");
    docsMeta.push({ slug: d.slug, title: shown, kind: d.kind, label: d.label });
  }

  const idx = {
    docs: docsMeta,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: { name: "나무위키", title: "프로미스나인/음반", url: MAIN_URL, license: "CC BY-NC-SA 2.0 KR", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/2.0/kr/" },
    albums: index.map((it) => it.meta),
  };
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(idx) + "\n", "utf8");

  // extras: 앨범이 아닌 내용
  const ex = {};
  for (const [k, ls] of Object.entries(extras)) {
    if (["국내 음반", "일본 음반"].includes(k)) continue;
    const md = ls.join("\n").trim();
    if (md) ex[k] = mdToHtml(md);
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
