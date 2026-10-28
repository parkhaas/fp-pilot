// "자세한 내용은 [문서] 문서를 참고하십시오" 처럼 다른 나무위키 문서로 안내하는 문장뿐인 소절을 찾는다.
// 소절 = 제목 줄(## ~ ######)부터 같거나 높은 단계의 다음 제목 직전까지. 하위 소절이 있으면 안내 문장뿐인 게 아니므로 대상이 아니다.

const POINTER = /(참고|참조)[^\n]*(하십시오|바랍니다|하세요)/;
const LINK = /\[[^\]]*\]\(https?:\/\/namu\.wiki\/[^)]*\)/;

// 줄 하나가 안내 문장인지 (나무위키 링크가 있고, 링크·괄호·조사를 빼고 나면 안내 문구만 남는 줄)
function isPointerLine(line) {
  const t = line.trim();
  return !!t && LINK.test(t) && POINTER.test(t);
}

function findPointerBlocks(md) {
  const lines = md.split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{2,6}) (.+)$/);
    if (m) heads.push({ i, level: m[1].length, title: m[2].trim() });
  });
  const out = [];
  heads.forEach((h, k) => {
    // 끝: 같거나 높은 단계의 다음 제목. 사이에 더 낮은 단계 제목이 있으면 건너뛴다(하위 소절 있음).
    let end = lines.length;
    let hasChild = false;
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].i;
        break;
      }
      hasChild = true;
    }
    if (hasChild) return;
    const body = lines.slice(h.i + 1, end).filter((l) => l.trim());
    if (body.length && body.every(isPointerLine)) out.push({ heading: h.title, level: h.level, from: h.i, to: end, body: body.join("\n") });
  });
  return out;
}

module.exports = { findPointerBlocks, isPointerLine };

// 사이트 안에 같은 문서가 있어 링크가 살아 있는 안내 문장은 남긴다 (resolvable 이 참을 돌려주는 링크가 하나라도 있으면)
function liveLink(line, resolvable) {
  if (!resolvable) return false;
  return [...line.matchAll(/\]\((https?:\/\/namu\.wiki\/w\/(?:[^()\s]|\([^()]*\))*)\)/g)].some((m) => resolvable(m[1]));
}

// 소절(제목 + 안내 문장뿐인 본문)을 HTML 주석으로 바꿔 숨긴다. 내용은 주석에 남아 있어 나중에 되살릴 수 있다.
function hidePointers(md, resolvable) {
  const lines = md.split("\n");
  const blocks = findPointerBlocks(md).filter((b) => !b.body.split("\n").some((l) => liveLink(l, resolvable)));
  for (const b of blocks.reverse()) {
    const orig = lines.slice(b.from, b.to).join("\n").replace(/--/g, "- -").trim();
    lines.splice(b.from, b.to - b.from, `<!-- hidden:pointer\n${orig}\n-->`, "");
  }
  // 소절 앞머리에 홀로 있는 안내 문장(하위 소절이 있어 소절 전체는 숨길 수 없는 경우)도 줄 단위로 주석 처리
  for (let i = 0; i < lines.length; i++) {
    if (isPointerLine(lines[i]) && !liveLink(lines[i], resolvable)) lines[i] = `<!-- hidden:pointer-line ${lines[i].replace(/--/g, "- -").trim()} -->`;
  }
  return lines.join("\n");
}

// "## 제목" 아래 본문 전체가 안내 문장뿐인지 (본문에 하위 제목이 없고, 살아 있는 링크가 없을 때)
function isPointerOnly(bodyMd, resolvable) {
  if (/^#{2,6} /m.test(bodyMd)) return false;
  const body = bodyMd.split("\n").filter((l) => l.trim());
  return body.length > 0 && body.every(isPointerLine) && !body.some((l) => liveLink(l, resolvable));
}

module.exports.hidePointers = hidePointers;
module.exports.isPointerOnly = isPointerOnly;
