#!/usr/bin/env node
/* 이미지가 본문인 문서(docs.json 에서 layout: "cards")의 이미지를 받아 data/discography/img/<문서>/ 에 저장하고
   source/doc-images.json ({ 원본URL: { file, w, h } }) 에 적는다. build.js 는 이 목록에 있는 이미지만 문서에 싣는다.
   사용: node fetch-doc-images.js [문서이름 …]   (fetch.js 로 문서를 받은 뒤, build.js 앞에 실행)
   - 이미 받은 이미지는 건너뛴다(.cache/img + 목록). 요청 사이 1.2초 간격. 실패한 이미지는 목록에서 빼고 계속한다.
   - SVG 는 그대로, 나머지는 sharp 로 폭 640px WebP(투명 유지)로 저장한다.
   - 저작권은 각 권리자에게 있다. 팬 아카이브(비영리) 용도의 소형 사본만 보관한다. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const OUT = path.join(ROOT, "..", "..", "data", "discography", "img");
const CACHE = path.join(ROOT, ".cache", "img");
const LIST = path.join(ROOT, "source", "doc-images.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (t) => t.replace(/\(프로미스나인\)$/, "").replace(/^프로미스나인\//, "").replace(/[^0-9A-Za-z가-힣]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "docs.json"), "utf8")).filter((d) => d.layout === "cards" && !d.noImages); // noImages: true 인 문서(굿즈)는 이미지를 받지 않는다
const only = process.argv.slice(2);
const list = fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, "utf8")) : {};

async function download(url) {
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  const meta = file + ".json";
  if (fs.existsSync(file) && fs.existsSync(meta)) return { buf: fs.readFileSync(file), type: JSON.parse(fs.readFileSync(meta, "utf8")).type, cached: true };
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://namu.wiki/" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  fs.writeFileSync(meta, JSON.stringify({ type }));
  return { buf, type, cached: false };
}

(async () => {
  const sharp = require("sharp");
  let done = 0;
  let failed = 0;
  for (const d of docs) {
    const slug = slugify(d.title);
    if (only.length && !only.includes(slug)) continue;
    const mdFile = path.join(ROOT, "source", "docs", slug + ".md");
    if (!fs.existsSync(mdFile)) continue;
    const urls = [...new Set([...fs.readFileSync(mdFile, "utf8").matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => /^https:[/][/]i[.]namu[.]wiki[/]/.test(u)))];
    console.log(`${slug}: 이미지 ${urls.length}개`);
    fs.mkdirSync(path.join(OUT, slug), { recursive: true });
    for (const url of urls) {
      if (list[url] && fs.existsSync(path.join(OUT, "..", list[url].file))) continue;
      try {
        const { buf, type, cached } = await download(url);
        const id = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
        const isSvg = /svg/.test(type) || /\.svg(\?|$)/.test(url) || buf.slice(0, 300).toString().includes("<svg");
        let file, w = 0, h = 0;
        if (isSvg) {
          file = `img/${slug}/${id}.svg`;
          fs.writeFileSync(path.join(OUT, "..", file), buf);
        } else {
          file = `img/${slug}/${id}.webp`;
          const info = await sharp(buf, { animated: false }).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(OUT, "..", file));
          w = info.width;
          h = info.height;
        }
        list[url] = { file, w, h };
        done++;
        if (done % 20 === 0) {
          fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + "\n", "utf8"); // 중간 저장: 도중에 멈춰도 이어서 받는다
          console.log(`  … ${done}개 저장`);
        }
        if (!cached) await sleep(1200);
      } catch (e) {
        failed++;
        console.warn(`  실패: ${url.slice(0, 70)} (${e.message})`);
      }
    }
  }
  fs.writeFileSync(LIST, JSON.stringify(list, null, 1) + "\n", "utf8");
  console.log(`완료: 새로 ${done}개 저장, 실패 ${failed}개, 목록 ${Object.keys(list).length}개 → source/doc-images.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
