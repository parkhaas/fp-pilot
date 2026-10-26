#!/usr/bin/env node
/* FLOVER-FLIX 로컬 전용 편집 서버 (의존성 없음)

   사용:  node tools/admin-server.js [포트]      → http://127.0.0.1:8899/tools/admin/photogallery.html
   - 저장소 정적 파일을 보여 주고, 편집 내용은 data/overrides.json 에만 쓴다.
   - 127.0.0.1 에만 바인딩. Host/Origin 을 검사하고, 허용한 필드만 저장한다.
   - 수집기가 photos.json 등을 새로 쓰므로, 수동 편집은 반드시 overrides.json 으로 분리한다. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || process.argv[2] || 8899);
const OVERRIDES = path.join(ROOT, "data", "overrides.json");
const MAX_BODY = 2 * 1024 * 1024;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

/* 저장 가능한 필드만 남기고 형식을 강제한다 */
function sanitize(input) {
  const out = { photos: {} };
  const posts = (input && input.photos) || {};
  for (const [no, c] of Object.entries(posts)) {
    if (!/^\d{1,12}$/.test(no) || !c || typeof c !== "object") continue;
    const e = {};
    if (typeof c.title === "string" && c.title.trim() && !c.title.includes("�")) {
      e.title = c.title.trim().slice(0, 300); // U+FFFD = 깨진 인코딩이라 저장하지 않는다
    }
    if (c.hidden === true) e.hidden = true;
    if (Array.isArray(c.members)) {
      e.members = [...new Set(c.members.filter((m) => typeof m === "string" && /^[a-z0-9_]{1,30}$/.test(m)))].slice(0, 20);
    }
    if (Array.isArray(c.hideImages)) {
      const keys = [...new Set(c.hideImages.filter((k) => typeof k === "string" && /^[0-9a-f]{16}$/.test(k)))];
      if (keys.length) e.hideImages = keys;
    }
    if (Object.keys(e).length) out.photos[no] = e;
  }
  // 게시물 번호 내림차순으로 정렬해 diff 를 읽기 쉽게 한다
  out.photos = Object.fromEntries(Object.entries(out.photos).sort((a, b) => Number(b[0]) - Number(a[0])));
  return out;
}

function readOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  } catch (e) {
    return { photos: {} };
  }
}

function handleApi(req, res) {
  if (req.method === "GET") return send(res, 200, JSON.stringify(readOverrides()), MIME[".json"]);
  if (req.method !== "PUT") return send(res, 405, "method not allowed");

  // 다른 사이트의 요청(CSRF)을 막는다: 같은 출처의 JSON 요청만 허용
  if (req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, "bad origin");
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, "json only");

  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(res, 413, "too large");
      req.destroy();
    } else chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let data;
    try {
      data = sanitize(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch (e) {
      return send(res, 400, "invalid json");
    }
    const tmp = OVERRIDES + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, OVERRIDES);
    send(res, 200, JSON.stringify({ ok: true, posts: Object.keys(data.photos).length }), MIME[".json"]);
  });
}

http
  .createServer((req, res) => {
    if (!HOSTS.has(req.headers.host || "")) return send(res, 403, "forbidden host");
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/overrides") return handleApi(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");

    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch (e) {
      return send(res, 400, "bad path");
    }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(ROOT, "." + rel);
    const inside = path.relative(ROOT, file);
    // 저장소 밖, 점(.)으로 시작하는 경로(.git, .claude 등)는 내보내지 않는다
    if (inside.startsWith("..") || path.isAbsolute(inside) || inside.split(path.sep).some((s) => s.startsWith("."))) {
      return send(res, 403, "forbidden");
    }
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "not found");
      send(res, 200, req.method === "HEAD" ? "" : buf, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`포토갤러리 편집: http://127.0.0.1:${PORT}/tools/admin/photogallery.html`);
    console.log("종료: Ctrl+C   (저장 위치: data/overrides.json)");
  });
