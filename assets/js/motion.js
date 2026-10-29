/* FLOVER-FLIX — 모션 효과 (바닐라 JS)
   CSS 만으로는 안 되는 것들: 마우스를 따라 기울어지는 3D 카드, 커서를 따라다니는 빛, 클릭 파티클,
   숫자 카운트업, 글자 단위 입장, 자석 버튼, 스크롤 속도에 따른 기울임, 커서 링.
   모두 "동작 줄이기"가 켜져 있으면 아무것도 하지 않고, 마우스가 없는 기기에서는 포인터 효과를 건너뛴다.
   DOM 은 app.js 가 계속 다시 그리므로 이벤트는 위임하고 새 노드는 MutationObserver 로 처리한다. */

(() => {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = document.documentElement;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------- 배경에 떠다니는 빛 덩어리 ---------- */
  const orbs = document.createElement("div");
  orbs.className = "fx-orbs";
  orbs.setAttribute("aria-hidden", "true");
  orbs.innerHTML = "<i></i><i></i><i></i>";
  document.body.prepend(orbs);

  /* ---------- 글자 단위 입장 ---------- */
  const SPLIT = ".about-title, .dg-hero-title, .grid-head h2:not(:has(*)), .dg-chap-h > span, .dg-extras-h";
  function split(el) {
    if (el.dataset.fxSplit || el.children.length || el.closest("[data-fx-split]") || el.classList.contains("fx-ch") || el.classList.contains("fx-sp")) return;
    const text = el.textContent;
    if (!text.trim()) return;
    el.dataset.fxSplit = "1";
    el.setAttribute("aria-label", text);
    el.textContent = "";
    let i = 0;
    for (const ch of text) {
      const s = document.createElement("span");
      s.setAttribute("aria-hidden", "true");
      if (ch === " ") {
        s.className = "fx-sp";
        s.textContent = " ";
      } else {
        s.className = "fx-ch";
        s.style.setProperty("--i", i++);
        s.textContent = ch;
      }
      el.appendChild(s);
    }
  }

  /* ---------- 숫자 카운트업 ---------- */
  const countIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        countIO.unobserve(e.target);
        countUp(e.target);
      }
    },
    { threshold: 0.6 }
  );
  function countUp(el) {
    const raw = el.dataset.fxTarget;
    const target = Number(raw.replace(/,/g, ""));
    const t0 = performance.now();
    const dur = 1100;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(target * eased).toLocaleString("ko");
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = raw;
    };
    requestAnimationFrame(tick);
  }
  function prepCount(el) {
    if (el.dataset.fxTarget || el.children.length) return;
    const t = el.textContent.trim();
    if (!/^[0-9][0-9,]*$/.test(t)) return;
    el.dataset.fxTarget = t;
    el.textContent = "0";
    countIO.observe(el);
  }

  /* ---------- 새로 그려진 노드 처리 ---------- */
  function scan(node) {
    if (!(node instanceof Element)) return;
    const hit = (sel, fn) => {
      if (node.matches(sel)) fn(node);
      node.querySelectorAll(sel).forEach(fn);
    };
    hit(SPLIT, split);
    hit(".stat b, .about-stats b", prepCount);
  }
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  /* ---------- 스크롤 속도 → 목록이 살짝 기울어진다 ---------- */
  let lastY = window.scrollY;
  let vel = 0;
  let skew = 0;
  (function loop() {
    const y = window.scrollY;
    vel = vel * 0.8 + (y - lastY) * 0.2;
    lastY = y;
    const target = Math.max(-1, Math.min(1, vel / 40)) * 2.2;
    skew += (target - skew) * 0.18;
    root.style.setProperty("--fx-skew", Math.abs(skew) < 0.01 ? "0deg" : skew.toFixed(3) + "deg");
    requestAnimationFrame(loop);
  })();

  /* ---------- 카드 → 재생 창 전환 ----------
     누른 썸네일 카드 자리에서 재생 창이 커지며 펼쳐지고(FLIP), 닫으면 창이 카드 자리로 오그라들며 돌아간다.
     app.js 는 그대로 두고, 카드 위치만 클릭 때 기억해 두었다가 모달이 열리고 닫히는 순간(hidden 속성)에 이어 붙인다. */
  function bindFlip(modal, TRIGGER, PANEL) {
    if (!modal) return;
    let card = null;
    let from = null;
    let at = 0;
    let panelBox = null;
    document.addEventListener(
      "click",
      (e) => {
        const c = e.target.closest && e.target.closest(TRIGGER);
        if (!c) return;
        card = c;
        from = c.getBoundingClientRect();
        at = performance.now();
      },
      true
    );
    const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
    const flip = (r, to) => {
      const dx = to.left + to.width / 2 - (r.left + r.width / 2);
      const dy = to.top + to.height / 2 - (r.top + r.height / 2);
      return `translate(${dx}px, ${dy}px) scale(${to.width / r.width}, ${to.height / r.height})`;
    };
    new MutationObserver(() => {
      const panel = modal.querySelector(PANEL);
      if (!panel) return;
      if (!modal.hidden) {
        if (!from || performance.now() - at > 900) return;
        modal.classList.add("fx-flip");
        requestAnimationFrame(() => {
          const r = panel.getBoundingClientRect();
          panelBox = r;
          panel.animate(
            [{ transform: flip(r, from), opacity: 0.35, borderRadius: "16px" }, { transform: "none", opacity: 1, borderRadius: getComputedStyle(panel).borderRadius }],
            { duration: 560, easing: EASE }
          );
          Array.from(panel.children).forEach((k) => k.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 560, easing: "ease-out" }));
        });
      } else {
        modal.classList.remove("fx-flip");
        if (!card || !panelBox || !document.contains(card)) return;
        const to = card.getBoundingClientRect();
        const g = document.createElement("div");
        g.className = "fx-ghost";
        g.style.cssText = `left:${panelBox.left}px;top:${panelBox.top}px;width:${panelBox.width}px;height:${panelBox.height}px`;
        document.body.appendChild(g);
        g.animate([{ transform: "none", opacity: 1 }, { transform: flip(panelBox, to), opacity: 0.2, borderRadius: "16px" }], { duration: 420, easing: EASE }).finished.then(() => g.remove(), () => g.remove());
        card.animate([{ scale: "1.06", filter: "brightness(1.15)" }, { scale: "1", filter: "none" }], { duration: 480, easing: EASE, delay: 160 });
        panelBox = null;
      }
    }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }
  bindFlip(document.getElementById("videoModal"), ".grid > .card", ".modal-panel");
  bindFlip(document.getElementById("photoViewer"), ".photo-thumb", ".pv-panel");

  if (!fine) return; // 아래는 마우스가 있는 기기 전용

  /* ---------- 커서 링 ---------- */
  const ring = document.createElement("div");
  ring.className = "fx-cursor";
  ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring);
  let cx = -100, cy = -100, rx = -100, ry = -100;
  (function follow() {
    rx += (cx - rx) * 0.2;
    ry += (cy - ry) * 0.2;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    requestAnimationFrame(follow);
  })();
  const INTERACTIVE = "a, button, summary, .card, .photo-thumb, .dg-card, .dg-doc, input, select, label, [role=button]";
  document.addEventListener("pointermove", (e) => {
    cx = e.clientX;
    cy = e.clientY;
    ring.classList.add("is-on");
    ring.classList.toggle("is-link", !!e.target.closest(INTERACTIVE));
  });
  document.documentElement.addEventListener("pointerleave", () => ring.classList.remove("is-on"));

  /* ---------- 3D 기울기 + 커서를 따라오는 빛 ---------- */
  const TILT = ".card, .photo-thumb, .dg-card .dg-cover, .stat, .dg-chap-body, .dg-doc, .dg-member, .dg-subcard, .dg-rowcard";
  let tiltEl = null;
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest && e.target.closest(TILT);
    if (tiltEl && tiltEl !== el) reset(tiltEl);
    tiltEl = el || null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const big = r.width > 420;
    const max = big ? 3 : 9;
    el.classList.add("fx-on");
    el.style.setProperty("--ry", ((px - 0.5) * max * 2).toFixed(2) + "deg");
    el.style.setProperty("--rx", ((0.5 - py) * max * 2).toFixed(2) + "deg");
    el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
    el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
  });
  function reset(el) {
    el.classList.remove("fx-on");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
  }
  document.addEventListener("pointerleave", () => tiltEl && reset(tiltEl), true);

  /* ---------- 자석 버튼 ---------- */
  const MAGNET = ".icon-btn, .dg-btn, .history-expand-btn, .dg-chip, .btn-primary";
  let magEl = null;
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest && e.target.closest(MAGNET);
    if (magEl && magEl !== el) {
      magEl.style.translate = "";
      magEl = null;
    }
    if (!el) return;
    magEl = el;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
    const dy = (e.clientY - (r.top + r.height / 2)) * 0.28;
    el.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
  });

  /* ---------- 클릭 파티클 ---------- */
  const COLORS = ["#ff4d97", "#ff9ac4", "#ffd166", "#7ad7ff", "#b69cff"];
  document.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i");
      p.className = "fx-spark";
      const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
      const d = 34 + Math.random() * 46;
      p.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${COLORS[i % COLORS.length]};--s:${(0.5 + Math.random() * 0.9).toFixed(2)}`;
      document.body.appendChild(p);
      p.addEventListener("animationend", () => p.remove(), { once: true });
    }
  });
})();
