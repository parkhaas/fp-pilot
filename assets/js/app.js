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
    sel: {}, // { cat?, cats?[], year?, song?, member? }
    subGroup: null, // 2단 드로어에서 열려 있는 그룹 id
    chartBy: "category", // 소개 페이지 파이차트 기준: "category" | "year"
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
    themeToggle: document.getElementById("themeToggle"),
    topbarTitle: document.getElementById("topbarTitle"),
    topbar: document.getElementById("topbar"),
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

  const paintIcons = () => {
    try { window.lucide && window.lucide.createIcons(); } catch (e) {}
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

  const catLabel = (id) => (CFG.catLabels && CFG.catLabels[id]) || id;

  const thumbUrl = (v) =>
    v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  const yearOf = (v) => (v.publishedAt || v.addedAt || "").slice(0, 4);

  /* ---------- 곡명 파서 ----------
     방송사 무대·직캠 제목은 형식이 제각각(곡-그룹 / 그룹-곡 / 따옴표 곡명 /
     대시 없는 팬캠 등)이라, 멤버명·그룹명·촬영수식어를 걷어내고 곡만 남긴다.
     추정 실패 시 null → 곡 서브메뉴에서 제외된다. */

  const GROUP_RX = /fromis[\s_]?9|프로미스[\s_]?9|프로미스\s?나인|프미나|프나(?![가-힣])/i;

  let _memberRx = null;
  function memberRx() {
    if (_memberRx) return _memberRx;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const frag = [];
    for (const m of state.members) {
      if (m.id === "all") continue;
      for (const a of [m.name, ...(m.aliases || [])]) {
        if (/[가-힣]/.test(a) && a.length >= 2) frag.push(esc(a));
      }
    }
    frag.push(
      "song\\s*ha\\s*young", "park\\s*ji\\s*won", "lee\\s*chae\\s*young",
      "lee\\s*na\\s*(?:gyung|kyung|gyoung|young)", "baek\\s*ji\\s*heon",
      "lee\\s*sae\\s*rom", "(?:roh|no)\\s*ji\\s*sun", "lee\\s*seo\\s*yeon",
      "jang\\s*gyu\\s*ri"
    );
    _memberRx = new RegExp("(?:" + frag.join("|") + ")", "i");
    return _memberRx;
  }

  const SONG_CUT_RX = /교차편집|stage\s*mix|풀캠|직캠|fullcam|fancam|facecam|얼빡|choreo(?:graphy)?|interview|bonus\s*ver|band\s*ver|one\s*take|1위|앵콜|encore|방송|with\s*flover|미방분|사전녹화|비하인드|모음|\.?zip\b|comeback\s*special|stage\s*comp\w*|playlist|compilation|making|메이킹|8k|4k|hdr|spatial\s*audio|killing\s*part|킬링파트|몰아보기|모아보기|다시보기|풀버전|full\s*ver|하이라이트|highlight/i;
  const SONG_DELIM_RX = /[[(（【|ㅣ│｜/@]|\sl\s|\s#|♬|♪|★|☆|✨|☀|❤|💙/i;
  const SONG_TRAIL_RX = /(?:\s+(?:fancam|fullcam|facecam|cam|mv|풀캠|직캠|ver\.?))+$/i;
  const SONG_EDGE_L = /^[\s'"‘’“”–—―:_.,·-]+/; // 선행 # 은 곡명 일부일 수 있어 보존(#menow)
  const SONG_EDGE_R = /[\s'"‘’“”–—―:_.,·-]+$/;
  const SONG_STOP = new Set([
    "interview", "behind", "zip", "comeback", "special", "compilation", "playlist",
    "모음", "방송", "직캠", "풀캠", "fancam", "cam", "making", "메이킹", "현장",
    "ver", "mv", "teaser", "shorts", "stage", "프로", "프나", "프미나",
  ]);
  const SONG_CANON = {
    "talk&talk": "Talk & Talk", "talk & talk": "Talk & Talk",
    "love bomb": "LOVE BOMB",
    "dkdk": "두근두근", "두근두근": "두근두근", "dkdk 두근두근": "두근두근",
    "menow": "#menow", "#menow": "#menow",
    "white memories": "하얀 그리움", "하얀 그리움": "하얀 그리움",
    "glass shoes": "유리구두", "유리구두": "유리구두",
    "into the new world": "다시 만난 세계", "다시 만난 세계": "다시 만난 세계",
    "22century girl": "22세기 소녀", "22세기 소녀": "22세기 소녀",
  };

  function songOf(v) {
    let t = (v.title || "")
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/＃/g, "#");
    t = t.replace(/^\s*(?:[[(（【][^\])）】]*[\])）】]\s*)+/, ""); // 선행 태그 대괄호 제거
    t = t
      .replace(/^\s*\d{6,8}\s*/, "")
      .replace(/^\s*\d{2,4}[./]\d{1,2}[./]\d{1,2}\s*/, ""); // 날짜 접두 제거

    let cand = null;
    const mq = t.match(/'([^']{1,45})'/);
    if (mq && !GROUP_RX.test(mq[1]) && !/fancam|facecam|choreo|직캠|interview/i.test(mq[1])) {
      cand = mq[1]; // 따옴표 곡명 우선
    }
    if (cand == null) {
      const segs = t.split(/\s[-–—―]\s/).map((s) => s.trim()).filter(Boolean);
      if (segs.length >= 2) {
        const fg = GROUP_RX.test(segs[0]);
        const sg = GROUP_RX.test(segs[1]);
        cand = fg && !sg ? segs[1] : sg && !fg ? segs[0] : segs[1];
      } else if (segs.length) {
        cand = segs[0];
      }
    }
    if (cand == null) return null;

    for (const rx of [SONG_DELIM_RX, SONG_CUT_RX]) {
      const m = cand.match(rx);
      if (m) cand = cand.slice(0, m.index);
    }

    const mrx = memberRx();
    let prev = null;
    while (prev !== cand) {
      prev = cand;
      cand = cand.replace(SONG_EDGE_L, "").replace(SONG_EDGE_R, "");
      cand = cand.replace(GROUP_RX, "");
      const c2 = cand.replace(mrx, "");
      if (c2 !== cand) cand = c2;
    }
    const m2 = cand.match(SONG_CUT_RX);
    if (m2) cand = cand.slice(0, m2.index);
    cand = cand.replace(/\((?:원곡|band\s*ver|feat)[^)]*\)?/gi, "");
    cand = cand.replace(SONG_TRAIL_RX, "");
    cand = cand.replace(/\s*([&+])\s*/g, " $1 ").replace(/\s+/g, " ");
    cand = cand.replace(SONG_EDGE_L, "").replace(SONG_EDGE_R, "");

    if (!cand || cand.length < 2 || cand.length > 40) return null;
    if (GROUP_RX.test(cand)) return null;
    if (/^[가-힣]{1,2}$/.test(cand)) return null;
    const mm = cand.match(mrx);
    if (mm && mm[0].length / cand.length > 0.6) return null;
    if (SONG_STOP.has(cand.toLowerCase().replace(/[!?.,\s]+$/, ""))) return null;
    if (!/[\p{L}\p{N}]/u.test(cand)) return null; // 문자/숫자 하나도 없으면(기호뿐) 버림
    if (/^ep[.\s]/i.test(cand)) return null;
    if (cand.split(/\s+/).length >= 5 && !/[+&]/.test(cand)) return null;
    if (/[\u{1F000}-\u{1FAFF}☀-➿]/u.test(cand)) return null;

    return SONG_CANON[cand.toLowerCase()] || cand;
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
      member: sel.member || null,
    });
  }

  function applySel(list, sel) {
    if (sel.cat) list = list.filter((v) => v.category === sel.cat);
    if (sel.cats) list = list.filter((v) => sel.cats.includes(v.category));
    if (sel.year) list = list.filter((v) => yearOf(v) === sel.year);
    if (sel.song) list = list.filter((v) => songOf(v) === sel.song);
    if (sel.member) list = list.filter((v) => (v.members || []).includes(sel.member));
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
    let t = sel.cat
      ? catLabel(sel.cat)
      : sel.cats
      ? navGroupLabel(sel.cats) || "자체컨텐츠"
      : "";
    if (sel.year) t = t ? `${t} · ${sel.year}` : `${sel.year}년`;
    if (sel.member) t = t ? `${t} · ${memberName(sel.member)}` : memberName(sel.member);
    return t || "전체";
  }

  /* ---------- URL 상태 ---------- */

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const sel = {};
    if (p.get("cat")) sel.cat = p.get("cat");
    if (p.get("cats")) sel.cats = p.get("cats").split(",").filter(Boolean);
    if (p.get("year")) sel.year = p.get("year");
    if (p.get("song")) sel.song = p.get("song");
    if (p.get("member")) sel.member = p.get("member");
    state.sel = sel;
    state.sort = p.get("sort") || "newest";
    state.q = p.get("q") || "";

    const hasSel = sel.cat || sel.cats || sel.year || sel.song || sel.member || state.q;
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
      if (s.member) p.set("member", s.member);
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
      for (const [s, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
        if (n < 2) continue; // 1회성 제목(파싱 잡음·비무대 영상)은 서브메뉴에서 숨김
        kids.push({ label: s, sel: { ...(node.sel || {}), song: s } });
      }
    } else if (node.subBy === "member") {
      const current = state.members.filter((m) => m.id !== "all" && m.status !== "former");
      const former = state.members
        .filter((m) => m.status === "former")
        .sort((a, b) => (b.left || "").localeCompare(a.left || "")); // 탈퇴 역순
      for (const m of current) kids.push({ label: m.name, sel: { ...(node.sel || {}), member: m.id } });
      if (current.length && former.length) kids.push({ divider: true });
      for (const m of former) kids.push({ label: m.name, sel: { ...(node.sel || {}), member: m.id } });
    }

    for (const k of kids) if (k.sel) k.count = applySel(state.videos, k.sel).length;
    return kids;
  }

  function isGroup(node) {
    return !node.divider && (node.children || node.subBy);
  }

  // 2단 패널을 보여줄 가치가 있는가? "전체" 를 뺀 실질 하위 항목이 2개 이상일 때만.
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
    if (node.sel && selKey(node.sel) !== selKey({}) && selKey(node.sel) === k) return true;
    return childrenOf(node).some((c) => c.sel && selKey(c.sel) === k);
  }

  function subGroupFor(sel) {
    const k = selKey(sel);
    if (k === selKey({})) return null;
    for (const node of CFG.nav || []) {
      if (!isGroup(node)) continue;
      if (node.sel && selKey(node.sel) !== selKey({}) && selKey(node.sel) === k) return node.id;
      if (childrenOf(node).some((c) => c.sel && selKey(c.sel) === k)) return node.id;
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
      (opts.drill ? '<i data-lucide="chevron-right" class="nav-drill"></i>' : "");
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
        if (k.divider) {
          // 앞에 항목이 있을 때만 구분선(예: 현 멤버 ↔ 탈퇴 멤버)
          if (el.pane2List.lastElementChild &&
              el.pane2List.lastElementChild.tagName !== "HR") {
            const hr = document.createElement("hr");
            hr.className = "nav-sep";
            el.pane2List.appendChild(hr);
          }
          continue;
        }
        const isAll = node.withAll && selKey(k.sel) === selKey(node.sel);
        if (k.count === 0 && !isAll) continue;
        const cb = navBtn(k.label, k.count, {
          active: browsing && activeKey === selKey(k.sel),
        });
        cb.classList.add("nav-lv2");
        cb.addEventListener("click", () => select(k.sel));
        el.pane2List.appendChild(cb);
      }
      if (el.pane2List.lastElementChild &&
          el.pane2List.lastElementChild.tagName === "HR") {
        el.pane2List.lastElementChild.remove(); // 꼬리 구분선 제거
      }
      el.nav.classList.add("at-sub");
    } else {
      el.nav.classList.remove("at-sub");
    }
    paintIcons();
  }

  function openSub(node) {
    const showPanel = hasSub(node);
    state.subGroup = showPanel ? node.id : null;

    let target = null;
    if (node.withAll && node.sel && Object.keys(node.sel).length) {
      target = { ...node.sel }; // 그룹의 "전체"
    } else if (node.subBy === "year") {
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
    if (!showPanel) closeDrawer();
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
    el.topbarTitle.textContent = about ? "소개" : titleFor(state.sel);
    document.title = about
      ? "소개 · FLOVER-FLIX"
      : `${titleFor(state.sel)} · FLOVER-FLIX`;

    if (about) renderAbout();
    else renderGrid();

    paintIcons();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }

  function renderGrid() {
    const list = filtered();

    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML =
      `<h2>${escapeHtml(titleFor(state.sel))}</h2>` +
      `<span class="grid-count">${list.length.toLocaleString("ko")}개</span>` +
      `<label class="sort-control">
        <span>정렬</span>
        <select id="sortSelect" aria-label="정렬 방식">
          <option value="newest">최신 발행순</option>
          <option value="added">추가된 순</option>
          <option value="oldest">오래된순</option>
          <option value="title">제목순</option>
        </select>
      </label>`;
    head.querySelector("#sortSelect").value = state.sort;
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

  const PLAY_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

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
        <span class="play">${PLAY_SVG}</span>
        ${v.category === "shorts" ? '<span class="tag-shorts">SHORTS</span>' : ""}
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(v.title)}</h3>
        <p class="card-meta">
          <span class="card-chan">${escapeHtml(v.channelTitle)}</span>
          <span class="card-date">${fmtDate(v.publishedAt)}</span>
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

  function buildChart(entries) {
    const total = entries.reduce((s, e) => s + e.value, 0) || 1;
    const R = 15.91549431;
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
        <circle class="donut-track" cx="21" cy="21" r="${R}" fill="none" stroke-width="5.5" />
        <g transform="rotate(-90 21 21)">${segs}</g>
        <text class="donut-total" x="21" y="20.2" text-anchor="middle">${total.toLocaleString("ko")}</text>
        <text class="donut-unit" x="21" y="24.4" text-anchor="middle">영상</text>
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
        const link = e.sel ? ' role="button" tabindex="0" class="is-link"' : "";
        return `<li${data}${link}>
          <span class="legend-dot" style="background:${color}"></span>
          <span class="legend-label">${escapeHtml(e.label)}</span>
          <b class="legend-val">${e.value.toLocaleString("ko")}</b>
          <span class="legend-pct">${pct}%</span>
        </li>`;
      })
      .join("");

    return `<div class="chart">
      ${svg}
      <ul class="chart-legend">${legend}</ul>
    </div>`;
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

    const tBtn = (k, label) =>
      `<button data-chart="${k}" class="chart-toggle-btn${state.chartBy === k ? " is-active" : ""}">${label}</button>`;

    const stat = (b, s) =>
      `<div class="stat"><b>${b}</b><span>${s}</span></div>`;

    el.content.innerHTML = `
      <section class="about">
        <h1 class="about-title">FLOVER-FLIX 소개</h1>
        <p class="about-lead">
          프로미스나인(fromis_9)의 영상을 한곳에서 모아보는 <strong>비영리 팬 아카이브</strong>입니다.
        </p>

        <div class="about-stats">
          ${stat(total.toLocaleString("ko"), "영상")}
          ${stat(catN, "카테고리")}
          <div class="stat stat-time">
            <b>${up ? `${up.year}.${up.month}.${up.day}<span>${up.hour}:${up.minute}:${up.second} KST</span>` : "―"}</b>
            <span>마지막 업데이트</span>
          </div>
          ${stat(escapeHtml(gen), "수집 방식")}
        </div>

        <h2>영상 통계</h2>
        <div class="chart-toggle" role="group" aria-label="통계 기준">
          ${tBtn("category", "카테고리별")}${tBtn("year", "연도별")}
        </div>
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
        <a href="${REPO_URL}/issues" target="_blank" rel="noopener noreferrer" class="about-link">GitHub 저장소</a>로 부탁드립니다.</p>

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
    paintIcons();
    el.modal.querySelector("[data-close]").focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    el.modalPlayer.innerHTML = "";
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }
  const modalOpen = () => !el.modal.hidden;

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

  /* ---------- 테마 ---------- */

  function toggleTheme() {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("ff-theme", dark ? "dark" : "light");
    } catch (e) {}
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
    el.content.addEventListener("change", (e) => {
      if (e.target.id !== "sortSelect") return;
      state.sort = e.target.value;
      writeUrl();
      render({ keepScroll: true });
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

    el.themeToggle.addEventListener("click", toggleTheme);

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
        paintIcons();
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
      if (e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (modalOpen()) closeModal();
      else if (el.nav.classList.contains("at-sub")) closeSub();
      else if (el.sidebar.classList.contains("is-open")) closeDrawer();
    });

    window.addEventListener("popstate", () => {
      readUrl();
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
  paintIcons();
})();
