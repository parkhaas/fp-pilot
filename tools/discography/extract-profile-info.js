#!/usr/bin/env node
/* 멤버 문서 오른쪽 위의 "인물 정보 표"(이름·출생·국적·본관·신체·가족·학력·소속사·상징 색·MBTI·좌우명·서명·링크 …)를
   캐시한 HTML(.cache/html/doc-<이름>.html)에서 뽑아 source/profile-info.json 에 구조화해서 저장한다.
   변환기(namu2md)는 문서 머리의 이 표를 건너뛰므로 따로 읽는다.
   사용: node extract-profile-info.js   (fetch.js 로 문서를 받은 뒤, build.js 앞에 실행) */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const ROOT = __dirname;
const members = JSON.parse(fs.readFileSync(path.join(ROOT, "docs.json"), "utf8")).filter((d) => d.kind === "member");
const slugify = (t) => t.replace(/\(프로미스나인\)$/, "").replace(/^프로미스나인\//, "").replace(/[^0-9A-Za-z가-힣]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const abs = (u) => (u.startsWith("//") ? "https:" + u : u.startsWith("/") ? "https://namu.wiki" + u : u);

// 셀 하나를 [{t:"text"|"br"|"a"|"img", ...}] 조각 목록으로
function parts($, node) {
  const out = [];
  const walk = (n) => {
    n.contents().each((i, c) => {
      const el = $(c);
      if (c.type === "text") {
        const t = c.data.replace(/\s+/g, " ");
        if (t.trim() || t === " ") out.push({ t: "text", v: t });
        return;
      }
      if (c.type !== "tag") return;
      const tag = c.tagName.toLowerCase();
      if (tag === "br") return out.push({ t: "br" });
      if (tag === "script" || tag === "style" || tag === "noscript") return;
      if (tag === "img") {
        if (el.attr("aria-hidden") === "true") return;
        const src = abs(el.attr("data-src") || el.attr("src") || "");
        if (!src || src.startsWith("data:")) return;
        return out.push({ t: "img", alt: (el.attr("alt") || "").trim(), src });
      }
      if (tag === "a") {
        const href = el.attr("href") || "";
        if (href.startsWith("#")) return; // 각주 번호
        const inner = parts($, el);
        return out.push({ t: "a", href: abs(href), title: (el.attr("title") || "").trim(), parts: inner });
      }
      // 블록 요소는 줄을 바꾼다
      const block = /^(div|p|li|tr)$/.test(tag);
      if (block && out.length && out[out.length - 1].t !== "br") out.push({ t: "br" });
      walk(el);
    });
  };
  walk(node);
  while (out.length && out[out.length - 1].t === "br") out.pop();
  return out;
}

const result = {};
for (const m of members) {
  const slug = slugify(m.title);
  const file = path.join(ROOT, ".cache", "html", `doc-${slug}.html`);
  if (!fs.existsSync(file)) {
    console.warn(`  캐시 없음: ${slug} (node fetch.js 먼저)`);
    continue;
  }
  const $ = cheerio.load(fs.readFileSync(file, "utf8"));
  const box = $("table")
    .filter((i, e) => /본관|국적/.test($(e).text()) && /출생/.test($(e).text()))
    .first();
  if (!box.length) {
    console.warn(`  인물 정보 표 없음: ${slug}`);
    continue;
  }
  const rows = box.find("tr").toArray().map((tr) => $(tr).children("td,th").toArray());
  // 첫 행: 이름(한글 / 한자 / 영문), 둘째 행: 프로필 사진
  const title = $(rows[0][0]).text().replace(/\s+/g, " ").trim();
  const hanja = (title.match(/[一-鿿]+/g) || []).join("");
  const en = (title.split("｜")[1] || "").trim();
  const ko = title.split(/[一-鿿]/)[0].trim();
  const out = [];
  for (const cells of rows.slice(2)) {
    const k = cells.length >= 2 ? $(cells[0]).text().replace(/\s+/g, " ").trim() : "";
    if (cells.length >= 2 && k && k.length <= 12 && !k.includes("<")) {
      out.push({ k, parts: parts($, $(cells[1])) });
    } else if (out.length) {
      // rowspan 으로 이어지는 값(출생지, 반려묘, 둘째 국적 등): 앞 항목 아래 줄에 붙인다
      const extra = cells.flatMap((c) => parts($, $(c)));
      if (extra.length) out[out.length - 1].parts.push({ t: "br" }, ...extra);
    }
  }
  result[slug] = { name: { ko: ko || m.title, hanja, en }, rows: out.filter((r) => r.k) };
  console.log(`${slug.padEnd(4)} ${hanja || "-"} ｜ ${en || "-"} · 항목 ${out.length}개: ${out.map((r) => r.k).join(", ")}`);
}
fs.writeFileSync(path.join(ROOT, "source", "profile-info.json"), JSON.stringify(result, null, 1) + "\n", "utf8");
