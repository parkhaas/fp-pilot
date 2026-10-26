// 나무위키 문서 HTML → 마크다운 변환기 (cheerio)
// 모듈: const { convert } = require("./lib/namu2md");  CLI: node lib/namu2md.js <in.html> <out.md> [출처 URL]
// 나무위키 문서는 CC BY-NC-SA 2.0 KR. 변환 결과에는 출처·라이선스 머리말을 붙인다.
const cheerio = require("cheerio");
const fs = require("fs");

const ORIGIN = "https://namu.wiki";
const abs = (u) => {
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return ORIGIN + u;
  return u;
};
const clean = (s) => s.replace(/ /g, " ");

function convert(html, sourceUrl) {
  const $ = cheerio.load(html);
  // 유튜브 임베드는 링크로 바꿔 남긴다 (나머지 iframe 은 제거)
  $("iframe").each((i, f) => {
    const m = ($(f).attr("src") || "").match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/);
    if (m) $(f).replaceWith(`<a href="https://www.youtube.com/watch?v=${m[1]}">▶ YouTube</a>`);
    else $(f).remove();
  });
  $("script,style,noscript,svg,iframe").remove();
  // 편집 링크·광고·툴팁 제거
  $("a").filter((i, e) => /^\[편집\]$/.test($(e).text().trim())).remove();
  $("[aria-hidden=true]").remove();

  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  // 본문 루트: 모든 헤딩의 공통 조상
  const heads = $("h1,h2,h3,h4,h5,h6").toArray();
  let root = $(heads[0]).parent();
  while (root.length && heads.some((h) => !$.contains(root.get(0), h)) && root.parent().length) root = root.parent();

  const footnotes = {};
  // 각주 본문 수집 (id가 fn- 로 시작)
  $("[id^='fn-']").each((i, e) => {
    const id = $(e).attr("id");
    const txt = $(e).parent().text().replace(/\s+/g, " ").trim();
    if (id && !footnotes[id]) footnotes[id] = txt;
  });

  function inline(node) {
    return clean(
      node
        .contents()
        .toArray()
        .map((c) => walk($(c)))
        .join("")
    );
  }

  let tableDepth = 0; // 표 셀 안에서 만난 표는 한 줄로 평탄화한다

  function cellText(td) {
    let t = block(td).replace(/\n{2,}/g, "\n").trim().replace(/\n/g, "<br>").replace(/\|/g, "\\|");
    return t;
  }

  // 셀 안의 중첩 표: 행은 <br>, 칸은 " / " 로 이어 붙인 한 줄 텍스트
  function inlineTable(tbl) {
    const rows = [];
    tbl.find("tr").each((i, tr) => {
      const cells = $(tr)
        .children("td,th")
        .toArray()
        .map((td) => block($(td)).replace(/\s*\n\s*/g, " ").trim())
        .filter(Boolean);
      if (cells.length) rows.push(cells.join(" / "));
    });
    return rows.join("<br>");
  }

  function tableToMd(tbl) {
    // "펼치기·접기" 같은 래퍼: 모든 행이 한 칸뿐인 표는 내용을 그대로 풀어 쓴다(안쪽 표는 진짜 표로 유지)
    const trs = tbl.children("tbody,thead,tfoot").add(tbl).children("tr").toArray();
    const single = trs.length && trs.every((tr) => {
      const tds = $(tr).children("td,th");
      return tds.length === 1 && !(parseInt(tds.attr("colspan") || "1", 10) > 1);
    });
    if (single) {
      return trs.map((tr) => block($(tr).children("td,th").first()).trim()).filter(Boolean).join("\n\n");
    }
    tableDepth++;
    try {
      return tableToMdGrid(tbl);
    } finally {
      tableDepth--;
    }
  }

  function tableToMdGrid(tbl) {
    const rows = [];
    tbl.children("tbody,thead,tfoot").add(tbl).children("tr").each((i, tr) => {
      const cells = [];
      $(tr).children("td,th").each((j, td) => {
        cells.push({
          text: cellText($(td)),
          cs: parseInt($(td).attr("colspan") || "1", 10) || 1,
          rs: parseInt($(td).attr("rowspan") || "1", 10) || 1,
        });
      });
      rows.push(cells);
    });
    if (!rows.length) return "";
    // 격자 만들기 (rowspan/colspan 은 빈 칸으로 채움)
    const grid = [];
    rows.forEach((cells, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      cells.forEach((cell) => {
        while (grid[r][c] !== undefined) c++;
        for (let dr = 0; dr < cell.rs; dr++) {
          grid[r + dr] = grid[r + dr] || [];
          for (let dc = 0; dc < cell.cs; dc++) {
            grid[r + dr][c + dc] = dr === 0 && dc === 0 ? cell.text : "";
          }
        }
        c += cell.cs;
      });
    });
    const width = Math.max(...grid.map((r) => (r ? r.length : 0)));
    const norm = grid.filter(Boolean).map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? "" : r[i])));
    if (!norm.length || width === 0) return "";
    if (width === 1) return norm.map((r) => r[0]).filter(Boolean).join("\n\n"); // 1열 표는 그냥 문단
    const line = (r) => "| " + r.join(" | ") + " |";
    return [line(norm[0]), "| " + norm[0].map(() => "---").join(" | ") + " |", ...norm.slice(1).map(line)].join("\n");
  }

  function block(node) {
    return clean(
      node
        .contents()
        .toArray()
        .map((c) => walk($(c)))
        .join("")
    );
  }

  function walk(n) {
    const el = n.get(0);
    if (!el) return "";
    if (el.type === "text") return el.data.replace(/\s+/g, " ");
    if (el.type !== "tag") return "";
    const tag = el.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const lvl = Number(tag[1]);
      let t = n.text().replace(/\s+/g, " ").trim().replace(/^\d+(\.\d+)*\.\s*/, "");
      // 링크가 있으면 링크 마크다운 유지
      return `\n\n${"#".repeat(Math.min(lvl, 6))} ${t}\n\n`;
    }
    if (tag === "br") return "\n";
    if (tag === "img") {
      const src = abs(n.attr("data-src") || n.attr("src"));
      const alt = (n.attr("alt") || "").trim();
      if (!src || src.startsWith("data:") || /\.svg(\?|$)/.test(src) || /아이콘/.test(alt)) return "";
      return `![${alt}](${src})`;
    }
    if (tag === "a") {
      const href = n.attr("href") || "";
      const text = inline(n).trim();
      if (!text) {
        // 이미지만 있는 링크
        return inline(n);
      }
      if (href.startsWith("#") || !href) return text;
      return `[${text}](${abs(href)})`;
    }
    if (tag === "sup" || (tag === "a" && /^fn-/.test(n.attr("id") || ""))) return "";
    if (tag === "b" || tag === "strong") {
      const t = inline(n).trim();
      return t ? `**${t}**` : "";
    }
    if (tag === "i" || tag === "em") {
      const t = inline(n).trim();
      return t ? `*${t}*` : "";
    }
    if (tag === "del" || tag === "s") {
      const t = inline(n).trim();
      return t ? `~~${t}~~` : "";
    }
    if (tag === "table") {
      // 안쪽 표는 셀 안에서 평탄화되어 들어온다
      if (tableDepth > 0) return inlineTable(n);
      return `\n\n${tableToMd(n)}\n\n`;
    }
    if (tag === "ul" || tag === "ol") {
      const items = n
        .children("li")
        .toArray()
        .map((li, i) => {
          const t = block($(li)).trim().replace(/\n+/g, " ");
          return (tag === "ol" ? `${i + 1}. ` : "- ") + t;
        });
      return `\n\n${items.join("\n")}\n\n`;
    }
    if (tag === "li") return `\n- ${inline(n).trim()}`;
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "blockquote") {
      const t = block(n);
      return t.trim() ? `\n${t}\n` : "";
    }
    if (tag === "tr" || tag === "td" || tag === "th" || tag === "tbody" || tag === "thead") return block(n);
    return inline(n); // span 등
  }

  let md = block(root);
  // 정리
  md = md
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(\n- [^\n]*)\n(?=- )/g, "$1\n")
    .trim();

  // 상단: h1 + 최근 수정 시각만 남기고 첫 ## 이전의 사이트 공통 요소 제거
  {
    const h1 = md.match(/^# [^\n]+/m);
    const mod = md.match(/최근 수정 시각[^\n]*/);
    const first = md.search(/\n## /);
    if (h1 && first > 0) md = h1[0] + "\n\n" + (mod ? "*" + mod[0].trim() + "*\n\n" : "") + md.slice(first).trimStart();
  }
  // 하단: 광고 표·라이선스 푸터 제거 (문서 제목을 alt 로 가진 이미지로 시작하는 표, 또는 CC 푸터)
  {
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ad = md.search(new RegExp("\\n\\| !\\[" + esc + "\\]"));
    const cc = md.indexOf("![크리에이티브 커먼즈 라이선스]");
    const cut = [ad, cc].filter((x) => x > md.length * 0.5).sort((a, b) => a - b)[0];
    if (cut !== undefined) md = md.slice(0, cut).trimEnd();
  }
  md = md.replace(/\n{3,}/g, "\n\n");


  const fm = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source: ${sourceUrl || ""}`,
    "license: CC BY-NC-SA 2.0 KR (나무위키)",
    `fetched: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
  ].join("\n");
  const note = `> 이 문서는 [나무위키](${sourceUrl || ORIGIN})의 내용을 [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/) 조건에 따라 옮겨 정리한 것입니다. 원문의 저작자는 나무위키 기여자들입니다.\n\n`;
  return fm + note + md + "\n";
}

module.exports = { convert };

if (require.main === module) {
  const [, , inFile, outFile, src] = process.argv;
  const out = convert(fs.readFileSync(inFile, "utf8"), src);
  fs.writeFileSync(outFile, out, "utf8");
  console.log(`${outFile}: ${out.length.toLocaleString()} chars, ${out.split("\n").length} lines`);
}
