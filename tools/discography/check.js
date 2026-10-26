#!/usr/bin/env node
/* build.js 결과가 사이트에서 쓸 수 있는 상태인지 점검한다. 문제가 있으면 종료 코드 1.
   사용: node check.js */
const fs = require("fs");
const path = require("path");

const OUT = path.resolve(__dirname, "..", "..", "data", "discography");
const problems = [];
const warn = (m) => problems.push(m);

const idx = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"));
const ids = new Set();
let prev = "9999-99-99";

for (const a of idx.albums) {
  if (ids.has(a.id)) warn(`중복 id: ${a.id}`);
  ids.add(a.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.releaseDate)) warn(`${a.id}: 발매일 형식 이상 (${a.releaseDate})`);
  if (a.releaseDate > prev) warn(`${a.id}: 최신순 정렬이 깨졌습니다`);
  prev = a.releaseDate;
  if (!a.tracks.length) warn(`${a.id}: 수록곡 없음`);
  if (a.status !== "cancelled" && a.trackCount !== a.tracks.length) warn(`${a.id}: 곡 수 불일치 (표기 ${a.trackCount} / 파싱 ${a.tracks.length})`);
  if (a.status !== "cancelled" && !a.titleTracks.length) warn(`${a.id}: 타이틀곡 표시가 없습니다`);
  if (a.status !== "cancelled" && !a.cover) warn(`${a.id}: 커버 없음`);
  if (a.cover && !fs.existsSync(path.join(OUT, a.cover.file))) warn(`${a.id}: 커버 파일 없음 (${a.cover.file})`);
  if (a.hasDetail && !fs.existsSync(path.join(OUT, "albums", a.id + ".json"))) warn(`${a.id}: 상세 JSON 없음`);
  for (const t of a.tracks) if (!Object.keys(t.credits).length && a.status !== "cancelled") warn(`${a.id} ${t.no}. ${t.title}: 크레딧 없음`);
}

console.log(`앨범 ${idx.albums.length}개 점검, 최신 ${idx.albums[0] && idx.albums[0].releaseDate}`);
if (problems.length) {
  console.log(`\n확인할 것 ${problems.length}건`);
  problems.forEach((p) => console.log(" - " + p));
  process.exit(1);
}
console.log("문제 없음");
