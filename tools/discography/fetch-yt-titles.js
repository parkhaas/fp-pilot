/* 앨범 상세 문서(source/albums/*.md)에 임베드돼 있던 유튜브 영상의 제목을 oEmbed 로 받아 source/yt-titles.json 에 저장한다.
   build.js 가 방송·OST·참여 음반 카드의 영상 버튼 이름표로 쓴다 (제목을 못 받으면 "YouTube 영상"). 이미 받은 id 는 건너뛴다. */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "source");
const OUT = path.join(SRC, "yt-titles.json");
const titles = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const ids = new Set();
for (const f of fs.readdirSync(path.join(SRC, "albums")).filter((x) => x.endsWith(".md"))) {
  const md = fs.readFileSync(path.join(SRC, "albums", f), "utf8");
  for (const m of md.matchAll(/youtube\.com\/watch\?v=([\w-]{11})/g)) ids.add(m[1]);
}

(async () => {
  const todo = [...ids].filter((id) => !titles[id]);
  console.log(`영상 ${ids.size}개 중 제목 없는 것 ${todo.length}개`);
  for (const id of todo) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      titles[id] = String(j.title || "").trim();
      console.log(id, titles[id]);
    } catch (e) {
      console.log(id, "실패:", e.message); // 비공개·삭제된 영상: 기록하지 않고 build 가 "YouTube 영상"으로 표시
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  fs.writeFileSync(OUT, JSON.stringify(titles, null, 1) + "\n", "utf8");
})();
