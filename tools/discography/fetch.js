#!/usr/bin/env node
/* 나무위키 '프로미스나인/음반' 문서와, 각 앨범의 "자세한 내용은 … 문서를 참고하십시오" 상세 문서를 가져와
   마크다운(source/)으로 저장한다.

   사용:
     node fetch.js                 메인 + 아직 없는 상세 문서만 가져온다 (새 앨범 추가 시 이것만 실행)
     node fetch.js --refresh       캐시를 무시하고 전부 다시 가져온다
     node fetch.js --only 3,5      상세 문서 중 번호(source/details.json 순서) 지정
     node fetch.js --md-only       네트워크 없이 캐시한 HTML 로 마크다운만 다시 만든다 (변환기 수정 후)

   예의: robots.txt 가 /w/ 조회를 허용한다. 문서 사이에 2초 간격을 두고 HTML 은 .cache/ 에 보관해 재요청을 피한다.
   결과물은 CC BY-NC-SA 2.0 KR 이므로 출처 머리말이 붙는다. */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { convert } = require("./lib/namu2md");

const ROOT = __dirname;
const ORIGIN = "https://namu.wiki";
const MAIN_PATH = "/w/%ED%94%84%EB%A1%9C%EB%AF%B8%EC%8A%A4%EB%82%98%EC%9D%B8/%EC%9D%8C%EB%B0%98"; // 프로미스나인/음반
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const DELAY_MS = 2000;

const CACHE = path.join(ROOT, ".cache", "html");
const SRC = path.join(ROOT, "source");
const ALBUMS = path.join(SRC, "albums");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const refresh = flag("--refresh");
const mdOnly = flag("--md-only");
const onlyIdx = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",").map(Number)) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (title) =>
  title
    .replace(/\(프로미스나인\)$/, "")
    .replace(/^프로미스나인\//, "")
    .replace(/[^0-9A-Za-z가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

async function getHtml(key, urlPath) {
  const file = path.join(CACHE, key + ".html");
  if ((mdOnly || !refresh) && fs.existsSync(file)) return { html: fs.readFileSync(file, "utf8"), cached: true };
  if (mdOnly) throw new Error(`캐시 없음: ${key}`);
  const res = await fetch(new URL(urlPath, ORIGIN).href, { headers: { "User-Agent": UA, "Accept-Language": "ko" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${urlPath}`);
  const html = await res.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, html);
  await sleep(DELAY_MS);
  return { html, cached: false };
}

// 메인 문서에서 "자세한 내용은 [문서] 문서를 참고하십시오" 링크 목록을 뽑는다
function extractDetails(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];
  $("a").each((i, a) => {
    const text = $(a).parent().text();
    if (!(/자세한 내용은/.test(text) && /문서를 참고하십시오/.test(text))) return;
    const href = ($(a).attr("href") || "").split("#")[0];
    if (!href.startsWith("/w/") || seen.has(href)) return;
    seen.add(href);
    const title = $(a).attr("title") || $(a).text();
    out.push({ title, href, slug: slugify(title), url: new URL(href, ORIGIN).href });
  });
  return out;
}

(async () => {
  fs.mkdirSync(ALBUMS, { recursive: true });

  const main = await getHtml("main", MAIN_PATH);
  const mainUrl = ORIGIN + MAIN_PATH;
  fs.writeFileSync(path.join(SRC, "00-음반-목록.md"), convert(main.html, mainUrl), "utf8");
  console.log(`메인 문서 ${main.cached ? "(캐시)" : "(새로 받음)"} → source/00-음반-목록.md`);

  const details = extractDetails(main.html);
  fs.writeFileSync(path.join(SRC, "details.json"), JSON.stringify(details, null, 1) + "\n", "utf8");
  console.log(`상세 문서 ${details.length}개 확인`);

  let fetched = 0;
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const out = path.join(ALBUMS, d.slug + ".md");
    if (onlyIdx && !onlyIdx.has(i + 1)) continue;
    if (!refresh && !mdOnly && !onlyIdx && fs.existsSync(out)) continue; // 이미 있으면 건너뜀(새 문서만)
    try {
      const r = await getHtml("doc-" + d.slug, d.href);
      fs.writeFileSync(out, convert(r.html, d.url), "utf8");
      fetched++;
      console.log(`  ${String(i + 1).padStart(2)}. ${d.title} ${r.cached ? "(캐시)" : ""} → source/albums/${d.slug}.md`);
    } catch (e) {
      console.error(`  ${String(i + 1).padStart(2)}. ${d.title} 실패: ${e.message}`);
    }
  }
  console.log(fetched ? `완료: ${fetched}개 문서 갱신` : "새로 받을 문서 없음");

  // docs.json 에 적은 주요 문서(그룹·멤버·응원법 등): 본문의 나무위키 링크를 사이트 안 페이지로 바꾸기 위해 함께 받는다
  const DOCS = path.join(SRC, "docs");
  fs.mkdirSync(DOCS, { recursive: true });
  const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "docs.json"), "utf8"));
  let docN = 0;
  for (const d of docs) {
    const href = "/w/" + encodeURIComponent(d.title).replace(/%2F/g, "/");
    const slug = slugify(d.title);
    const out = path.join(DOCS, slug + ".md");
    if (!refresh && !mdOnly && fs.existsSync(out)) continue;
    try {
      const r = await getHtml("doc-" + slug, href);
      fs.writeFileSync(out, convert(r.html, new URL(href, ORIGIN).href, { repeatRowspan: true, keepImages: d.layout === "cards" && !d.noImages, dropImages: !!d.noImages }), "utf8");
      docN++;
      console.log(`  문서 ${d.title} ${r.cached ? "(캐시)" : ""} → source/docs/${slug}.md`);
    } catch (e) {
      console.error(`  문서 ${d.title} 실패: ${e.message}`);
    }
  }
  console.log(docN ? `주요 문서 ${docN}개 갱신` : "새로 받을 주요 문서 없음");
})();
