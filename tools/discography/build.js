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
      if (!/^https?:\/\//.test(h)) $(e).replaceWith($(e).contents());
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
  // 유튜브 링크가 든 표(멤버별 영상 등)는 "이름 + 재생 버튼" 목록으로 바꾼다.
  // 표는 [링크 행, 이름 행]이 번갈아 나오므로 같은 칸 위치의 아래 행을 이름으로 쓴다.
  $("table").each((i, t) => {
    const rows = $(t).find("tr").toArray().map((tr) => $(tr).children("th,td").toArray());
    const isYt = (c) => $(c).find('a[href*="youtube.com/watch"]').length > 0;
    if (!rows.some((r) => r.some(isYt))) return;
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

function mdToHtml(md) {
  const noImg = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 이미지는 싣지 않는다(커버만 따로 저장)
    .replace(/^\[ (?:펼치기 · 접기|펼치기|접기) \]\s*$/gm, "");
  return sanitize(marked.parse(noImg, { gfm: true, breaks: false }));
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

/* ---------- 상세 문서 파싱 ---------- */
function parseDetail(md) {
  const body = md.replace(/^---[\s\S]*?---\n/, "").replace(/^> 이 문서는[^\n]*\n/m, "");
  const upd = body.match(/\*최근 수정 시각: ([^*]+)\*/);
  const parts = body.split(/\n(?=## )/);
  const sections = [];
  for (const p of parts) {
    const m = p.match(/^## (.+)\n?([\s\S]*)$/);
    if (m) sections.push({ title: m[1].trim(), md: m[2].trim() });
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

  for (const a of albums) {
    a.id = `${a.releaseDate || "undated"}-${slugify(a.title)}`;
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
      let summary = "";
      for (const s of dd.sections) {
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
      detail = { id: a.id, updated: dd.updated, summary, sections };
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
  const idx = {
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
