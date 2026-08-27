/* FROMIS-FLIX — 정적 팬 아카이브 프론트엔드 (빌드 도구 없음, 바닐라 JS)
   데이터: data/videos.json, data/members.json, data/meta.json
   상태는 URL 쿼리스트링(?view=&cat=&member=&sort=&q=)에 반영해 공유 가능하게 유지 */

(() => {
  "use strict";

  const CFG = window.FF_CONFIG;
  const DATA_BASE = "data/";
  const REPO_URL = "https://github.com/parkhaas/fp-pilot";

  const state = {
    videos: [],
    members: [],
    meta: {},
    view: "browse", // "browse" | "about"
    cat: "home",
    member: "all",
    sort: "added",
    q: "",
    limit: CFG.pageSize,
  };

  const el = {
    sidebar: document.getElementById("sidebar"),
    nav: document.getElementById("nav"),
    hamburger: document.getElementById("hamburger"),
    drawerClose: document.getElementById("drawerClose"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    topbarTitle: document.getElementById("topbarTitle"),
    filterBar: document.getElementById("filterBar"),
    memberFilter: document.getElementById("memberFilter"),
    sortSelect: document.getElementById("sortSelect"),
    search: document.getElementById("searchInput"),
    content: document.getElementById("content"),
    loading: document.getElementById("loading"),
    metaLine: document.getElementById("metaLine"),
    topbar: document.getElementById("topbar"),
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

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  /* ---------- URL 상태 ---------- */

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.view = p.get("view") === "about" ? "about" : "browse";
    state.cat = p.get("cat") || "home";
    state.member = p.get("member") || "all";
    state.sort = p.get("sort") || "added";
    state.q = p.get("q") || "";
    if (!CFG.categories.some((c) => c.id === state.cat)) state.cat = "home";
  }

  function writeUrl(replace) {
    const p = new URLSearchParams();
    if (state.view === "about") {
      p.set("view", "about");
    } else {
      if (state.cat !== "home") p.set("cat", state.cat);
      if (state.member !== "all") p.set("member", state.member);
      if (state.sort !== "added") p.set("sort", state.sort);
      if (state.q) p.set("q", state.q);
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

    buildNav();
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

  const catCounts = () => {
    const c = {};
    for (const v of state.videos) c[v.category] = (c[v.category] || 0) + 1;
    return c;
  };

  /* ---------- 렌더 ---------- */

  function render(opts) {
    el.loading?.remove();
    el.content.innerHTML = "";

    const about = state.view === "about";
    el.filterBar.hidden = about;
    el.topbarTitle.textContent = about
      ? "소개"
      : state.cat === "home"
      ? "홈"
      : catLabel(state.cat);
    document.title = about
      ? "소개 · FROMIS-FLIX"
      : `${state.cat === "home" ? "홈" : catLabel(state.cat)} · FROMIS-FLIX`;

    if (about) renderAbout();
    else renderGrid();

    syncNavUI();
    syncMemberUI();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }

  function renderGrid() {
    const list = filtered();

    // 홈: 카테고리 바로가기 버튼 (가로 스크롤 대신 줄바꿈)
    if (state.cat === "home" && !state.q) {
      const counts = catCounts();
      const bar = document.createElement("div");
      bar.className = "cat-buttons";
      for (const c of CFG.categories) {
        if (c.id === "home") continue;
        const n = counts[c.id] || 0;
        if (!n) continue;
        const b = document.createElement("button");
        b.className = "cat-btn";
        b.dataset.cat = c.id;
        b.innerHTML = `${escapeHtml(c.label)}<span class="cat-btn-n">${n}</span>`;
        bar.appendChild(b);
      }
      el.content.appendChild(bar);
    }

    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML = `<h2>${state.cat === "home" ? "전체" : escapeHtml(catLabel(state.cat))}${
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
      <p class="empty-hint">데이터를 수집하려면 <code>crawlers/youtube_crawler.py</code> 를 실행하거나
      GitHub Actions 자동 수집을 설정하세요.</p>`;
    el.content.appendChild(d);
  }

  function renderAbout() {
    const counts = catCounts();
    const total = state.videos.length;
    const catN = Object.keys(counts).length;
    const updated = state.meta.updatedAt ? fmtDate(state.meta.updatedAt) : "―";
    const gen = state.meta.generator || "―";

    const rows = CFG.categories
      .filter((c) => c.id !== "home" && counts[c.id])
      .map((c) => `<li><span>${escapeHtml(c.label)}</span><b>${counts[c.id].toLocaleString("ko")}</b></li>`)
      .join("");

    el.content.innerHTML = `
      <section class="about">
        <h1>FROMIS-FLIX 소개</h1>
        <p class="about-lead">
          프로미스나인(fromis_9)의 영상을 한곳에서 모아보는 <strong>비영리 팬 아카이브</strong>입니다.
          <a href="https://adam-yam.github.io/SCENE-FLIX/" target="_blank" rel="noopener noreferrer">SCENE-FLIX</a>의
          구조를 참고해 만들었습니다.
        </p>

        <div class="about-stats">
          <div class="stat"><b>${total.toLocaleString("ko")}</b><span>영상</span></div>
          <div class="stat"><b>${catN}</b><span>카테고리</span></div>
          <div class="stat"><b>${updated}</b><span>마지막 업데이트</span></div>
          <div class="stat"><b>${escapeHtml(gen)}</b><span>수집 방식</span></div>
        </div>
        <ul class="about-catlist">${rows}</ul>

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

  /* ---------- UI 빌드 ---------- */

  function buildNav() {
    el.nav.innerHTML = "";
    for (const c of CFG.categories) {
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.cat = c.id;
      b.textContent = c.label;
      b.addEventListener("click", () => {
        state.view = "browse";
        state.cat = c.id;
        state.limit = CFG.pageSize;
        writeUrl();
        render();
        closeDrawer();
      });
      el.nav.appendChild(b);
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

  function syncNavUI() {
    el.nav.querySelectorAll(".nav-item").forEach((t) => {
      t.classList.toggle(
        "is-active",
        state.view === "browse" && t.dataset.cat === state.cat
      );
    });
    document
      .querySelectorAll(".nav-about")
      .forEach((b) => b.classList.toggle("is-active", state.view === "about"));
  }

  function syncMemberUI() {
    el.memberFilter.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("is-active", c.dataset.member === state.member);
    });
  }

  function goAbout() {
    state.view = "about";
    writeUrl();
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

    // 홈 화면의 카테고리 바로가기 버튼 + About 링크(푸터/사이드바)
    document.addEventListener("click", (e) => {
      const catBtn = e.target.closest(".cat-btn");
      if (catBtn) {
        state.view = "browse";
        state.cat = catBtn.dataset.cat;
        state.limit = CFG.pageSize;
        writeUrl();
        render();
        return;
      }
      const aboutBtn = e.target.closest('[data-view="about"]');
      if (aboutBtn) goAbout();
    });

    el.hamburger.addEventListener("click", openDrawer);
    el.drawerClose.addEventListener("click", closeDrawer);
    el.drawerBackdrop.addEventListener("click", closeDrawer);

    el.modal.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-close")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!el.modal.hidden) closeModal();
      else if (el.sidebar.classList.contains("is-open")) closeDrawer();
    });

    window.addEventListener("popstate", () => {
      readUrl();
      el.sortSelect.value = state.sort;
      el.search.value = state.q;
      state.limit = CFG.pageSize;
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
