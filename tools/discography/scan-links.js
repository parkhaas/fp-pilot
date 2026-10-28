#!/usr/bin/env node
/* data/discography 안에 남은 외부(나무위키) 링크를 세어 보여 준다.
   사용: node scan-links.js [--all]   (--all: 전체 목록) */
const fs = require("fs");
const path = require("path");

const D = path.resolve(__dirname, "..", "..", "data", "discography");
const cnt = {};
const scan = (txt) => {
  for (const m of txt.matchAll(/href=\\?"(https:\/\/namu\.wiki\/w\/[^"\\]+)/g)) {
    const u = decodeURIComponent(m[1]);
    cnt[u] = (cnt[u] || 0) + 1;
  }
};
for (const f of fs.readdirSync(path.join(D, "albums"))) scan(fs.readFileSync(path.join(D, "albums", f), "utf8"));
scan(fs.readFileSync(path.join(D, "extras.json"), "utf8"));
scan(fs.readFileSync(path.join(D, "index.json"), "utf8"));

const a = Object.entries(cnt).sort((x, y) => y[1] - x[1]);
console.log(`고유 ${a.length}개, 전체 ${a.reduce((s, x) => s + x[1], 0)}회`);
const lim = process.argv.includes("--all") ? a.length : 70;
console.log(a.slice(0, lim).map(([u, n]) => n + "\t" + u.replace("https://namu.wiki/w/", "")).join("\n"));
