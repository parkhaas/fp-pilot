/* FROMIS-FLIX — 정적 팬 아카이브 프론트엔드 (빌드 도구 없음, 바닐라 JS)
   데이터: data/videos.json, data/members.json, data/meta.json
   상태는 URL 쿼리스트링(?cat=&member=&sort=&q=)에 반영해 공유 가능하게 유지 */

(() => {
  "use strict";

  const CFG = window.FF_CONFIG;
  const DATA_BASE = "data/";

  const state = {
    videos: [],
    members: [],
    meta: {},
    cat: "home",
    member: "all",
    sort: "added",
    q: "",
    limit: CFG.pageSize,
  };

  const el = {
    tabs: document.getElementById("categoryTabs"),
    memberFilter: document.getElementById("memberFilter"),
    sortSelect: document.getElementById("sortSelect"),
    search: document.getElementById("searchInput"),
    content: document.getElementById("content"),
    loading: document.getElementById("loading"),
    metaLine: document.getElementById("metaLine"),
    header: document.getElementById("siteHeader"),
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

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };

  const catLabel = (id) => {
    const c = CFG.categories.find((x) => x.id === id);
    return c ? c.label : id;
  };

  const thumbUrl = (v) =>
    v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ---------- URL 상태 ---------- */

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.cat = p.get("cat") || "home";
    state.member = p.get("member") || "all";
    state.sort = p.get("sort") || "added";
    state.q = p.get("q") || "";
    if (!CFG.categories.some((c) => c.id === state.cat)) state.cat = "home";
  }

  function writeUrl(replace) {
    const p = new URLSearchParams();
    if (state.cat !== "home") p.set("cat", state.cat);
    if (state.member !== "all") p.set("member", state.member);
    if (state.sort !== "added") p.set("sort", state.sort);
    if (state.q) p.set("q", state.q);
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

    buildTabs();
    buildMemberFilter();
    el.sortSelect.value = state.sort;
    el.search.value = state.q;

    bindEvents();
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
    let list = state.videos;

    if (state.cat !== "home") list = list.filter((v) => v.category === state.cat);

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

  /* ---------- 렌더 ---------- */

  function render() {
    el.loading?.remove();
    el.content.innerHTML = "";

    const activeMember =
      state.member !== "all" ? ` · ${memberName(state.member)}` : "";

    if (state.cat === "home" && !state.q) {
      renderHome(activeMember);
    } else {
      renderGrid(activeMember);
    }

    syncTabsUI();
    syncMemberUI();
  }

  function renderHome() {
    const rows = CFG.categories.filter((c) => c.id !== "home");
    let any = false;

    for (const row of rows) {
      let list = state.videos.filter((v) => v.category === row.id);
      if (state.member !== "all")
        list = list.filter((v) => v.members.includes(state.member));
      if (!list.length) continue;
      any = true;

      list.sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));

      const section = document.createElement("section");
      section.className = "row";
      section.innerHTML = `
        <div class="row-head">
          <h2>${row.label}</h2>
          <button class="row-more" data-cat="${row.id}">전체 보기 ›</button>
        </div>
        <div class="row-scroll"></div>`;
      const scroll = section.querySelector(".row-scroll");
      list.slice(0, CFG.homeRowSize).forEach((v) => scroll.appendChild(card(v)));
      el.content.appendChild(section);
    }

    if (!any) emptyState();
  }

  function renderGrid() {
    const list = filtered();
    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML = `<h2>${catLabel(state.cat)}${
      state.member !== "all" ? ` · ${memberName(state.member)}` : ""
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
        render();
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
      .map((m) => `<span class="badge">${memberName(m)}</span>`)
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
      <p class="empty-hint">데이터를 수집하려면 <code>crawlers/youtube_crawler.py</code> 를 실행하거나
      GitHub Actions 자동 수집을 설정하세요.</p>`;
    el.content.appendChild(d);
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
    el.modalSub.textContent = [
      catLabel(v.category),
      v.channelTitle,
      fmtDate(v.publishedAt),
    ]
      .filter(Boolean)
      .join("  ·  ");
    el.modalBadges.innerHTML = v.members
      .filter((m) => m !== "all")
      .map((m) => `<span class="badge">${memberName(m)}</span>`)
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

  /* ---------- UI 빌드 ---------- */

  function buildTabs() {
    el.tabs.innerHTML = "";
    for (const c of CFG.categories) {
      const b = document.createElement("button");
      b.className = "tab";
      b.textContent = c.label;
      b.dataset.cat = c.id;
      b.addEventListener("click", () => {
        state.cat = c.id;
        state.limit = CFG.pageSize;
        writeUrl();
        render();
      });
      el.tabs.appendChild(b);
    }
  }

  function buildMemberFilter() {
    el.memberFilter.innerHTML = "";
    const ids = ["all", ...state.members.filter((m) => m.id !== "all").map((m) => m.id)];
    for (const id of ids) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = id === "all" ? "전원" : memberName(id);
      b.dataset.member = id;
      b.addEventListener("click", () => {
        state.member = id;
        state.limit = CFG.pageSize;
        writeUrl();
        render();
      });
      el.memberFilter.appendChild(b);
    }
  }

  function syncTabsUI() {
    el.tabs.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.cat === state.cat);
    });
  }

  function syncMemberUI() {
    el.memberFilter.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("is-active", c.dataset.member === state.member);
    });
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
        writeUrl(true);
        render();
      }, 200)
    );

    el.content.addEventListener("click", (e) => {
      const more = e.target.closest(".row-more");
      if (more) {
        state.cat = more.dataset.cat;
        state.limit = CFG.pageSize;
        writeUrl();
        render();
      }
    });

    el.modal.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.modal.hidden) closeModal();
    });

    window.addEventListener("popstate", () => {
      readUrl();
      el.sortSelect.value = state.sort;
      el.search.value = state.q;
      state.limit = CFG.pageSize;
      render();
    });

    let lastY = 0;
    window.addEventListener(
      "scroll",
      () => {
        const y = window.scrollY;
        el.header.classList.toggle("is-scrolled", y > 10);
        el.header.classList.toggle("is-hidden", y > lastY && y > 240);
        lastY = y;
      },
      { passive: true }
    );
  }

  /* ---------- 보안: HTML 이스케이프 ---------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  /* ---------- PWA ---------- */

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }

  init();
})();
