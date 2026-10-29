/* "음악 방송"(무대 영상)과 "음악 방송 직캠"(같은 무대의 직캠) 두 문서를 날짜·방송으로 무대마다 합쳐 한 화면의 카드로 만든다.
   입력은 build.js 가 두 문서에서 만든 소절 HTML(연도 소절 → 앨범 h3 → 표)이다.
   무대 하나 = (날짜, 방송 프로그램). 카드에는 방송 정보, 곡별 무대 영상 링크, 그 무대의 직캠(썸네일 포함)이 모인다. */
const cheerio = require("cheerio");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const txt = (s) => String(s).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const dbl = (t) => t.length > 1 && t.length % 2 === 0 && t.slice(0, t.length / 2) === t.slice(t.length / 2);
const norm = (s) => txt(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const lines = (h) => (h || "").split(/<br\s*\/?>/).map((x) => x.trim()).filter((x) => txt(x) || /<a /.test(x));
const ytId = (u) => {
  const m = String(u).match(/(?:youtu[.]be[/]|v=|shorts[/])([\w-]{11})/);
  return m ? m[1] : "";
};

// "MBCMBC / 쇼! 음악중심 / 쇼! 음악중심" → { cast: "MBC", show: "쇼! 음악중심" }
function parseShow(cellHtml) {
  let L = lines(cellHtml).map(txt).filter(Boolean);
  L = L.map((l) => (dbl(l) ? l.slice(0, l.length / 2) : l));
  const uniq = L.filter((l, i) => l !== L[i - 1]);
  if (uniq.length >= 2) return { cast: uniq[0], show: uniq[uniq.length - 1] };
  return { cast: "", show: uniq[0] || "" };
}

// 연도 소절(제목 "2018년") 목록 → [{ year, albums: [{ title, albumId, songsHtml, rows: [...] }] }]
function parseBroadcast(sections) {
  const out = [];
  for (const sec of sections) {
    const year = (sec.title.match(/(\d{4})/) || [])[1];
    if (!year) continue;
    const $ = cheerio.load(`<div id="r">${sec.html}</div>`, null, false);
    const albums = [];
    let cur = null;
    $("#r").children().each((i, el) => {
      const tag = el.tagName;
      if (tag === "h3") {
        cur = { title: txt($(el).html()), albumId: "", songs: "", stages: [] };
        albums.push(cur);
      } else if (tag === "ul" && cur) {
        cur.songs = $.html(el);
        cur.albumId = $(el).find("a[data-album]").first().attr("data-album") || cur.albumId;
      } else if (tag === "table" && cur) {
        cur.albumId = cur.albumId || $(el).find("a[data-album]").first().attr("data-album") || "";
        $(el).find("tbody tr").each((j, tr) => {
          if ($(tr).hasClass("dg-titlerow")) return;
          const td = $(tr).children("td").toArray();
          if (td.length < 3) return;
          const md = txt($(td[0]).text()).match(/(\d{1,2})[.](\d{1,2})/);
          if (!md) return;
          const date = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
          const vids = lines($(td[2]).html()).map((piece) => {
            const $p = cheerio.load(`<div>${piece}</div>`, null, false);
            const a = $p("a").first();
            return { href: a.attr("href") || "", cls: a.attr("class") || "", song: txt($p.root().text()) };
          }).filter((v) => v.href || v.song);
          cur.stages.push({ date, ...parseShow($(td[1]).html()), vids, note: ($(td[3]).html() || "").trim(), fancams: [] });
        });
      }
    });
    out.push({ year, title: sec.title, albums });
  }
  return out;
}

// 직캠 소절 → [{ date, show(상속 처리됨), song, label, href, kind }]
function parseFancams(sections) {
  const rows = [];
  const walk = (html, inEtc) => {
    const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
    $("#r table").each((i, t) => {
      let lastShow = { cast: "", show: "" };
      $(t).find("tbody tr").each((j, tr) => {
        if ($(tr).hasClass("dg-titlerow")) {
          lastShow = { cast: "", show: "" };
          return;
        }
        const td = $(tr).children("td").toArray();
        if (td.length < 4) return;
        const a = $(td[3]).find("a").first();
        const dateMatch = txt($(td[3]).text()).match(/(\d{4})[.](\d{2})[.](\d{2})/);
        if (!dateMatch) return;
        const songLines = lines($(td[0]).html()).map(txt);
        const kind = songLines[0] && /^[A-Z+]+$/.test(songLines[0]) ? songLines[0] : "";
        const song = songLines.filter((l) => l && l !== kind && !/^[(]원곡/.test(l)).join(" ");
        const showRaw = txt($(td[2]).text());
        let show = parseShow($(td[2]).html());
        if (showRaw === "〃") show = lastShow;
        else lastShow = show;
        const label = txt($(td[3]).html().replace(/^[\s\S]*?<br\s*\/?>/, "")) || "직캠";
        rows.push({ date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`, show: show.show, cast: show.cast, song, kind, label, href: a.attr("href") || "", etc: !!inEtc });
      });
    });
  };
  for (const sec of sections) {
    const parts = sec.html.split(/(?=<h3>)/);
    for (const p of parts) walk(p, /^<h3>기타/.test(p));
  }
  return rows;
}

const sameShow = (a, b) => {
  const x = norm(a), y = norm(b);
  return x && y && (x === y || x.includes(y) || y.includes(x));
};

function brandLink(href) {
  if (/youtu/.test(href)) return "dg-yt";
  if (/naver/.test(href)) return "dg-nv";
  return "";
}

function stageCard(st, ytThumb) {
  const [, m, d] = st.date.split("-");
  const cam = st.fancams[0];
  const thumb = cam && ytId(cam.href) ? `<span class="dg-stage-thumb"><img src="https://i.ytimg.com/vi/${ytId(cam.href)}/mqdefault.jpg" alt="${esc(cam.song || st.show)} 직캠 썸네일" loading="lazy" decoding="async"></span>` : `<span class="dg-stage-thumb is-empty"><i>${esc(st.show || "무대")}</i></span>`;
  const songs = new Map(); // 곡 → { stage: [링크], cams: [직캠] }
  const slot = (name) => {
    const k = name || "";
    if (!songs.has(k)) songs.set(k, { stage: [], cams: [] });
    return songs.get(k);
  };
  st.vids.forEach((v) => slot(v.song).stage.push(v));
  st.fancams.forEach((f) => {
    const hit = [...songs.keys()].find((k) => k && f.song && (norm(k) === norm(f.song) || norm(f.song).includes(norm(k)) || norm(k).includes(norm(f.song))));
    slot(hit !== undefined ? hit : f.song).cams.push(f);
  });
  const rows = [...songs.entries()]
    .map(([name, v]) => {
      const stageLinks = v.stage.map((s) => `<a class="dg-stage-btn ${brandLink(s.href)}" href="${esc(s.href)}" target="_blank" rel="noopener noreferrer" title="무대 영상"><span>무대</span></a>`).join("");
      const camLinks = v.cams.map((c) => `<a class="dg-stage-btn is-cam dg-yt" href="${esc(c.href)}" target="_blank" rel="noopener noreferrer" title="직캠"><span>${esc(c.label)}</span></a>`).join("");
      return `<li><b>${esc(name || "무대")}</b><span class="dg-stage-links">${stageLinks}${camLinks}</span></li>`;
    })
    .join("");
  const note = st.note && txt(st.note) ? `<p class="dg-stage-note">${st.note}</p>` : "";
  const hasCam = st.fancams.length > 0;
  return (
    `<article class="dg-stage${hasCam ? " has-cam" : ""}">` +
    thumb +
    `<div class="dg-stage-body"><header><time>${m}.${d}</time><span>${esc([st.cast, st.show].filter(Boolean).join(" · "))}</span></header>` +
    `<ul class="dg-stage-songs">${rows}</ul>${note}</div></article>`
  );
}

// 합치기: 반환 [{ id, title, html }] (연도 소절들 + "그 밖의 직캠")
function mergeMusicShows(broadcastSections, fancamSections) {
  const years = parseBroadcast(broadcastSections);
  const cams = parseFancams(fancamSections);
  const used = new Set();
  const byDate = new Map();
  years.forEach((y) => y.albums.forEach((a) => a.stages.forEach((st) => {
    if (!byDate.has(st.date)) byDate.set(st.date, []);
    byDate.get(st.date).push(st);
  })));
  cams.forEach((c, i) => {
    if (c.etc) return;
    const cands = byDate.get(c.date) || [];
    const st = cands.find((s) => sameShow(s.show, c.show)) || (cands.length === 1 ? cands[0] : null);
    if (st) {
      st.fancams.push(c);
      used.add(i);
    }
  });
  const sections = years.map((y) => {
    const body = y.albums
      .map((a) => {
        const stages = a.stages.slice().sort((p, q) => p.date.localeCompare(q.date));
        // 이 앨범 시기의 직캠 중 무대 영상 표에 없는 날짜(방송 표에 빠진 무대)는 직캠만 있는 카드로 덧붙인다
        const orphan = cams
          .map((c, i) => ({ c, i }))
          .filter(({ c, i }) => !c.etc && !used.has(i) && c.date >= (y.year + "-01-01") && c.date <= (y.year + "-12-31") && albumOwns(a, years, c.date))
          .map(({ c, i }) => { used.add(i); return c; });
        orphan.forEach((c) => {
          let st = stages.find((s) => s.date === c.date && sameShow(s.show, c.show));
          if (!st) {
            st = { date: c.date, cast: c.cast, show: c.show, vids: [], note: "", fancams: [] };
            stages.push(st);
          }
          st.fancams.push(c);
        });
        stages.sort((p, q) => p.date.localeCompare(q.date));
        const head = `<h3>${esc(a.title)}</h3>${a.songs || ""}`;
        return head + `<div class="dg-stages">${stages.map((s) => stageCard(s)).join("")}</div>`;
      })
      .join("");
    return { id: "y" + y.year, title: y.title, html: body };
  });
  // 어느 앨범에도 안 붙은 직캠(기타 + 남은 것): 연도별 "그 밖의 직캠" 카드
  const rest = cams.map((c, i) => ({ c, i })).filter(({ i }) => !used.has(i)).map(({ c }) => c);
  if (rest.length) {
    const byYear = new Map();
    rest.forEach((c) => {
      const y = c.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, new Map());
      const key = c.date + "|" + norm(c.show);
      const m = byYear.get(y);
      if (!m.has(key)) m.set(key, { date: c.date, cast: c.cast, show: c.show, vids: [], note: "", fancams: [] });
      m.get(key).fancams.push(c);
    });
    const html = [...byYear.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([y, m]) => `<h3>${y}년</h3><div class="dg-stages">${[...m.values()].sort((a, b) => a.date.localeCompare(b.date)).map((s) => stageCard(s)).join("")}</div>`)
      .join("");
    sections.push({ id: "etc", title: "그 밖의 직캠", html });
  }
  return sections;
}

// 이 앨범 구간에 해당하는 날짜인가: 앨범 첫 무대 ~ 다음 앨범 첫 무대 직전(마지막 앨범은 끝까지)
function albumOwns(album, years, date) {
  const all = [];
  years.forEach((y) => y.albums.forEach((a) => all.push(a)));
  const firsts = all.map((a) => ({ a, d: a.stages.map((s) => s.date).sort()[0] })).filter((x) => x.d);
  firsts.sort((p, q) => p.d.localeCompare(q.d));
  const i = firsts.findIndex((x) => x.a === album);
  if (i < 0) return false;
  const start = firsts[i].d;
  const end = firsts[i + 1] ? firsts[i + 1].d : "9999";
  return date >= start && date < end;
}

module.exports = { mergeMusicShows };
