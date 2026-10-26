/* FLOVER-FLIX — 정적 팬 아카이브 프론트엔드 (빌드 도구 없음, 바닐라 JS)
   데이터: data/videos.json, data/members.json, data/meta.json
   상태는 URL 쿼리스트링(?view=&cat=&cats=&year=&song=&member=&sort=&q=)에 반영 */

(() => {
  "use strict";

  const CFG = window.FF_CONFIG;
  const DATA_BASE = "data/";

  const state = {
    videos: [],
    members: [],
    meta: {},
    album: null, // 디스코그래피 상세로 열린 앨범 id
    discoCount: null,
    view: "browse", // "browse" | "about" | "photos" | "discography" (파라미터 없이 접속하면 전체보기가 시작 페이지)
    photos: { posts: [] }, // data/photos.json (SBS 인기가요 현장포토)
    photoGroups: 12, // 현장포토 화면에서 지금까지 그린 게시물(그룹) 수
    sel: {}, // { cat?, cats?[], year?, song?, member? } - {} = 전체
    subGroup: null, // 현재 화면이 속한 1단 그룹 id (제목의 "상위 > 하위 ▾" 표기용)
    chartBy: "category", // About. 페이지 파이차트 기준: "category" | "year"
    sort: "newest", // 기본 정렬: 최신 발행순
    includeShorts: false, // 전체보기에서 Shorts 포함 여부 (기본 꺼짐, URL: shorts=1 이면 포함)
    q: "",
    limit: CFG.pageSize,
  };

  const el = {
    nav: document.getElementById("sidebar"),
    pane1: document.getElementById("navPane1"),
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
    pv: document.getElementById("photoViewer"),
    pvImg: document.getElementById("pvImg"),
    pvTitle: document.getElementById("pvTitle"),
    pvSub: document.getElementById("pvSub"),
    pvPrev: document.getElementById("pvPrev"),
    pvNext: document.getElementById("pvNext"),
    pvOpen: document.getElementById("pvOpen"),
    pvDown: document.getElementById("pvDown"),
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

  // 영상 길이 표기: API 수집분은 ISO 8601("PT1H2M3S"), yt-dlp 수집분은 정수(초)
  const fmtDur = (d) => {
    let s = 0;
    if (typeof d === "number") s = Math.round(d);
    else if (typeof d === "string") {
      const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
      if (m) s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }
    if (!(s > 0)) return "";
    const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  };

  const catLabel = (id) => (CFG.catLabels && CFG.catLabels[id]) || id;

  const thumbUrl = (v) =>
    v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  const yearOf = (v) => (v.publishedAt || v.addedAt || "").slice(0, 4);

  // Shorts 형식인가: 분류가 shorts 이거나, 시리즈 분류 안에 있어도 형식이 Shorts(short: true)인 경우
  const isShort = (v) => v.category === "shorts" || v.short === true;

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
    if (sel.cat === "shorts") list = list.filter(isShort); // Shorts 메뉴는 시리즈 안의 Shorts도 포함
    else if (sel.cat) list = list.filter((v) => v.category === sel.cat);
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
    state.includeShorts = p.get("shorts") === "1";
    state.q = p.get("q") || "";

    const hasSel = sel.cat || sel.cats || sel.year || sel.song || sel.member || state.q;
    if (p.get("view") === "about") state.view = "about";
    else if (p.get("view") === "photos") state.view = "photos";
    else if (p.get("view") === "discography") {
      state.view = "discography";
      state.album = p.get("album") || null;
    }
    else if (p.get("view") === "browse" || hasSel) state.view = "browse";
    else state.view = "browse"; // 파라미터 없음 = 시작 페이지(전체보기)
  }

  function writeUrl(replace) {
    const p = new URLSearchParams();
    if (state.view === "about" || state.view === "photos") {
      p.set("view", state.view); // 파라미터 없는 "/" 는 전체보기
    } else if (state.view === "discography") {
      p.set("view", "discography");
      if (state.album) p.set("album", state.album);
    } else {
      const s = state.sel;
      if (s.cat) p.set("cat", s.cat);
      if (s.cats) p.set("cats", s.cats.join(","));
      if (s.year) p.set("year", s.year);
      if (s.song) p.set("song", s.song);
      if (s.member) p.set("member", s.member);
      if (state.sort !== "newest") p.set("sort", state.sort);
      if (state.includeShorts && isAllView()) p.set("shorts", "1");
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

    const [members, videosRaw, meta, photos, overrides] = await Promise.all([
      loadJson("members.json", { members: [] }),
      loadJson("videos.json", { videos: [] }),
      loadJson("meta.json", {}),
      loadJson("photos.json", { posts: [] }),
      loadJson("overrides.json", {}),
    ]);

    state.members = members.members || [];
    state.meta = meta || {};
    if (window.FFDiscography) window.FFDiscography.preload().then(() => { state.discoCount = window.FFDiscography.count(); buildNav(); paintIcons(); });
    state.photos = applyPhotoOverrides(photos || { posts: [] }, (overrides || {}).photos);
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
      short: v.short === true,
      _search: `${v.title || ""} ${v.channelTitle || ""}`.toLowerCase(),
    };
  }

  /* ---------- 필터/정렬 ---------- */

  // 아무 분류도 고르지 않은 "전체보기"인가 (Shorts 포함 토글은 이 화면에만 적용)
  const isAllView = () => selKey(state.sel) === selKey({});

  function filtered() {
    let list = applySel(state.videos, state.sel);
    if (!state.includeShorts && isAllView()) list = list.filter((v) => !isShort(v));

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

  // 제목에 하위 풀다운을 둘 가치가 있는가? "전체" 를 뺀 실질 하위 항목이 2개 이상일 때만.
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
      (opts.icon ? `<i data-lucide="${escapeHtml(opts.icon)}" class="nav-ico"></i>` : "") +
      `<span class="nav-label">${escapeHtml(label)}</span>` +
      (count != null ? `<span class="nav-count">${count.toLocaleString("ko")}</span>` : "");
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
      if (node.view === "discography") {
        const b = navBtn(node.label, state.discoCount, { active: state.view === "discography", icon: node.icon });
        b.classList.add("nav-lv1");
        b.addEventListener("click", () => goDisco(null));
        el.pane1.appendChild(b);
        continue;
      }
      if (node.view === "photos") {
        const n = (state.photos.posts || []).reduce((s, p) => s + p.images.length, 0);
        const b = navBtn(node.label, n, { active: state.view === "photos", icon: node.icon });
        b.classList.add("nav-lv1");
        b.addEventListener("click", goPhotos);
        el.pane1.appendChild(b);
        continue;
      }
      if (!isGroup(node)) {
        // "전체보기" 숫자는 화면의 Shorts 포함 토글을 따른다
        const n =
          selKey(node.sel) === selKey({}) && !state.includeShorts
            ? state.videos.filter((v) => !isShort(v)).length
            : applySel(state.videos, node.sel).length;
        const b = navBtn(node.label, n, {
          active: browsing && activeKey === selKey(node.sel),
          icon: node.icon,
        });
        b.classList.add("nav-lv1");
        b.addEventListener("click", () => select(node.sel));
        el.pane1.appendChild(b);
        continue;
      }
      const total = applySel(state.videos, node.sel || {}).length;
      if (!total && !CFG.showEmptyGroups) continue;
      const b = navBtn(node.label, total, {
        active: browsing && (state.subGroup === node.id || nodeContainsSel(node, state.sel)),
        icon: node.icon,
      });
      b.classList.add("nav-lv1", "nav-grouphead");
      b.addEventListener("click", () => goGroup(node));
      el.pane1.appendChild(b);
    }
    paintIcons();
  }

  // 1단 그룹을 누르면 그 그룹의 대표 화면으로 이동한다. 하위 항목은 화면 제목의 풀다운에서 고른다.
  function goGroup(node) {
    let target = null;
    if (node.withAll && node.sel && Object.keys(node.sel).length) {
      target = { ...node.sel }; // 그룹의 "전체"
    } else {
      const kids = childrenOf(node).filter((k) => k.sel && k.count > 0);
      if (node.subBy === "year") {
        const cur = String(new Date().getFullYear());
        target = ((kids.find((k) => k.sel.year === cur)) || kids[0] || {}).sel; // 올해, 없으면 최신 연도
      } else if (kids.length) {
        target = kids[0].sel; // 멤버별 보기 등: 첫 항목
      }
    }
    if (target) select(target);
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
    stopScrollObs();
    el.loading?.remove();
    el.content.innerHTML = "";

    const about = state.view === "about";
    const photos = state.view === "photos";
    const disco = state.view === "discography";
    const pageTitle = about ? "소개" : photos ? PHOTO_TITLE : disco ? "Discography" : titleFor(state.sel);
    el.topbarTitle.textContent = pageTitle;
    document.title = about ? "About. · FLOVER-FLIX" : `${pageTitle} · FLOVER-FLIX`;

    document.body.classList.toggle("is-about", about); // 넓은 화면의 About 에서는 사이드바 고정(CSS)
    if (about) renderAbout();
    else if (photos) renderPhotos();
    else if (disco) renderDisco();
    else renderGrid();

    if (about) {
      paintHistoryChart();
      loadVisitCount();
    }
    paintIcons();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  }

  /* ---------- SBS 인기가요 현장포토 ---------- */

  const PHOTO_TITLE = "SBS 인기가요 : 현장포토";
  const photoPost = (no) => (state.photos.posts || []).find((p) => p.no === Number(no));
  const thumbSrc = (im) => DATA_BASE + im.t;
  const postUrl = (p) => `${state.photos.board}?cmd=view&page=1&board_no=${p.no}`;

  const photoKey = (im) => im.t.replace(/^photos\//, "").replace(/\.webp$/, "");

  // 제목에서 멤버 자동 감지 (이름·별칭 2자 이상)
  function detectPhotoMembers(title) {
    const t = (title || "").toLowerCase();
    return state.members
      .filter((m) => m.id !== "all" && [m.name, ...(m.aliases || [])].some((a) => a.length >= 2 && t.includes(a.toLowerCase())))
      .map((m) => m.id);
  }

  // data/overrides.json(수동 편집)을 수집 데이터 위에 입힌다: 제목 변경, 게시물/사진 숨김, 멤버 태그
  function applyPhotoOverrides(photos, ov) {
    const o = ov || {};
    const posts = [];
    for (const p of photos.posts || []) {
      const c = o[String(p.no)] || {};
      if (c.hidden) continue;
      const hide = new Set(c.hideImages || []);
      const images = p.images.filter((im) => !hide.has(photoKey(im)));
      if (!images.length) continue;
      posts.push({
        ...p,
        images,
        title: (c.title || "").trim() || p.title,
        members: Array.isArray(c.members) ? c.members : detectPhotoMembers(p.title),
      });
    }
    return { ...photos, posts };
  }

  function photoGroupHtml(p) {
    const thumbs = p.images
      .map(
        (im, i) =>
          `<button type="button" class="photo-thumb" data-photo="${p.no}:${i}" ` +
          `aria-label="${escapeHtml(p.title)} ${i + 1}번 사진 보기">` +
          `<img src="${escapeHtml(thumbSrc(im))}" alt="" loading="lazy" decoding="async" />` +
          `<span class="photo-num">${i + 1}</span></button>`
      )
      .join("");
    return (
      `<section class="photo-group">` +
      `<header class="photo-group-head"><h3>${escapeHtml(p.title)}</h3>` +
      (p.members || []).map((id) => `<span class="badge">${escapeHtml(memberName(id))}</span>`).join("") +
      `<span class="photo-meta">${escapeHtml(p.date)} · ${p.images.length}장</span>` +
      `<a class="photo-post-link" href="${escapeHtml(postUrl(p))}" target="_blank" rel="noopener noreferrer">SBS에서 보기</a>` +
      `</header><div class="photo-grid">${thumbs}</div></section>`
    );
  }

  function renderPhotos() {
    const posts = (state.photos.posts || []).filter((p) => p.images.length);
    const total = posts.reduce((s, p) => s + p.images.length, 0);

    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML =
      `<h2>${escapeHtml(PHOTO_TITLE)}</h2>` +
      `<span class="grid-count">게시물 ${posts.length.toLocaleString("ko")}개 · 사진 ${total.toLocaleString("ko")}장</span>`;
    el.content.appendChild(head);

    if (!posts.length) {
      emptyState();
      return;
    }

    const note = document.createElement("p");
    note.className = "photo-note";
    note.textContent =
      "썸네일만 이 사이트에 저장되어 있고, 크게 보기·다운로드는 SBS 서버의 원본을 직접 불러옵니다. 사진의 저작권은 SBS와 촬영자에게 있습니다.";
    el.content.appendChild(note);

    const wrap = document.createElement("div");
    wrap.className = "photo-groups";
    el.content.appendChild(wrap);

    // 게시물(그룹) 단위 무한 스크롤
    const draw = (from, to) => {
      wrap.insertAdjacentHTML("beforeend", posts.slice(from, to).map(photoGroupHtml).join(""));
    };
    state.photoGroups = Math.min(Math.max(state.photoGroups, 12), posts.length);
    draw(0, state.photoGroups);

    if (state.photoGroups < posts.length) {
      const sentinel = document.createElement("div");
      sentinel.className = "scroll-sentinel";
      el.content.appendChild(sentinel);
      scrollObs = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          const to = Math.min(posts.length, state.photoGroups + 6);
          draw(state.photoGroups, to);
          state.photoGroups = to;
          if (to >= posts.length) {
            stopScrollObs();
            sentinel.remove();
          } else {
            scrollObs.unobserve(sentinel);
            scrollObs.observe(sentinel);
          }
        },
        { rootMargin: "800px 0px" }
      );
      scrollObs.observe(sentinel);
    }
  }

  /* ---------- 디스코그래피 ---------- */

  function renderDisco() {
    const wrap = document.createElement("div");
    wrap.className = "disco-root";
    el.content.appendChild(wrap);
    const album = state.album;
    window.FFDiscography.render(wrap, { album, onNav: goDisco }).then((title) => {
      if (state.view !== "discography" || state.album !== album) return;
      state.discoCount = window.FFDiscography.count();
      if (title) document.title = `${title} · Discography · FLOVER-FLIX`;
      el.topbarTitle.textContent = title ? "Discography" : "Discography";
      paintIcons();
    });
  }

  function goDisco(id) {
    state.view = "discography";
    state.album = id || null;
    state.subGroup = null;
    writeUrl();
    buildNav();
    render();
    closeDrawer();
  }

  function goPhotos() {
    state.view = "photos";
    state.subGroup = null;
    state.photoGroups = 12;
    writeUrl();
    buildNav();
    render();
    closeDrawer();
  }

  /* 사진 뷰어: 썸네일을 먼저 보여 주고 SBS 원본이 로드되면 교체한다 */
  let pvState = null; // { post, idx, token }

  function openPhoto(no, idx) {
    const post = photoPost(no);
    if (!post || !post.images[idx]) return;
    if (!pvState) lastFocus = document.activeElement;
    pvState = { post, idx, token: (pvState ? pvState.token : 0) + 1 };
    const im = post.images[idx];
    const token = pvState.token;

    el.pvTitle.textContent = `${post.title} · ${idx + 1}`;
    el.pvSub.textContent = `${idx + 1} / ${post.images.length}  ·  ${post.date}`;
    el.pvPrev.disabled = idx === 0;
    el.pvNext.disabled = idx === post.images.length - 1;
    el.pvOpen.href = im.u;
    el.pvDown.href = im.u;
    el.pvDown.setAttribute("download", im.u.split("/").pop());

    el.pvImg.classList.add("is-loading");
    el.pvImg.removeAttribute("data-fail");
    el.pvImg.src = thumbSrc(im); // 즉시 보이는 저해상도(썸네일)
    const full = new Image();
    full.referrerPolicy = "no-referrer";
    full.onload = () => {
      if (!pvState || pvState.token !== token) return;
      el.pvImg.src = im.u;
      el.pvImg.classList.remove("is-loading");
    };
    full.onerror = () => {
      if (!pvState || pvState.token !== token) return;
      el.pvImg.classList.remove("is-loading");
      el.pvImg.setAttribute("data-fail", "1"); // 원본 로드 실패: 썸네일을 그대로 보여 준다
    };
    full.src = im.u;

    el.pv.hidden = false;
    document.body.style.overflow = "hidden";
    paintIcons();
    if (token === 1) el.pv.querySelector("[data-pclose]").focus();
  }

  function stepPhoto(d) {
    if (!pvState) return;
    openPhoto(pvState.post.no, pvState.idx + d);
  }

  function closePhoto() {
    el.pv.hidden = true;
    el.pvImg.removeAttribute("src");
    pvState = null;
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }

  // 현재 화면이 하위 풀다운을 가진 1단 그룹에 속하면 { node, kids, label }, 아니면 null.
  // 그룹의 "전체"(withAll) 화면도 포함한다 — 하위 항목으로 가는 유일한 길이 이 풀다운이기 때문.
  function crumbFor(sel) {
    const node = navNode(state.subGroup);
    if (!node || !isGroup(node) || !hasSub(node)) return null;
    const k = selKey(sel);
    const kids = childrenOf(node);
    const cur = kids.find((c) => c.sel && selKey(c.sel) === k);
    return cur ? { node, kids, label: cur.label } : null;
  }

  // 풀다운 항목: 개수 0인 항목은 숨기고("전체" 제외), 맨앞·맨뒤·연속 구분선은 정리한다
  function crumbOptionsHtml(crumb) {
    const k = selKey(state.sel);
    const parts = [];
    crumb.kids.forEach((c, i) => {
      if (c.divider) return parts.push({ hr: true });
      const isAll = crumb.node.withAll && selKey(c.sel) === selKey(crumb.node.sel);
      if (c.count === 0 && !isAll) return;
      const on = selKey(c.sel) === k;
      parts.push({
        html:
          `<button type="button" role="option" class="crumb-opt${on ? " is-active" : ""}" data-ki="${i}" aria-selected="${on}">` +
          `<span>${escapeHtml(c.label)}</span><b>${c.count.toLocaleString("ko")}</b></button>`,
      });
    });
    return parts
      .filter((p, i) => !p.hr || (i > 0 && i < parts.length - 1 && !parts[i - 1].hr))
      .map((p) => (p.hr ? '<hr class="crumb-hr" />' : p.html))
      .join("");
  }

  function closeCrumbMenu() {
    const pop = document.getElementById("crumbPop");
    const trig = document.getElementById("crumbTrigger");
    if (pop) pop.hidden = true;
    if (trig) trig.setAttribute("aria-expanded", "false");
    document.querySelector(".crumb-parent")?.setAttribute("aria-expanded", "false");
  }

  function toggleCrumbMenu() {
    const pop = document.getElementById("crumbPop");
    const trig = document.getElementById("crumbTrigger");
    if (!pop || !trig) return;
    const open = pop.hidden;
    pop.hidden = !open;
    trig.setAttribute("aria-expanded", String(open));
    document.querySelector(".crumb-parent")?.setAttribute("aria-expanded", String(open));
    if (open) pop.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  function renderGrid() {
    const list = filtered();

    const crumb = crumbFor(state.sel);
    state.crumbKids = crumb ? crumb.kids : [];
    const heading = crumb
      ? `<h2 class="crumb">` +
        `<button type="button" class="crumb-parent" aria-haspopup="listbox" aria-controls="crumbPop">${escapeHtml(crumb.node.label)}</button>` +
        `<span class="crumb-sep" aria-hidden="true">&gt;</span>` +
        `<span class="crumb-menu">` +
        `<button type="button" class="crumb-trigger" id="crumbTrigger" aria-haspopup="listbox" aria-expanded="false">` +
        `<span>${escapeHtml(crumb.label)}</span><i data-lucide="chevron-down"></i></button>` +
        `<div class="crumb-pop nice-scroll" id="crumbPop" role="listbox" aria-label="하위 분류" hidden>${crumbOptionsHtml(crumb)}</div>` +
        `</span></h2>`
      : `<h2>${escapeHtml(titleFor(state.sel))}</h2>`;

    const head = document.createElement("div");
    head.className = "grid-head";
    head.innerHTML =
      heading +
      `<span class="grid-count">${list.length.toLocaleString("ko")}개</span>` +
      (isAllView()
        ? `<label class="toggle"><input type="checkbox" id="shortsToggle"${state.includeShorts ? " checked" : ""} />` +
          `<span class="toggle-track" aria-hidden="true"></span><span>Shorts 포함</span></label>`
        : "") +
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

    // 무한 스크롤: 바닥 센티널이 화면 근처에 오면 다음 묶음을 이어 붙인다
    if (list.length > state.limit) {
      const sentinel = document.createElement("div");
      sentinel.className = "scroll-sentinel";
      el.content.appendChild(sentinel);

      scrollObs = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          const next = list.slice(state.limit, state.limit + CFG.pageSize);
          next.forEach((v) => grid.appendChild(card(v)));
          state.limit += next.length;
          if (state.limit >= list.length) {
            stopScrollObs();
            sentinel.remove();
          } else {
            // 센티널이 아직 화면 안이면 콜백이 다시 오지 않으므로 재관찰로 다음 묶음을 이어서 채운다
            scrollObs.unobserve(sentinel);
            scrollObs.observe(sentinel);
          }
        },
        { rootMargin: "800px 0px" }
      );
      scrollObs.observe(sentinel);
    }
  }

  let scrollObs = null;
  function stopScrollObs() {
    if (scrollObs) scrollObs.disconnect();
    scrollObs = null;
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

    const dur = fmtDur(v.duration);
    a.innerHTML = `
      <div class="thumb">
        <img loading="lazy" src="${thumbUrl(v)}" alt="" />
        <span class="play">${PLAY_SVG}</span>
        ${isShort(v) ? '<span class="tag-shorts">SHORTS</span>' : ""}
        ${dur ? `<span class="dur">${dur}</span>` : ""}
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(v.title)}</h3>
        ${v.channelTitle ? `<p class="card-meta card-chan">${escapeHtml(v.channelTitle)}</p>` : ""}
        <p class="card-meta card-date">${fmtDate(v.publishedAt)}</p>
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

  function getTopCategory(delta) {
    let maxCat = null, maxCount = 0;
    for (const [cat, count] of Object.entries(delta || {})) {
      if (count > maxCount) {
        maxCount = count;
        maxCat = cat;
      }
    }
    return maxCat;
  }

  function paintHistoryChart() {
    const svg = document.getElementById("historyChart");
    if (!svg) return;

    const history = state.meta.history || [];
    const displayCount = Math.min(5, history.length);
    const displayData = history.slice(-displayCount);

    if (displayData.length < 2) return;

    const padding = { top: 30, right: 40, bottom: 50, left: 60 };
    const chartWidth = 600 - padding.left - padding.right;
    const chartHeight = 280 - padding.top - padding.bottom;

    const minTotal = Math.min(...displayData.map(d => d.total));
    const maxTotal = Math.max(...displayData.map(d => d.total));
    const range = maxTotal - minTotal || 1;

    const points = displayData.map((d, i) => {
      const x = padding.left + (chartWidth * i / (displayData.length - 1 || 1));
      const y = padding.top + chartHeight - (chartHeight * (d.total - minTotal) / range);
      return { x, y, ...d };
    });

    svg.innerHTML = "";

    const ns = "http://www.w3.org/2000/svg";
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--border").trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text-3").trim();
    const brandColor = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
    const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();

    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight * i / 4);
      const val = maxTotal - (range * i / 4);

      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", padding.left);
      line.setAttribute("y1", y);
      line.setAttribute("x2", 600 - padding.right);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", gridColor);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-dasharray", "4,4");
      svg.appendChild(line);

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", padding.left - 15);
      label.setAttribute("y", y);
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "13");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = Math.round(val).toLocaleString("ko");
      svg.appendChild(label);
    }

    const axisX = document.createElementNS(ns, "line");
    axisX.setAttribute("x1", padding.left);
    axisX.setAttribute("y1", padding.top + chartHeight);
    axisX.setAttribute("x2", 600 - padding.right);
    axisX.setAttribute("y2", padding.top + chartHeight);
    axisX.setAttribute("stroke", textColor);
    axisX.setAttribute("stroke-width", "1");
    svg.appendChild(axisX);

    const axisY = document.createElementNS(ns, "line");
    axisY.setAttribute("x1", padding.left);
    axisY.setAttribute("y1", padding.top);
    axisY.setAttribute("x2", padding.left);
    axisY.setAttribute("y2", padding.top + chartHeight);
    axisY.setAttribute("stroke", textColor);
    axisY.setAttribute("stroke-width", "1");
    svg.appendChild(axisY);

    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("points", points.map(p => `${p.x},${p.y}`).join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", brandColor);
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    points.forEach((p, i) => {
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", p.x);
      circle.setAttribute("cy", p.y);
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", surfaceColor);
      circle.setAttribute("stroke", brandColor);
      circle.setAttribute("stroke-width", "2");
      svg.appendChild(circle);

      const dateStr = p.timestamp.slice(5, 10);
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", p.x);
      label.setAttribute("y", padding.top + chartHeight + 30);
      label.setAttribute("fill", textColor);
      label.setAttribute("font-size", "13");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = dateStr;
      svg.appendChild(label);
    });
  }

  function buildHistoryChart() {
    const history = state.meta.history || [];
    if (!history.length || history.length < 2) {
      return "";
    }

    const displayCount = Math.min(5, history.length);
    const displayData = history.slice(-displayCount);
    const latest = displayData[displayData.length - 1] || {};

    const topCat = getTopCategory(latest.delta);

    // 최근 수집 카테고리별 통계
    const deltaHtml = Object.entries(latest.delta || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, count]) => {
        const label = catLabel(cat);
        return `<div class="delta-card"><b>${label}</b><br />${count}</div>`;
      }).join("");

    // 이력 테이블
    const tableHtml = displayData.slice().reverse().map(item => {
      const topItemCat = getTopCategory(item.delta);
      const catList = Object.entries(item.delta || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, count]) => `${catLabel(cat)}(${count})`)
        .join(", ");

      const ts = item.timestamp.slice(0, 10);
      return `
        <tr>
          <td>${ts}</td>
          <td>+${item.added}</td>
          <td>${item.total.toLocaleString("ko")}</td>
          <td style="font-size: 0.8rem; color: var(--text-3);">${catList}</td>
        </tr>`;
    }).join("");

    return `
      <div class="history-chart-wrapper" id="historyChartWrapper">
        <h2>영상 수집 추이</h2>
        <p style="color: var(--text-3); font-size: 0.9rem;">최근 ${displayCount}회 수집 시점별 영상 개수</p>
        <svg class="history-chart" id="historyChart" viewBox="0 0 600 280"></svg>
        <table class="history-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>추가</th>
              <th>합계</th>
              <th>상위 카테고리</th>
            </tr>
          </thead>
          <tbody>${tableHtml}</tbody>
        </table>
        ${history.length > displayCount ? `<button class="history-expand-btn" id="historyExpandBtn">더 보기 (전체 ${history.length}회)</button>` : ""}
      </div>`;
  }

  function renderAbout() {
    const counts = catCounts();
    const total = state.videos.length;
    const catN = Object.keys(counts).length;
    const up = kstParts(state.meta.updatedAt);
    const gen = state.meta.generator || "―";

    // 마지막 업데이트에서 추가된 영상 수: 마지막 history 항목이 이번 수집(2시간 이내)에 속할 때만 센다
    const lastH = (state.meta.history || []).slice(-1)[0];
    const addedNow =
      lastH && state.meta.updatedAt &&
      Date.parse(state.meta.updatedAt) - Date.parse(lastH.timestamp) <= 2 * 3600 * 1000
        ? lastH.added || 0
        : 0;

    const tBtn = (k, label) =>
      `<button data-chart="${k}" class="chart-toggle-btn${state.chartBy === k ? " is-active" : ""}">${label}</button>`;

    const stat = (b, s) =>
      `<div class="stat"><span>${s}</span><b>${b}</b></div>`;

    el.content.innerHTML = `
      <section class="about">
        <h1 class="about-title">FLOVER-FLIX 소개</h1>
        <p class="about-lead">
          프로미스나인(fromis_9)의 영상을 한곳에서 모아보는 <strong>비영리 팬 아카이브</strong>입니다.
        </p>

        <div class="about-stats">
          <div class="stat" id="visitStat" hidden><span>누적 방문</span><b>―</b></div>
          <div class="stat stat-pair">
            <div><span>카테고리</span><b>${catN}</b></div>
            <div><span>영상</span><b>${total.toLocaleString("ko")}</b></div>
          </div>
          <div class="stat stat-time">
            <span>마지막 업데이트</span>
            <b>${up ? `${up.year}.${up.month}.${up.day}<span>${up.hour}:${up.minute}:${up.second} KST</span>` : "―"}</b>
            <em class="stat-added${addedNow ? " has-new" : ""}">+${addedNow.toLocaleString("ko")}</em>
          </div>
          ${stat(escapeHtml(gen).split(" + ").join("<br>"), "수집 방식")}
        </div>

        <h2>영상 통계</h2>
        <div class="chart-toggle" role="group" aria-label="통계 기준">
          ${tBtn("category", "카테고리별")}${tBtn("year", "연도별")}
        </div>
        ${buildChart(chartEntries())}

        ${buildHistoryChart()}

        <h2>페이지 안내</h2>
        <p>이 페이지는 <strong>수익을 목적으로 하지 않으며</strong>, 광고를 넣을 계획이 없습니다.
        오직 프로미스나인과 flover를 위해 만들어졌습니다.</p>

        <h2>저작권</h2>
        <p>이 페이지에 표시된 각 영상의 저작권은 해당 <strong>방송국, 소속사, 그리고 각 채널·업로더</strong>에게
        있습니다. 이 사이트는 영상을 재호스팅하지 않고 YouTube 임베드로만 제공하며, 권리자의 요청이 있을 경우
        해당 항목을 즉시 삭제합니다.</p>
        <p>SBS 인기가요 현장포토는 SBS 게시판에 공개된 사진으로, 이 사이트는 <strong>작은 썸네일만 저장</strong>하고
        원본은 SBS 서버에서 직접 불러옵니다. 사진의 저작권은 <strong>SBS와 각 촬영자</strong>에게 있으며,
        권리자의 요청이 있을 경우 즉시 삭제합니다.</p>

        <h2>데이터 출처</h2>
        <p>YouTube Data API v3를 통해 <code>@studiofromis_9</code>를 비롯한 공개 채널·재생목록의 메타데이터를
        수집합니다. 방송국 무대·직캠·스페셜 무대는 KBS·MBC·SBS·Mnet·M2·1theK·딩고뮤직 등의 공개 영상을
        검색해 선별합니다. GitHub Actions로 주기적으로 갱신됩니다.</p>

        <h2>사용한 폰트</h2>
        <ul class="about-fonts">
          <li>
            <span class="af-role">제목</span>
            <span class="af-name af-head">함렛 (Hahmlet)</span>
            <span class="af-meta">로고, 화면 제목, 메뉴명 · <a href="https://fonts.google.com/specimen/Hahmlet" target="_blank" rel="noopener noreferrer" class="about-link">Google Fonts</a> · SIL OFL 1.1</span>
          </li>
          <li>
            <span class="af-role">본문</span>
            <span class="af-name">나눔스퀘어라운드</span>
            <span class="af-meta">카드, 개수, 안내 글 · <a href="https://hangeul.naver.com/font/nanum" target="_blank" rel="noopener noreferrer" class="about-link">네이버 나눔글꼴</a> · SIL OFL 1.1</span>
          </li>
          <li>
            <span class="af-role">보조</span>
            <span class="af-name">Pretendard</span>
            <span class="af-meta">나눔스퀘어라운드에 없는 글자를 대신 표시 · <a href="https://github.com/orioncactus/pretendard" target="_blank" rel="noopener noreferrer" class="about-link">GitHub</a> · SIL OFL 1.1</span>
          </li>
          <li>
            <span class="af-role">아이콘</span>
            <span class="af-name">Lucide</span>
            <span class="af-meta"><a href="https://lucide.dev" target="_blank" rel="noopener noreferrer" class="about-link">lucide.dev</a> · ISC</span>
          </li>
        </ul>

        <h2>문의</h2>
        <p>버그 제보·영상 추가 요청은
        <a href="mailto:parkhaas@gmail.com" class="about-link"><i data-lucide="mail" class="about-ico"></i>E-Mail</a>로 부탁드립니다.</p>

        <p class="about-made">made with love, for flover</p>
      </section>`;
  }

  // GoatCounter 누적 방문 수. 조회 실패(차단기·설정 미허용·오프라인)면 박스를 숨긴 채 둔다.
  const VISIT_BASE = 1004; // 표시 시작값 (GoatCounter 실제 집계에 더해서 보여준다)
  let visitCount = null;
  async function loadVisitCount() {
    const box = document.getElementById("visitStat");
    if (!box) return;
    try {
      if (visitCount == null) {
        const res = await fetch("https://fp-pilot.goatcounter.com/counter/TOTAL.json");
        if (!res.ok) throw new Error(res.status);
        const n = Number(String((await res.json()).count || "0").replace(/\D/g, ""));
        visitCount = (VISIT_BASE + n).toLocaleString("ko");
      }
      const target = document.getElementById("visitStat");
      if (!target) return; // 그 사이 다른 화면으로 이동
      target.querySelector("b").textContent = visitCount;
      target.hidden = false;
    } catch (e) {}
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
    state.subGroup = null; // 열려 있던 서브 메뉴를 닫고 이동
    writeUrl();
    buildNav();
    render();
    closeDrawer();
  }

  /* ---------- 이벤트 ---------- */

  function bindEvents() {
    el.content.addEventListener("change", (e) => {
      if (e.target.id === "shortsToggle") {
        state.includeShorts = e.target.checked;
        state.limit = CFG.pageSize;
        writeUrl();
        buildNav();
        render({ keepScroll: true });
        return;
      }
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
        if (state.view !== "browse") state.view = "browse";
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
      const thumb = e.target.closest("[data-photo]");
      if (thumb) {
        const [no, idx] = thumb.dataset.photo.split(":");
        openPhoto(no, Number(idx));
        return;
      }
      if (e.target.closest("[data-pclose]")) {
        closePhoto();
        return;
      }
      if (e.target.closest("#pvPrev")) {
        stepPhoto(-1);
        return;
      }
      if (e.target.closest("#pvNext")) {
        stepPhoto(1);
        return;
      }
      if (e.target.closest("#crumbTrigger")) {
        toggleCrumbMenu();
        return;
      }
      const opt = e.target.closest("[data-ki]");
      if (opt) {
        const k = (state.crumbKids || [])[Number(opt.dataset.ki)];
        closeCrumbMenu();
        if (k && k.sel) select(k.sel);
        return;
      }
      // 제목의 1단 이름도 하위 풀다운을 여닫는 버튼이다(이동하지 않음)
      if (e.target.closest(".crumb-parent")) {
        toggleCrumbMenu();
        return;
      }
      if (!e.target.closest(".crumb-menu")) closeCrumbMenu(); // 바깥을 누르면 풀다운 닫기
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

    el.modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      // 풀다운이 열려 있으면 ↑/↓ 로 항목 이동
      const pop = document.getElementById("crumbPop");
      if (pop && !pop.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const opts = [...pop.querySelectorAll(".crumb-opt")];
        const i = opts.indexOf(document.activeElement);
        const next = e.key === "ArrowDown" ? Math.min(opts.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        opts[next]?.focus();
        return;
      }
      if (pvState && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        stepPhoto(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key !== "Escape") return;
      if (pvState) closePhoto();
      else if (modalOpen()) closeModal();
      else if (document.getElementById("crumbPop") && !document.getElementById("crumbPop").hidden) {
        closeCrumbMenu();
        document.getElementById("crumbTrigger").focus();
      } else if (el.sidebar.classList.contains("is-open")) closeDrawer();
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
