#!/usr/bin/env node
/* source/ 마크다운에서 "자세한 내용은 … 문서를 참고하십시오" 같은 안내 문장만 있는 소절을 찾는다.
   build.js 가 이런 소절을 숨긴다(주석 처리). 숨겨질 목록을 미리 보려고 쓴다.
   사용: node scan-pointers.js */
const fs = require("fs");
const path = require("path");
const { findPointerBlocks } = require("./lib/pointers");

const SRC = path.join(__dirname, "source");
let total = 0;
for (const dir of ["albums", "docs"]) {
  for (const f of fs.readdirSync(path.join(SRC, dir))) {
    const md = fs.readFileSync(path.join(SRC, dir, f), "utf8");
    for (const b of findPointerBlocks(md)) {
      total++;
      console.log(`${dir}/${f}  [${b.heading}]  ${b.body.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }
}
console.log(`\n안내 문장만 있는 소절 ${total}개`);
