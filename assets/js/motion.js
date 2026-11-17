/* FLOVER-FLIX — 모션 (바닐라 JS)
   CSS 만으로는 안 되는 두 가지만 맡는다: 통계 숫자 카운트업, 카드 → 재생 창 전환(FLIP).
   "동작 줄이기"가 켜져 있으면 아무것도 하지 않는다.
   DOM 은 app.js 가 계속 다시 그리므로 이벤트는 위임하고 새 노드는 MutationObserver 로 처리한다. */

(() => {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* ---------- 숫자 카운트업 (화면에 들어올 때 한 번) ---------- */
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
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const v = Math.round(target * (1 - Math.pow(1 - p, 4)));
      el.textContent = v.toLocaleString("ko");
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
  const COUNT = ".stat b, .about-stats b, .dg-mv-views b";
  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(COUNT)) prepCount(node);
    node.querySelectorAll(COUNT).forEach(prepCount);
  }
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  scan(document.body);


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
            { duration: 420, easing: EASE }
          );
          Array.from(panel.children).forEach((k) => k.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 420, easing: "ease-out" }));
        });
      } else {
        modal.classList.remove("fx-flip");
        if (!card || !panelBox || !document.contains(card)) return;
        const to = card.getBoundingClientRect();
        const g = document.createElement("div");
        g.className = "fx-ghost";
        g.style.cssText = `left:${panelBox.left}px;top:${panelBox.top}px;width:${panelBox.width}px;height:${panelBox.height}px`;
        document.body.appendChild(g);
        g.animate([{ transform: "none", opacity: 1 }, { transform: flip(panelBox, to), opacity: 0.2, borderRadius: "16px" }], { duration: 340, easing: EASE }).finished.then(() => g.remove(), () => g.remove());
        
        panelBox = null;
      }
    }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  }
  bindFlip(document.getElementById("videoModal"), ".grid > .card", ".modal-panel");
  bindFlip(document.getElementById("photoViewer"), ".photo-thumb", ".pv-panel");
})();
