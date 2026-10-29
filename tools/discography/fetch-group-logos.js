#!/usr/bin/env node
/* 프로미스나인 문서의 "로고" 소절에서 로고 이미지를 받아 data/discography/group/ 에 저장하고
   source/group-logos.json 에 목록을 적는다. 사용: node fetch-group-logos.js   (fetch.js 로 문서를 받은 뒤)
   - 대표 로고: alt "프로미스나인 로고" (밝은 배경용) / "프로미스나인 로고 화이트" (어두운 배경용)
   - 역대 활동별 로고: 로고 표(이미지 행과 앨범 캡션 행이 번갈아 나온다)에서 칸마다 이미지(들)와 캡션(앨범명·종류·발매일)을 짝지어 읽는다.
   SVG 는 그대로, 그 밖의 형식은 sharp 로 WebP(투명 유지)로 저장한다. 문서 사이 2초 간격, 받은 파일은 .cache/img 에 보관한다. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");

const ROOT = __dirname;
const OUT = path.join(ROOT, "..", "..", "data", "discography", "group");
const CACHE = path.join(ROOT, ".cache", "img");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (u) => (u.startsWith("//") ? "https:" + u : u);
const srcOf = ($, el) => abs($(el).attr("data-src") || $(el).attr("src") || "");

async function download(url) {
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const meta = path.join(CACHE, key + ".json");
  const file = path.join(CACHE, key);
  if (fs.existsSync(file) && fs.existsSync(meta)) return { buf: fs.readFileSync(file), type: JSON.parse(fs.readFileSync(meta, "utf8")).type };
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://namu.wiki/" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  fs.writeFileSync(meta, JSON.stringify({ type }));
  await sleep(1500);
  return { buf, type };
}

const saved = new Map(); // url → 저장된 상대 경로 (같은 이미지를 두 번 받지 않는다)
async function store(url, name) {
  if (saved.has(url)) return saved.get(url);
  const { buf, type } = await download(url);
  fs.mkdirSync(OUT, { recursive: true });
  let file;
  if (/svg/.test(type) || /\.svg(\?|$)/.test(url) || buf.slice(0, 200).toString().includes("<svg")) {
    file = name + ".svg";
    fs.writeFileSync(path.join(OUT, file), buf);
  } else {
    const sharp = require("sharp");
    file = name + ".webp";
    await sharp(buf).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 90 }).toFile(path.join(OUT, file));
  }
  const rel = "group/" + file;
  saved.set(url, rel);
  return rel;
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, ".cache", "html", "doc-프로미스나인.html"), "utf8");
  const $ = cheerio.load(html);

  // 대표 로고(밝은/어두운 배경용)
  const pick = (alt) => $("img").filter((i, e) => ($(e).attr("alt") || "").trim() === alt).first();
  const light = pick("프로미스나인 로고");
  const dark = pick("프로미스나인 로고 화이트");
  const main = {};
  if (light.length) main.light = await store(srcOf($, light), "logo");
  if (dark.length) main.dark = await store(srcOf($, dark), "logo-white");

  // 역대 활동별 로고 표: 행이 [로고 행, (워드마크 행), 앨범명 캡션 행] 묶음으로 반복된다.
  // 캡션 행(이미지 없이 글자만 있는 행)이 나오면 그 앞 로고 행의 칸마다 같은 칸 위치의 캡션을 짝지어 읽는다.
  // 한 칸에 이미지가 둘이면 (밝은 배경용, 흰색) 순서이고, 워드마크 행은 같은 칸 위치의 로고에 덧붙는 보조 이미지다.
  const realImgs = (cell) => $(cell).find("img").toArray().filter((e) => !srcOf($, e).startsWith("data:"));
  let table = null;
  $("table").each((i, t) => {
    if (table) return;
    const alts = $(t).find("img").toArray().map((e) => ($(e).attr("alt") || "").trim());
    // 로고 표: 앨범별 로고(alt 에 "로고(")가 많고, 캡션에 "데뷔 전"이 들어 있다
    if (alts.filter((x) => /로고\(/.test(x)).length >= 12 && $(t).text().includes("데뷔 전") && $(t).find("table").length === 0) table = t;
  });
  if (!table) throw new Error("역대 활동별 로고 표를 찾지 못했습니다 (나무위키 문서 구조가 바뀌었을 수 있음)");
  // rowspan/colspan 을 풀어 (행, 열) 격자로 만든다. 칸마다 { cell, origin } — origin 이 true 인 칸만 실제 위치다.
  const trs = $(table).find("tr").toArray();
  const grid = trs.map(() => []);
  trs.forEach((tr, r) => {
    let c = 0;
    for (const cell of $(tr).children("td,th").toArray()) {
      while (grid[r][c]) c++;
      const rs = Number($(cell).attr("rowspan") || 1);
      const cs = Number($(cell).attr("colspan") || 1);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (grid[r + dr]) grid[r + dr][c + dc] = { cell, origin: dr === 0 && dc === 0 };
      c += cs;
    }
  });
  const cols = Math.max(...grid.map((g) => g.length));
  const items = [];
  let groupStart = 0;
  for (let r = 0; r < trs.length; r++) {
    const isCaption = grid[r].every((g) => !g || !g.origin || realImgs(g.cell).length === 0) && grid[r].some((g) => g && g.origin && $(g.cell).text().trim());
    if (!isCaption) continue;
    for (let c = 0; c < cols; c++) {
      const g = grid[r][c];
      if (!g || !g.origin) continue;
      const label = $(g.cell).text().replace(/\s+/g, " ").trim();
      if (!label || label === "데뷔 전") continue;
      // 같은 열의 위쪽 칸들(이 묶음 안)에 든 이미지: 로고(밝은 배경용) → 로고 화이트 → 워드마크 순
      const imgs = [];
      for (let k = groupStart; k < r; k++) {
        const u = grid[k][c];
        if (u && u.origin) imgs.push(...realImgs(u.cell));
      }
      if (!imgs.length) continue;
      const files = [];
      for (let k = 0; k < imgs.length; k++) {
        const alt = ($(imgs[k]).attr("alt") || "").trim();
        files.push({ alt, file: await store(srcOf($, imgs[k]), `logo-${items.length + 1}-${k + 1}`) });
      }
      items.push({ label, files });
      process.stdout.write(`  ${label}: ${files.map((f) => f.alt.slice(0, 18)).join(" / ")}
`);
    }
    groupStart = r + 1;
  }
  fs.writeFileSync(path.join(ROOT, "source", "group-logos.json"), JSON.stringify({ main, items }, null, 1) + "\n", "utf8");
  console.log(`대표 로고 ${Object.keys(main).length}개 · 활동별 로고 ${items.length}개 → source/group-logos.json, data/discography/group/`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
