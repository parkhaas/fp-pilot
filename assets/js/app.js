/* FLOVER-FLIX — 정적 팬 아카이브 프론트엔드 (빌드 도구 없음, 바닐라 JS)
   데이터: data/videos.json, data/members.json, data/meta.json
   상태는 URL 쿼리스트링(?view=&cat=&cats=&year=&song=&member=&sort=&q=)에 반영 */

(() => {
  "use strict";

  const CFG = window.FF_CONFIG;
  const DATA_BASE = "data/";
  const REPO_URL = "https://github.com/parkhaas/fp-pilot";

  const state = {
    videos: [],
    members: [],
    meta: {},
    view: "about", // "browse" | "about" (파라미터 없이 접속하면 소개가 시작 페이지)
    sel: {}, // { cat?, cats?[], year?, song? }
    subGroup: null, // 2단 드로어에서 열려 있는 그룹 id
    chartBy: "category", // 소개 페이지 파이차트 기준: "category" | "year"
    membersExpanded: false, // 멤버 필터에서 이전(탈퇴) 멤버 노출 여부
    member: "all",
    sort: "newest", // 기본 정렬: 최신 발행순
    q: "",
    limit: CFG.pageSize,
  };

  const el = {
    nav: document.getElementById("sidebar"),
    pane1: document.getElementById("navPane1"),
    pane2: document.getElementById("navPane2"),
    pane2Title: document.getElementById("navPane2Title"),
    pane2List: document.getElementById("navPane2List"),
    navBack: document.getElementById("navBack"),
    sidebar: document.getElementById("sidebar"),
    hamburger: document.getElementById("hamburger"),
    drawerClose: document.getElementById("drawerClose"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    topbarTitle: document.getElementById("topbarTitle"),
    topbar: document.getElementById("topbar"),
    filterBar: document.getElementById("filterBar"),
    memberFilter: document.getElementById("memberFilter"),
    sortSelect: document.getElementById("sortSelect"),
    search: document.getElementById("searchInput"),
    content: document.getElementById("content"),
    loading: document.getElementById("loading"),
    metaLine: document.getElementById("metaLine"),
    modal: document.getElementById("videoModal"),
    modalPlayer: document.getElementById("modalPlayer"),
    modalTitle: document.getElementById("modalTitle"),
    modalSub: document.getElementById("modalSub"),
    modalBadges: document.getElementById("modalBadges"),
    modalYtLink: document.getElementById("modalYtLink"),
  };

  /* ---------- 유틸 ---------- */

  const memberName = (id) => {
    const m = state.members.find((x) => x.id === id);
    return m ? m.name : id;
  };

  // KST(Asia/Seoul) 로 변환한 날짜/시간 파트
  const kstParts = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    if (p.hour === "24") p.hour = "00";
    return p;
  };

  // 카드/모달용: "YYYY.MM.DD HH:mm" (KST)
  const fmtDate = (iso) => {
    const p = kstParts(iso);
    return p ? `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}` : "";
  };

  // About "마지막 업데이트"용: "YYYY.MM.DD HH:mm:ss KST"
  const fmtDateTimeSec = (iso) => {
    const p = kstParts(iso);
    return p ? `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}:${p.second} KST` : "―";
  };

  const catLabel = (id) => (CFG.catLabels && CFG.catLabels[id]) || id;

  const thumbUrl = (v) =>
    v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  const yearOf = (v) => (v.publishedAt || v.addedAt || "").slice(0, 4);

  function songOf(v) {
    let t = v.title || "";
    t = t.replace(/^\s*[[(][^\])]*[\])]\s*/, ""); // 앞쪽 [..] / (..) 하나 제거
    const parts = t.split(/\s[-–—]\s/);
    let s = parts.length > 1 ? parts.slice(1).join(" - ") : t;
    s = s.split(/[[(|ㅣ]|교차편집|stage\s*mix|4k|풀캠|직캠|fancam/i)[0];
    s = s.replace(/["'"'`]/g, "").replace(/\s+/g, " ").trim();
    return s.length >= 1 && s.length <= 40 ? s : null;
  }

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  /* ---------- 선택(sel) ---------- */

  function selKey(sel) {
    return JSON.stringify({
      cat: sel.cat || null,
      cats: sel.cats ? [...sel.cats].sort() : null,
      year: sel.year || null,
      song: sel.song || null,
    });
  }

  function applySel(list, sel) {
    if (sel.cat) list = list.filter((v) => v.category === sel.cat);
    if (sel.cats) list = list.filter((v) => sel.cats.includes(v.category));
    if (sel.year) list = list.filter((v) => yearOf(v) === sel.year);
    if (sel.song) list = list.filter((v) => songOf(v) === sel.song);
    return list;
  }

  function navGroupLabel(cats) {
    const key = [...cats].sort().join(",");
    const node = (CFG.nav || []).find(
      (n) => n.sel && n.sel.cats && [...n.sel.cats].sort().join(",") === key
    );
    return node ? node.label : null;
  }

  function titleFor(sel) {
    if (sel.song) return sel.song;
    const base = sel.cat
      ? catLabel(sel.cat)
      : sel.cats
      ? navGroupLabel(sel.cats) || "자체컨텐츠"
      : "";
    if (sel.year) return base ? `${base} · ${sel.year}` : `${sel.year}년`;
    return base || "전체";
  }

  /* ---------- URL 상태 ---------- */

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const sel = {};
    if (p.get("cat")) sel.cat = p.get("cat");
    if (p.get("cats")) sel.cats = p.get("cats").split(",").filter(Boolean);
    if (p.get("year")) sel.year = p.get("year");
    if (p.get("song")) sel.song = p.get("song");
    state.sel = sel;
    state.member = p.get("member") || "all";
    state.sort = p.get("sort") || "newest";
    state.q = p.get("q") || "";

    const hasSel = sel.cat || sel.cats || sel.year || sel.song || state.q ||
      state.member !== "all";
    if (p.get("view") === "about") state.view = "about";
    else if (p.get("view") === "browse" || hasSel) state.view = "browse";
    else state.view = "about"; // 파라미터 없음 = 시작 페이지(소개)
  }

  function writeUrl(replace) {
    const p = new URLSearchParams();
    if (state.view === "about") {
      // 파라미터 없는 "/" 가 곧 소개 페이지
    } else {
      const s = state.sel;
      if (s.cat) p.set("cat", s.cat);
      if (s.cats) p.set("cats", s.cats.join(","));
      if (s.year) p.set("year", s.year);
      if (s.song) p.set("song", s.song);
      if (state.member !== "all") p.set("member", state.member);
      if (state.sort !== "newest") p.set("sort", state.sort);
      if (state.q) p.set("q", state.q);
      if (![...p].length) p.set("view", "browse"); // 필터 없는 전체보기
    }
    const qs = p.toString();
    const url = qs ? `?${qs}` : location.pathname;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }

  /* ---------- 데이터 로드 ---------- */

  async function loadJson(name, fallback) {
    try {
      const res = await fetch(DATA_BASE + name, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      console.warn(`[FF] ${name} 로드 실패`, e);
      return fallback;
    }
  }

  async function init() {
    readUrl();

    const [members, videosRaw, meta] = await Promise.all([
      loadJson("members.json", { members: [] }),
      loadJson("videos.json", { videos: [] }),
      loadJson("meta.json", {}),
    ]);

    state.members = members.members || [];
    state.meta = meta || {};
    state.videos = (videosRaw.videos || []).map(normalizeVideo);

    // 현재 선택이 속한 그룹의 2단 패널을 열어 둠
    state.subGroup = subGroupFor(state.sel);

    buildMemberFilter();
    el.sortSelect.value = state.sort;
    el.search.value = state.q;

    bindEvents();
    buildNav();
    render();
    renderMeta();
  }

  function normalizeVideo(v) {
    return {
      id: v.id || `yt:${v.videoId}`,
      videoId: v.videoId,
      title: v.title || "(제목 없음)",
      category: v.category || "variety_external",
      channelTitle: v.channelTitle || "",
      publishedAt: v.publishedAt || null,
      addedAt: v.addedAt || v.publishedAt || null,
      members: Array.isArray(v.members) && v.members.length ? v.members : ["all"],
      duration: v.duration || "",
      source: v.source || "youtube",
      _search: `${v.title || ""} ${v.channelTitle || ""}`.toLowerCase(),
    };
  }

  /* ---------- 필터/정렬 ---------- */

  function filtered() {
    let list = applySel(state.videos, state.sel);

    if (state.member !== "all")
      list = list.filter((v) => v.members.includes(state.member));

    if (state.q) {
      const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((v) => terms.every((t) => v._search.includes(t)));
    }

    const by = {
      added: (a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""),
      newest: (a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""),
      oldest: (a, b) => (a.publishedAt || "").localeCompare(b.publishedAt || ""),
      title: (a, b) => a.title.localeCompare(b.title, "ko"),
    }[state.sort];

    return [...list].sort(by);
  }

  const catCounts = () => {
    const c = {};
    for (const v of state.videos) c[v.category] = (c[v.category] || 0) + 1;
    return c;
  };

  /* ---------- 좌측 2단 내비게이션 ---------- */

  // 노드의 하위 항목 목록 [{label, sel, count}]
  function childrenOf(node) {
    const scoped = applySel(state.videos, node.sel || {});
    const kids = [];

    if (node.withAll) kids.push({ label: "전체", sel: node.sel || {} });

    if (node.children) {
      for (const cid of node.children) {
        kids.push({ label: catLabel(cid), sel: { cat: cid } });
      }
    } else if (node.subBy === "year") {
      const ys = [...new Set(scoped.map(yearOf).filter(Boolean))].sort().reverse();
      for (const y of ys) kids.push({ label: y, sel: { ...(node.sel || {}), year: y } });
    } else if (node.subBy === "song") {
      const m = new Map();
      for (const v of scoped) {
        const s = songOf(v);
        if (s) m.set(s, (m.get(s) || 0) + 1);
      }
      for (const [s] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
        kids.push({ label: s, sel: { ...(node.sel || {}), song: s } });
      }
    }

    for (const k of kids) k.count = applySel(state.videos, k.sel).length;
    return kids;
  }

  function isGroup(node) {
    return !node.divider && (node.children || node.subBy);
  }

  // 2단 패널을 보여줄 가치가 있는가?  "전체" 를 뺀 실질 하위 항목이 2개 이상일 때만.
  // (예: 이아이는요2 처럼 연도가 2026 하나뿐이면 패널 없이 바로 이동)
  function hasSub(node) {
    if (!isGroup(node)) return false;
    const real = childrenOf(node).filter((k) => {
      const isAll = node.withAll && selKey(k.sel) === selKey(node.sel);
      return !isAll && k.count > 0;
    });
    return real.length >= 2;
  }

  function nodeContainsSel(node, sel) {
    const k = selKey(sel);
    // 그룹의 base sel 이 비어 있으면(예: "기간별 보기") 그 자체로는 선택 대상이 아님 —
    // 실제 하위 항목이 일치할 때만 그룹을 활성 표시
    if (node.sel && selKey(node.sel) !== selKey({}) && selKey(node.sel) === k) return true;
    return childrenOf(node).some((c) => selKey(c.sel) === k);
  }

  // 현재 선택을 포함하는 그룹 id (없으면 null) — 2단 드로어에서 열어 둘 패널
  function subGroupFor(sel) {
    const k = selKey(sel);
    if (k === selKey({})) return null;
    for (const node of CFG.nav || []) {
      if (!isGroup(node)) continue;
      if (node.sel && selKey(node.sel) !== selKey({}) && selKey(node.sel) === k) return node.id;
      if (childrenOf(node).some((c) => selKey(c.sel) === k)) return node.id;
    }
    return null;
  }

  const navNode = (id) => (CFG.nav || []).find((n) => n.id === id);

  function navBtn(label, count, opts) {
    opts = opts || {};
    const b = document.createElement("button");
    b.className = "nav-item";
    b.innerHTML =
      `<span class="nav-label">${escapeHtml(label)}</span>` +
      (count != null ? `<span class="nav-count">${count.toLocaleString("ko")}</span>` : "") +
      (opts.drill ? '<span class="nav-drill" aria-hidden="true">›</span>' : "");
    if (opts.active) b.classList.add("is-active");
    return b;
  }

  function buildNav() {
    const activeKey = selKey(state.sel);
    const browsing = state.view === "browse";

    // --- 1단: 최상위 ---
    el.pane1.innerHTML = "";
    for (const node of CFG.nav || []) {
      if (node.divider) {
        const hr = document.createElement("hr");
        hr.className = "nav-sep";
        el.pane1.appendChild(hr);
        continue;
      }
      if (!isGroup(node)) {
        const b = navBtn(node.label, applySel(state.videos, node.sel).length, {
          active: browsing && activeKey === selKey(node.sel),
        });
        b.classList.add("nav-lv1");
        b.addEventListener("click", () => select(node.sel));
        el.pane1.appendChild(b);
        continue;
      }
      const total = applySel(state.videos, node.sel || {}).length;
      if (!total && !CFG.showEmptyGroups) continue;
      const b = navBtn(node.label, total, {
        drill: hasSub(node),
        active: browsing && (state.subGroup === node.id || nodeContainsSel(node, state.sel)),
      });
      b.classList.add("nav-lv1", "nav-grouphead");
      b.addEventListener("click", () => openSub(node));
      el.pane1.appendChild(b);
    }

    // --- 2단: 하위 ---
    const node = navNode(state.subGroup);
    if (node && hasSub(node)) {
      el.pane2Title.textContent = node.label;
      el.pane2List.innerHTML = "";
      for (const k of childrenOf(node)) {
        const isAll = node.withAll && selKey(k.sel) === selKey(node.sel);
        if (k.count === 0 && !isAll) continue;
        const cb = navBtn(k.label, k.count, {
          active: browsing && activeKey === selKey(k.sel),
        });
        cb.classList.add("nav-lv2");
        cb.addEventListener("click", () => select(k.sel));
        el.pane2List.appendChild(cb);
      }
      el.nav.classList.add("at-sub");
    } else {
      el.nav.classList.remove("at-sub");
    }
  }

  function openSub(node) {
    // 하위 항목이 2개 이상일 때만 2단 패널을 띄우고, 아니면 바로 이동
    const showPanel = hasSub(node);
    state.subGroup = showPanel ? node.id : null;

    let target = null;
    if (node.withAll && node.sel && Object.keys(node.sel).length) {
      target = { ...node.sel }; // 그룹의 "전체"
    } else if (node.subBy === "year") {
      // 연도형(withAll 없음): 패널 있으면 올해, 없으면 유일한 연도
      const years = childrenOf(node).filter((k) => k.sel.year && k.count > 0);
      if (years.length) {
        const cur = String(new Date().getFullYear());
        target = { ...((years.find((k) => k.sel.year === cur)) || years[0]).sel };
      }
    }
    if (target) {
      state.view = "browse";
      state.sel = target;
      state.limit = CFG.pageSize;
      writeUrl();
      render();
    }
    buildNav();
    if (!showPanel) closeDrawer(); // 2단 패널이 없으면 일반 항목처럼 드로어를 닫음
  }
  function closeSub() {
    state.subGroup = null;
    buildNav();
  }

  function select(sel) {
    state.view = "browse";
    state.sel = { ...sel };
    state.limit = CFG.pageSize;
    state.subGroup = subGroupFor(state.sel);
    writeUrl();
    buildNav();
    render();
    closeDrawer();
  }

  /* ---------- 렌더 ---------- */

  function render(opts) {
    el.loading?.remove();
    el.content.innerHTML = "";

    const about = state.view === "about";
    el.filterBar.hidden = about;
    el.topbarTitle.textContent = about ? "소개" : titleFor(state.sel);
    document.title = about
      ? "소개 · FLOVER-FLIX"
      : `${titleFor(state.sel)} · FLOVER-FLIX`;

    if (about) renderAbout();
    else renderGrid();

    syncMemberUI();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }

  function renderGrid() {
    const list = filtered();

    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML =
      `<h2>${escapeHtml(titleFor(state.sel))}${
        state.member !== "all" ? ` · ${escapeHtml(memberName(state.member))}` : ""
      }</h2><span class="count">${list.length.toLocaleString("ko")}개</span>`;
    el.content.appendChild(head);

    if (!list.length) {
      emptyState();
      return;
    }

    const grid = document.createElement("div");
    grid.className = "grid";
    list.slice(0, state.limit).forEach((v) => grid.appendChild(card(v)));
    el.content.appendChild(grid);

    if (list.length > state.limit) {
      const more = document.createElement("button");
      more.className = "load-more";
      more.textContent = `더 보기 (${(list.length - state.limit).toLocaleString("ko")}개 남음)`;
      more.addEventListener("click", () => {
        state.limit += CFG.pageSize;
        render({ keepScroll: true });
      });
      el.content.appendChild(more);
    }
  }

  function card(v) {
    const a = document.createElement("article");
    a.className = "card";
    a.tabIndex = 0;
    a.setAttribute("role", "button");
    a.setAttribute("aria-label", `${v.title} 재생`);

    const badges = v.members
      .filter((m) => m !== "all")
      .slice(0, 3)
      .map((m) => `<span class="badge">${escapeHtml(memberName(m))}</span>`)
      .join("");

    a.innerHTML = `
      <div class="thumb">
        <img loading="lazy" src="${thumbUrl(v)}" alt="" />
        <span class="play">▶</span>
        ${v.category === "shorts" ? '<span class="tag-shorts">SHORTS</span>' : ""}
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(v.title)}</h3>
        <p class="card-meta">
          <span>${escapeHtml(v.channelTitle)}</span>
          <span>${fmtDate(v.publishedAt)}</span>
        </p>
        ${badges ? `<div class="card-badges">${badges}</div>` : ""}
      </div>`;

    const open = () => openModal(v);
    a.addEventListener("click", open);
    a.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    return a;
  }

  function emptyState() {
    const d = document.createElement("div");
    d.className = "empty";
    d.innerHTML = `
      <p>표시할 영상이 없습니다.</p>
      <p class="empty-hint">이 분류는 아직 수집된 영상이 없습니다.
      <code>crawlers/youtube_crawler.py</code> 실행 후 채워집니다.</p>`;
    el.content.appendChild(d);
  }

  const CHART_PALETTE = [
    "#ff5fa2", "#6ec1ff", "#ffd166", "#8be28b", "#c792ea", "#ff9e64",
    "#4fd1c5", "#f8737f", "#7dd3fc", "#fcd34d", "#86efac", "#d8b4fe",
    "#fca5a5", "#a0aec0",
  ];

  // entries: [{label, value, sel?}] → 도넛 SVG + 범례 HTML
  function buildChart(entries) {
    const total = entries.reduce((s, e) => s + e.value, 0) || 1;
    const R = 15.91549431; // 둘레 ≈ 100 → dasharray 를 백분율로 사용
    let acc = 0;
    const segs = entries
      .map((e, i) => {
        const pct = (e.value / total) * 100;
        const seg = `<circle class="donut-seg" cx="21" cy="21" r="${R}" fill="none"
          stroke="${CHART_PALETTE[i % CHART_PALETTE.length]}" stroke-width="5.5"
          stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}"
          stroke-dashoffset="${(25 - acc).toFixed(3)}"
          ><title>${escapeHtml(e.label)} · ${e.value.toLocaleString("ko")} (${pct.toFixed(1)}%)</title></circle>`;
        acc += pct;
        return seg;
      })
      .join("");

    const svg = `
      <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="영상 통계 파이 그래프">
        <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--line)" stroke-width="5.5" />
        <g transform="rotate(-90 21 21)">${segs}</g>
        <text x="21" y="20.2" text-anchor="middle" class="donut-total">${total.toLocaleString("ko")}</text>
        <text x="21" y="24.4" text-anchor="middle" class="donut-cap">영상</text>
      </svg>`;

    const legend = entries
      .map((e, i) => {
        const pct = ((e.value / total) * 100).toFixed(1);
        const color = CHART_PALETTE[i % CHART_PALETTE.length];
        const data = e.sel
          ? e.sel.cat
            ? ` data-sel-cat="${escapeHtml(e.sel.cat)}"`
            : ` data-sel-year="${escapeHtml(e.sel.year)}"`
          : "";
        return `<li${data}${e.sel ? ' class="lg-link" role="button" tabindex="0"' : ""}>
          <span class="sw" style="background:${color}"></span>
          <span class="lg-label">${escapeHtml(e.label)}</span>
          <b>${e.value.toLocaleString("ko")}</b>
          <span class="lg-pct">${pct}%</span>
        </li>`;
      })
      .join("");

    return `<div class="about-chart">${svg}<ul class="chart-legend">${legend}</ul></div>`;
  }

  function chartEntries() {
    if (state.chartBy === "year") {
      const m = new Map();
      for (const v of state.videos) {
        const y = yearOf(v);
        if (y) m.set(y, (m.get(y) || 0) + 1);
      }
      return [...m.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([y, n]) => ({ label: `${y}년`, value: n, sel: { year: y } }));
    }
    const counts = catCounts();
    return Object.keys(CFG.catLabels)
      .filter((c) => counts[c])
      .sort((a, b) => counts[b] - counts[a])
      .map((c) => ({ label: catLabel(c), value: counts[c], sel: { cat: c } }));
  }

  function renderAbout() {
    const counts = catCounts();
    const total = state.videos.length;
    const catN = Object.keys(counts).length;
    const up = kstParts(state.meta.updatedAt);
    const gen = state.meta.generator || "―";

    const toggle = `
      <div class="chart-toggle" role="group" aria-label="통계 기준">
        <button data-chart="category" class="${state.chartBy === "category" ? "is-active" : ""}">카테고리별</button>
        <button data-chart="year" class="${state.chartBy === "year" ? "is-active" : ""}">연도별</button>
      </div>`;

    el.content.innerHTML = `
      <section class="about">
        <h1>FLOVER-FLIX 소개</h1>
        <p class="about-lead">
          프로미스나인(fromis_9)의 영상을 한곳에서 모아보는 <strong>비영리 팬 아카이브</strong>입니다.
        </p>

        <div class="about-stats">
          <div class="stat"><b>${total.toLocaleString("ko")}</b><span>영상</span></div>
          <div class="stat"><b>${catN}</b><span>카테고리</span></div>
          <div class="stat"><b>${up ? `${up.year}.${up.month}.${up.day}<span class="stat-time">${up.hour}:${up.minute}:${up.second} KST</span>` : "―"}</b><span>마지막 업데이트</span></div>
          <div class="stat"><b>${escapeHtml(gen)}</b><span>수집 방식</span></div>
        </div>

        <h2>영상 통계</h2>
        ${toggle}
        ${buildChart(chartEntries())}

        <h2>페이지 안내</h2>
        <p>이 페이지는 <strong>수익을 목적으로 하지 않으며</strong>, 광고를 넣을 계획이 없습니다.
        오직 프로미스나인과 flover를 위해 만들어졌습니다.</p>

        <h2>저작권</h2>
        <p>이 페이지에 표시된 각 영상의 저작권은 해당 <strong>방송국, 소속사, 그리고 각 채널·업로더</strong>에게
        있습니다. 이 사이트는 영상을 재호스팅하지 않고 YouTube 임베드로만 제공하며, 권리자의 요청이 있을 경우
        해당 항목을 즉시 삭제합니다.</p>

        <h2>데이터 출처</h2>
        <p>YouTube Data API v3를 통해 <code>@studiofromis_9</code>를 비롯한 공개 채널·재생목록의 메타데이터를
        수집합니다. 방송국 무대·직캠·스페셜 무대는 KBS·MBC·SBS·Mnet·M2·1theK·딩고뮤직 등의 공개 영상을
        검색해 선별합니다. GitHub Actions로 주기적으로 갱신됩니다.</p>

        <h2>문의</h2>
        <p>버그 제보·영상 추가 요청은
        <a href="${REPO_URL}/issues" target="_blank" rel="noopener noreferrer">GitHub 저장소</a>로 부탁드립니다.</p>

        <p class="about-made">made with love, for flover</p>
      </section>`;
  }

  function renderMeta() {
    const t = state.videos.length.toLocaleString("ko");
    const u = state.meta.updatedAt ? fmtDate(state.meta.updatedAt) : "―";
    const gen = state.meta.generator ? ` · ${state.meta.generator}` : "";
    el.metaLine.textContent = `영상 ${t}개 · 마지막 업데이트 ${u}${gen}`;
  }

  /* ---------- 모달 ---------- */

  let lastFocus = null;

  function openModal(v) {
    lastFocus = document.activeElement;
    el.modalPlayer.innerHTML = `
      <iframe
        src="https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0"
        title="${escapeHtml(v.title)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>`;
    el.modalTitle.textContent = v.title;
    el.modalSub.textContent = [catLabel(v.category), v.channelTitle, fmtDate(v.publishedAt)]
      .filter(Boolean)
      .join("  ·  ");
    el.modalBadges.innerHTML = v.members
      .filter((m) => m !== "all")
      .map((m) => `<span class="badge">${escapeHtml(memberName(m))}</span>`)
      .join("");
    el.modalYtLink.href = `https://www.youtube.com/watch?v=${v.videoId}`;

    el.modal.hidden = false;
    document.body.style.overflow = "hidden";
    el.modal.querySelector(".modal-close").focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    el.modalPlayer.innerHTML = "";
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }

  /* ---------- 드로어 ---------- */

  function openDrawer() {
    el.sidebar.classList.add("is-open");
    el.drawerBackdrop.hidden = false;
    el.hamburger.setAttribute("aria-expanded", "true");
  }
  function closeDrawer() {
    el.sidebar.classList.remove("is-open");
    el.drawerBackdrop.hidden = true;
    el.hamburger.setAttribute("aria-expanded", "false");
  }

  /* ---------- 멤버 필터 ---------- */

  function buildMemberFilter() {
    el.memberFilter.innerHTML = "";

    const mkChip = (id, label, cls) => {
      const b = document.createElement("button");
      b.className = "chip" + (cls ? " " + cls : "");
      b.textContent = label;
      b.dataset.member = id;
      b.addEventListener("click", () => {
        state.member = id;
        state.limit = CFG.pageSize;
        writeUrl();
        buildNav();
        render();
      });
      el.memberFilter.appendChild(b);
      return b;
    };

    mkChip("all", "전원");
    for (const m of state.members) {
      if (m.id === "all" || m.status === "former") continue;
      mkChip(m.id, m.name);
    }

    const former = state.members
      .filter((m) => m.status === "former")
      .sort((a, b) => (b.left || "").localeCompare(a.left || "")); // 탈퇴 역순

    if (former.length) {
      const t = document.createElement("button");
      t.className = "chip chip-toggle";
      t.type = "button";
      t.textContent = state.membersExpanded ? "− 접기" : `+ 그리고 ${former.length}`;
      t.addEventListener("click", () => {
        state.membersExpanded = !state.membersExpanded;
        buildMemberFilter();
        syncMemberUI();
      });
      el.memberFilter.appendChild(t);

      for (const m of former) mkChip(m.id, m.name, "chip-former");
    }

    el.memberFilter.classList.toggle("expanded", !!state.membersExpanded);
  }

  function syncMemberUI() {
    el.memberFilter.querySelectorAll(".chip[data-member]").forEach((c) => {
      c.classList.toggle("is-active", c.dataset.member === state.member);
    });
  }

  function goAbout() {
    state.view = "about";
    writeUrl();
    buildNav();
    render();
    closeDrawer();
  }

  /* ---------- 이벤트 ---------- */

  function bindEvents() {
    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      writeUrl();
      render();
    });

    el.search.addEventListener(
      "input",
      debounce(() => {
        state.q = el.search.value.trim();
        state.limit = CFG.pageSize;
        if (state.view === "about") state.view = "browse";
        writeUrl(true);
        render();
      }, 200)
    );

    document.addEventListener("click", (e) => {
      const aboutBtn = e.target.closest('[data-view="about"]');
      if (aboutBtn) {
        goAbout();
        return;
      }
      const chartBtn = e.target.closest("[data-chart]");
      if (chartBtn) {
        state.chartBy = chartBtn.dataset.chart;
        renderAbout();
        return;
      }
      const leg = e.target.closest("[data-sel-cat],[data-sel-year]");
      if (leg) {
        select(leg.dataset.selCat ? { cat: leg.dataset.selCat } : { year: leg.dataset.selYear });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const leg = e.target.closest("[data-sel-cat],[data-sel-year]");
      if (leg) {
        e.preventDefault();
        select(leg.dataset.selCat ? { cat: leg.dataset.selCat } : { year: leg.dataset.selYear });
      }
    });

    el.hamburger.addEventListener("click", openDrawer);
    el.drawerClose.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);
    el.navBack.addEventListener("click", closeSub);

    el.modal.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!el.modal.hidden) closeModal();
      else if (el.nav.classList.contains("at-sub")) closeSub();
      else if (el.sidebar.classList.contains("is-open")) closeDrawer();
    });

    window.addEventListener("popstate", () => {
      readUrl();
      el.sortSelect.value = state.sort;
      el.search.value = state.q;
      state.limit = CFG.pageSize;
      state.subGroup = subGroupFor(state.sel);
      buildNav();
      render();
    });

    window.addEventListener(
      "scroll",
      () => el.topbar.classList.toggle("is-scrolled", window.scrollY > 4),
      { passive: true }
    );
  }

  /* ---------- PWA ---------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }

  init();
})();
