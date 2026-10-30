/* data/videos.json(크롤러가 모은 영상 목록)에서 음악 방송 직캠을 골라, 나무위키 직캠 표(music-shows.js 의 parseFancams)와 같은 모양의 행으로 바꾼다.
   멤버별 직캠이 나무위키 표에는 없는 경우가 많아서, 제목에서 날짜·방송·곡을 읽어 무대 카드에 멤버 이름표 버튼으로 붙인다. */

const SHOWS = [
  [/m\s?countdown|엠\s?카운트다운/i, { cast: "엠넷", show: "엠 카운트다운" }],
  [/music\s?bank|뮤직뱅크/i, { cast: "KBS 2TV", show: "뮤직뱅크" }],
  [/inkigayo|인기가요/i, { cast: "SBS", show: "SBS 인기가요" }],
  [/music\s?core|음악중심|쇼!\s?음악/i, { cast: "MBC", show: "쇼! 음악중심" }],
  [/show\s?champion|쇼챔피언/i, { cast: "MBC M", show: "쇼챔피언" }],
  [/the\s?show|더\s?쇼/i, { cast: "SBS MTV", show: "더 쇼" }],
  [/simply\s?k/i, { cast: "Arirang TV", show: "Simply K-Pop" }],
  [/가요대축제/, { cast: "KBS", show: "KBS 가요대축제" }],
  [/가요대제전/, { cast: "MBC", show: "MBC 가요대제전" }],
  [/가요대전/, { cast: "SBS", show: "SBS 가요대전" }],
];

function parseDate(t) {
  let m = t.match(/(20\d\d)[.\-/](\d{1,2})[.\-/](\d{1,2})/) || t.match(/(?<!\d)(20\d\d)(\d\d)(\d\d)(?!\d)/);
  let y, mo, d;
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else {
    m = t.match(/(?<!\d)(\d\d)(\d\d)(\d\d)(?!\d)/);
    if (!m) return "";
    [y, mo, d] = ["20" + m[1], m[2], m[3]];
  }
  if (+y < 2018 || +y > 2030 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseSong(t) {
  const q = t.match(/['‘’“"]([^'‘’“”"]{2,}?)['‘’”"]/);
  if (q) return q[1].trim();
  const dash = t.match(/프로미스나인\s+\S+\s*[–-]\s*(.+?)\s*(?:직캠|Fancam|\()/i);
  return dash ? dash[1].trim() : "";
}

// "[안방1열 직캠4K] …" → "안방1열": 같은 무대에 같은 멤버의 직캠이 여러 개일 때 버튼을 구분하는 이름표
function variant(t) {
  const m = t.match(/^\[([^\]]+)\]/);
  if (!m) return "";
  return m[1].replace(/[#]/g, "").replace(/직캠|\s?[0-9]+K/gi, "").replace(/\s+/g, " ").trim();
}

// videos: videos.json 의 videos 배열, memberName: { id: "이름" }, skipIds: 이미 나무위키 표에 있는 영상 id 집합
function videoFancams(videos, memberName, skipIds) {
  const rows = [];
  for (const v of videos) {
    if (!/직캠|fancam|facecam/i.test(v.title)) continue;
    if (v.category !== "music_show" && v.category !== "stage_fancam") continue;
    if (skipIds.has(v.videoId)) continue;
    const date = parseDate(v.title);
    if (!date) continue;
    const hit = SHOWS.find(([re]) => re.test(v.title));
    const who = v.members && v.members.length === 1 ? v.members[0] : "";
    if (v.members && v.members.length > 1) continue; // 여러 명이 섞인 영상은 멤버별 버튼으로 둘 수 없다
    rows.push({
      date,
      show: hit ? hit[1].show : "",
      cast: hit ? hit[1].cast : "",
      song: parseSong(v.title),
      kind: "",
      label: who && who !== "all" ? memberName[who] || who : "단체",
      member: who,
      variant: variant(v.title),
      title: v.title,
      href: `https://www.youtube.com/watch?v=${v.videoId}`,
      etc: false,
    });
  }
  return rows;
}

module.exports = { videoFancams };
