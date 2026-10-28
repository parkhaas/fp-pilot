#!/usr/bin/env node
/* 멤버 프로필 사진 주소를 모아 source/profiles.json 에 저장한다.
   - 현재 멤버: 그룹 문서(source/docs/프로미스나인.md)의 멤버 표에 있는 최신 앨범 프로필
   - 전 멤버: "<이름>/프로미스나인 활동" 문서의 역대 프로필 중 마지막 것
   사용: node fetch-profiles.js   (새 앨범/멤버 변경 뒤 fetch.js 다음에 실행, 그다음 build.js) */
const fs = require("fs");
const path = require("path");
const { convert } = require("./lib/namu2md");

const ROOT = __dirname;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const CACHE = path.join(ROOT, ".cache", "html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const members = JSON.parse(fs.readFileSync(path.join(ROOT, "docs.json"), "utf8")).filter((d) => d.kind === "member");
const slugify = (t) => t.replace(/\(프로미스나인\)$/, "").replace(/[^0-9A-Za-z가-힣]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
const imgs = (md) => [...md.matchAll(/!\[([^\]]*)\]\((https:\/\/i\.namu\.wiki\/[^)\s]+)\)/g)].map((m) => ({ alt: m[1], url: m[2] }));

async function subDoc(name) {
  const title = `${name}/프로미스나인 활동`;
  const f = path.join(CACHE, `profile-${slugify(name)}.html`);
  let html;
  if (fs.existsSync(f)) html = fs.readFileSync(f, "utf8");
  else {
    const res = await fetch("https://namu.wiki/w/" + encodeURIComponent(title).replace(/%2F/g, "/"), { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    html = await res.text();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(f, html);
    await sleep(2000);
  }
  return convert(html, "https://namu.wiki/w/" + title);
}

(async () => {
  const group = fs.readFileSync(path.join(ROOT, "source", "docs", "프로미스나인.md"), "utf8");
  const fromGroup = imgs(group).filter((i) => /프로필/.test(i.alt));
  const out = {};
  for (const m of members) {
    const name = m.title.replace(/\(프로미스나인\)$/, "");
    const slug = slugify(m.title);
    let pick = m.status === "current" ? fromGroup.find((i) => i.alt.includes(name)) : null;
    if (!pick) {
      const md = await subDoc(name);
      // 역대 프로필은 앨범 순서대로 나오고, 그 뒤에 방송 캡처(주간 아이돌 등)가 이어진다. 방송 캡처 앞까지 중 마지막이 최신 프로필
      const all = md ? imgs(md).filter((i) => i.alt.includes(name) || /^[^ ]/.test(i.alt)) : [];
      const cut = all.findIndex((i) => /주간|재밍|로고/.test(i.alt));
      const list = (cut < 0 ? all : all.slice(0, cut)).filter((i) => i.alt.includes(name));
      pick = list[list.length - 1];
    }
    if (pick) out[slug] = { name, url: pick.url, alt: pick.alt };
    console.log(name.padEnd(4), pick ? pick.alt : "(없음)");
  }
  fs.writeFileSync(path.join(ROOT, "source", "profiles.json"), JSON.stringify(out, null, 1) + "\n", "utf8");
})();
