/* FLOVER-FLIX — 디스코그래피 뷰 (바닐라 JS)
   데이터: data/discography/index.json (목록), albums/<id>.json (앨범 상세), extras.json (그 밖의 기록)
   app.js 가 FFDiscography.render(container, { album, onNav }) 로 부른다.
   데이터는 tools/discography 의 build.js 가 만든다. 출처: 나무위키(CC BY-NC-SA 2.0 KR) */

(() => {
  "use strict";

  const BASE = "data/discography/";
  const FILTERS = [
    { id: "all", label: "전체" },
    { id: "정규", label: "정규" },
    { id: "EP", label: "미니 앨범" },
    { id: "싱글", label: "싱글" },
    { id: "일본", label: "일본" },
  ];

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dotDate = (d) => (d || "").replace(/-/g, ".");
  const href = (id) => (id ? `?view=discography&album=${encodeURIComponent(id)}` : "?view=discography");

  let indexData = null;
  const detailCache = {};
  let extrasData = null;
  let filter = "all";
  let boundRoot = null;
  let opts = {};

  async function getJson(name) {
    const res = await fetch(BASE + name, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  /* ---------- 조각 ---------- */

  function coverImg(a, cls) {
    if (!a.cover) {
      return `<div class="dg-nocover ${cls || ""}" role="img" aria-label="${esc(a.title)} — 커버 없음"><i data-lucide="disc-3"></i></div>`;
    }
    return `<img class="${cls || ""}" src="${BASE + a.cover.file}" width="${a.cover.w}" height="${a.cover.h}" alt="${esc(a.title)} 앨범 커버" loading="lazy" decoding="async" />`;
  }

  function kindLine(a) {
    return [a.seq, a.label].filter(Boolean).map(esc).join(" · ");
  }

  function metaLine(a) {
    if (a.status === "cancelled") return `<span>${dotDate(a.releaseDate)} 예정</span><span class="dg-flag">발매 무산</span>`;
    const parts = [`<span>${dotDate(a.releaseDate)}</span>`, `<span>${a.trackCount}곡</span>`];
    if (a.runtime && /^\d+:\d+/.test(a.runtime)) parts.push(`<span>${esc(a.runtime)}</span>`);
    return parts.join("");
  }

  function creditsHtml(t) {
    const keys = Object.keys(t.credits || {});
    if (!keys.length) return "";
    return `<dl class="dg-credits">${keys.map((k) => `<div><dt>${esc(k)}</dt><dd>${t.credits[k].map(esc).join(", ")}</dd></div>`).join("")}</dl>`;
  }

  function trackList(a, notes) {
    return `<ol class="dg-tracklist">${a.tracks
      .map((t) => {
        const note = notes && notes[t.no];
        const head =
          `<span class="dg-tno">${String(t.no).padStart(2, "0")}</span>` +
          `<span class="dg-tname">${esc(t.title)}${t.isTitle ? '<span class="badge">타이틀</span>' : ""}</span>` +
          `<span class="dg-trun">${esc(t.runtime)}</span>`;
        if (!note) return `<li class="dg-track"><div class="dg-trow">${head}</div>${creditsHtml(t)}</li>`;
        return (
          `<li class="dg-track has-note"><details><summary class="dg-trow">${head}<i data-lucide="chevron-down" class="dg-chev"></i></summary>` +
          `${creditsHtml(t)}<div class="dg-prose dg-tnote">${note}</div></details></li>`
        );
      })
      .join("")}</ol>`;
  }

  const sourceNote =
    `<p class="dg-source">음반 정보는 <a href="https://namu.wiki/w/%ED%94%84%EB%A1%9C%EB%AF%B8%EC%8A%A4%EB%82%98%EC%9D%B8/%EC%9D%8C%EB%B0%98" target="_blank" rel="noopener noreferrer">나무위키 ‘프로미스나인/음반’</a>과 각 앨범 문서를 ` +
    `<a href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 2.0 KR</a> 조건에 따라 정리한 것입니다(원 저작자: 나무위키 기여자, 비영리, 동일 조건 공유). ` +
    `앨범 커버의 저작권은 각 음반사에 있습니다.</p>`;

  /* ---------- 목록 ---------- */

  function matches(a) {
    if (filter === "all") return true;
    if (filter === "일본") return a.region === "japan";
    return a.region === "korea" && a.group === filter;
  }

  function cardHtml(a) {
    const tt = a.titleTracks.length ? `<p class="dg-tt"><span>타이틀곡</span>${a.titleTracks.map(esc).join(", ")}</p>` : "";
    const canOpen = a.tracks.length > 0;
    return (
      `<article class="dg-card${a.status === "cancelled" ? " is-cancelled" : ""}" data-id="${esc(a.id)}">` +
      `<a class="dg-cover" href="${href(a.id)}" data-album="${esc(a.id)}" tabindex="-1" aria-hidden="true">${coverImg(a)}</a>` +
      `<div class="dg-body">` +
      `<p class="dg-kind">${kindLine(a)}</p>` +
      `<h4 class="dg-title"><a href="${href(a.id)}" data-album="${esc(a.id)}">${esc(a.title)}</a></h4>` +
      `<p class="dg-meta">${metaLine(a)}</p>${tt}` +
      `<div class="dg-actions">` +
      (canOpen
        ? `<button type="button" class="dg-btn" data-toggle aria-expanded="false"><i data-lucide="list-music"></i>수록곡</button>`
        : "") +
      `<a class="dg-btn dg-btn-fill" href="${href(a.id)}" data-album="${esc(a.id)}">자세히 보기<i data-lucide="arrow-right"></i></a>` +
      `</div></div>` +
      `<div class="dg-expand" hidden>${canOpen ? trackList(a) : ""}</div>` +
      `</article>`
    );
  }

  function listHtml() {
    const albums = indexData.albums.filter(matches); // index.json 은 최신순
    const chips = FILTERS.map((f) => {
      const n = indexData.albums.filter((a) => (f.id === "all" ? true : f.id === "일본" ? a.region === "japan" : a.region === "korea" && a.group === f.id)).length;
      return `<button type="button" class="dg-chip${filter === f.id ? " is-active" : ""}" data-filter="${f.id}" aria-pressed="${filter === f.id}">${f.label}<span>${n}</span></button>`;
    }).join("");

    const years = [];
    for (const a of albums) {
      const y = (a.releaseDate || "").slice(0, 4) || "미정";
      if (!years.length || years[years.length - 1].y !== y) years.push({ y, items: [] });
      years[years.length - 1].items.push(a);
    }
    const body = years.length
      ? years.map((g) => `<section class="dg-year"><h3 class="dg-year-h">${g.y}</h3><div class="dg-list">${g.items.map(cardHtml).join("")}</div></section>`).join("")
      : `<div class="empty"><p>조건에 맞는 앨범이 없습니다.</p></div>`;

    return (
      `<div class="grid-head"><h2>Discography</h2><span class="grid-count">앨범 ${albums.length}개 · 최신순</span></div>` +
      `<div class="dg-filters" role="group" aria-label="앨범 종류">${chips}</div>` +
      `<div class="dg-years">${body}</div>` +
      docsHtml() +
      `<section class="dg-extras" id="dgExtras"></section>` +
      sourceNote
    );
  }

  /* ---------- 주요 문서 (그룹·멤버·응원법 …) ---------- */

  const docHref = (slug) => `?view=discography&doc=${encodeURIComponent(slug)}`;

  function docsHtml() {
    const docs = indexData.docs || [];
    if (!docs.length) return "";
    const group = (kind, title) => {
      const items = docs.filter((d) => d.kind === kind);
      if (!items.length) return "";
      return `<div class="dg-doc-row"><h4>${title}</h4><div class="dg-doc-links">${items
        .map((d) => `<a class="dg-doc" href="${docHref(d.slug)}" data-doc="${esc(d.slug)}">${esc(kind === "guide" ? d.label : d.title)}</a>`)
        .join("")}</div></div>`;
    };
    return `<section class="dg-docs"><h3 class="dg-extras-h">프로미스나인 문서</h3>${group("group", "그룹")}${group("member", "멤버")}${group("guide", "모아보기")}</section>`;
  }

  // 멤버 인물 정보(이름·출생·국적·본관·신체·가족·학력·상징 색·MBTI·좌우명·서명·링크 …) 카드
  function profileCard(info) {
    return `<section class="dg-profile" aria-label="인물 정보"><dl>${info.rows.map((r) => `<div><dt>${esc(r.k)}</dt><dd>${r.html}</dd></div>`).join("")}</dl></section>`;
  }

  async function docPageHtml(slug) {
    let d;
    try {
      d = detailCache["doc:" + slug] = detailCache["doc:" + slug] || (await getJson(`docs/${slug}.json`));
    } catch (e) {
      return null;
    }
    const sec = (s, open) =>
      `<details class="dg-sec"${open ? " open" : ""}><summary><span>${esc(s.title)}</span><i data-lucide="chevron-down" class="dg-chev"></i></summary><div class="dg-prose">${s.html}</div></details>`;
    const toc = d.sections.length > 1 ? `<p class="dg-doc-count">${d.sections.length}개 항목 · 눌러서 펼치기</p>` : "";
    const headInner =
      `<p class="dg-kind">${esc(d.label)}</p><h2 class="dg-hero-title">${esc(d.title)}</h2>` +
      (d.info && (d.info.name.hanja || d.info.name.en) ? `<p class="dg-names">${[d.info.name.hanja, d.info.name.en].filter(Boolean).map(esc).join(" <span>｜</span> ")}</p>` : "") +
      (d.updated ? `<p class="dg-meta"><span>원문 최근 수정 ${esc(d.updated)}</span></p>` : "");
    const head = `<header class="dg-doc-head">${headInner}</header>`;
    return {
      title: d.title,
      html:
        `<a class="dg-back" href="${href()}" data-album=""><i data-lucide="arrow-left"></i>Discography</a>` +
        (d.profile && d.info
          ? `<div class="dg-member-hero"><img class="dg-hero-photo" src="${BASE + d.profile}" alt="${esc(d.title)} 프로필 사진"><div class="dg-hero-side">${head}${profileCard(d.info)}</div></div>`
          : `<header class="dg-doc-head${d.profile ? " has-photo" : ""}">` +
            (d.profile ? `<img class="dg-doc-photo" src="${BASE + d.profile}" alt="${esc(d.title)} 프로필 사진">` : "") +
            `<div>${headInner}</div></header>` + (d.info ? profileCard(d.info) : "")) +
        (d.summary ? `<div class="dg-prose dg-summary dg-doc-summary">${d.summary}</div>` : "") +
        toc +
        d.sections.map((s, i) => sec(s, i === 0)).join("") +
        `<p class="dg-source">이 문서는 <a href="${esc(d.source.url)}" target="_blank" rel="noopener noreferrer">나무위키 ‘${esc(d.source.title)}’</a>의 내용을 ` +
        `<a href="https://creativecommons.org/licenses/by-nc-sa/2.0/kr/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 2.0 KR</a> 조건에 따라 정리한 것입니다(원 저작자: 나무위키 기여자, 비영리, 동일 조건 공유).</p>`,
    };
  }

  async function loadExtras(root) {
    const host = root.querySelector("#dgExtras");
    if (!host) return;
    host.innerHTML =
      `<h3 class="dg-extras-h">그 밖의 기록</h3>` +
      [
        ["방송 / OST / 참여 음반", "방송·OST·참여 음반"],
        ["여담", "여담"],
        ["노래방 수록 목록", "노래방 수록 목록"],
      ]
        .map(([k, label]) => `<details class="dg-sec" data-extra="${esc(k)}"><summary><span>${label}</span><i data-lucide="chevron-down" class="dg-chev"></i></summary><div class="dg-prose dg-extra-body"></div></details>`)
        .join("");
    window.lucide && window.lucide.createIcons();
  }

  /* ---------- 상세 ---------- */

  async function detailHtml(a) {
    let d = detailCache[a.id];
    if (!d && a.hasDetail) {
      try {
        d = detailCache[a.id] = await getJson(`albums/${a.id}.json`);
      } catch (e) {
        d = null;
      }
    }
    const sections = (d && d.sections) || [];
    const intro = sections.filter((s) => s.id === "앨범-소개");
    const rest = sections.filter((s) => s.id !== "앨범-소개" && s.id !== "tracks");
    const sec = (title, html, open) =>
      `<details class="dg-sec"${open ? " open" : ""}><summary><span>${esc(title)}</span><i data-lucide="chevron-down" class="dg-chev"></i></summary><div class="dg-prose">${html}</div></details>`;

    const nav = indexData.albums;
    const i = nav.findIndex((x) => x.id === a.id);
    const newer = nav[i - 1];
    const older = nav[i + 1];
    const pn = (x, dir) =>
      x
        ? `<a class="dg-pn dg-pn-${dir}" href="${href(x.id)}" data-album="${esc(x.id)}"><span>${dir === "prev" ? "이전 앨범" : "다음 앨범"}</span><b>${esc(x.title)}</b></a>`
        : "<span></span>";

    return (
      `<a class="dg-back" href="${href()}" data-album=""><i data-lucide="arrow-left"></i>Discography</a>` +
      `<header class="dg-hero">${coverImg(a, "dg-hero-cover")}` +
      `<div class="dg-hero-info"><p class="dg-kind">${kindLine(a)}</p><h2 class="dg-hero-title">${esc(a.title)}</h2>` +
      `<p class="dg-meta">${metaLine(a)}</p>` +
      (a.titleTracks.length ? `<p class="dg-tt"><span>타이틀곡</span>${a.titleTracks.map(esc).join(", ")}</p>` : "") +
      (d && d.summary ? `<div class="dg-prose dg-summary">${d.summary}</div>` : "") +
      `</div></header>` +
      (a.note ? `<div class="dg-prose dg-notice">${a.note}</div>` : "") +
      (a.tracks.length
        ? sec("수록곡", trackList(a, d && d.trackNotes), true)
        : "") +
      intro.map((s) => sec(s.title, s.html, true)).join("") +
      rest.map((s) => sec(s.title, s.html, false)).join("") +
      `<nav class="dg-pager" aria-label="앨범 이동">${pn(newer, "prev")}${pn(older, "next")}</nav>` +
      (a.namu ? `<p class="dg-source">이 앨범의 자세한 문서: <a href="${esc(a.namu.url)}" target="_blank" rel="noopener noreferrer">나무위키 ‘${esc(a.namu.title)}’</a>${d && d.updated ? ` (원문 최근 수정 ${esc(d.updated)})` : ""}</p>` : "") +
      sourceNote
    );
  }

  /* ---------- 진입점 ---------- */

  function bind(root) {
    if (boundRoot === root) return;
    boundRoot = root;
    root.addEventListener("click", async (e) => {
      const dl = e.target.closest("[data-doc]");
      if (dl && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) {
        e.preventDefault();
        opts.onNav && opts.onNav(null, dl.dataset.doc);
        return;
      }
      const nav = e.target.closest("[data-album]");
      if (nav && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) {
        e.preventDefault();
        opts.onNav && opts.onNav(nav.dataset.album || null);
        return;
      }
      const chip = e.target.closest("[data-filter]");
      if (chip) {
        filter = chip.dataset.filter;
        paintList(root);
        return;
      }
      const tg = e.target.closest("[data-toggle]");
      if (tg) {
        const box = tg.closest(".dg-card").querySelector(".dg-expand");
        const open = box.hidden;
        box.hidden = !open;
        tg.setAttribute("aria-expanded", String(open));
        tg.classList.toggle("is-open", open);
        window.lucide && window.lucide.createIcons();
      }
    });
    root.addEventListener(
      "toggle",
      async (e) => {
        const d = e.target;
        if (!d.matches || !d.matches("details[data-extra]") || !d.open || d.dataset.ready) return;
        d.dataset.ready = "1";
        try {
          extrasData = extrasData || (await getJson("extras.json"));
          d.querySelector(".dg-extra-body").innerHTML = extrasData[d.dataset.extra] || "<p>내용이 없습니다.</p>";
        } catch (err) {
          d.querySelector(".dg-extra-body").innerHTML = "<p>불러오지 못했습니다. 잠시 뒤 다시 열어 보세요.</p>";
          delete d.dataset.ready;
        }
      },
      true
    );
  }

  function paintList(root) {
    root.innerHTML = `<div class="dg">${listHtml()}</div>`;
    loadExtras(root);
    window.lucide && window.lucide.createIcons();
  }

  async function render(root, o) {
    opts = o || {};
    bind(root);
    root.innerHTML = `<div class="dg"><p class="dg-loading">불러오는 중…</p></div>`;
    try {
      indexData = indexData || (await getJson("index.json"));
    } catch (e) {
      root.innerHTML = `<div class="empty"><p>디스코그래피 데이터를 불러오지 못했습니다.</p></div>`;
      return null;
    }
    if (opts.doc) {
      const r = await docPageHtml(opts.doc);
      if (boundRoot !== root) return null;
      if (r) {
        root.innerHTML = `<div class="dg dg-detail">${r.html}</div>`;
        window.lucide && window.lucide.createIcons();
        return r.title;
      }
    }
    const a = opts.album && indexData.albums.find((x) => x.id === opts.album);
    if (a) {
      const html = await detailHtml(a);
      if (boundRoot !== root) return a.title;
      root.innerHTML = `<div class="dg dg-detail">${html}</div>`;
      window.lucide && window.lucide.createIcons();
      return a.title;
    }
    paintList(root);
    return null;
  }

  window.FFDiscography = { render, count: () => (indexData ? indexData.albums.length : null), preload: () => getJson("index.json").then((d) => (indexData = d)).catch(() => null) };
})();
