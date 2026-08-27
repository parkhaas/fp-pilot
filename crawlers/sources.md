# `sources.json` 작성 가이드

`crawlers/youtube_crawler.py` 가 **무엇을 수집하고 어떤 카테고리로 분류할지**를 정의하는 파일입니다.
이 파일만 잘 채우면 나머지는 자동입니다.

---

## 1. 크롤러가 하는 일 (흐름)

```
sources.json
   │
   ├─ handle / channelId  ──▶  공식 채널의 "업로드 전체" 재생목록 자동 해석
   ├─ playlists[]          ──▶  지정한 재생목록들
   └─ extraChannels[]      ──▶  외부 채널의 특정 재생목록들
   │
   ▼  playlistItems.list 로 영상 ID 수집 (재생목록별 category 꼬리표 부여)
   ▼  videos.list 로 상세 조회 (길이 · 공개여부 · 임베드 가능여부)
   ▼  분류: 재생목록에 category 지정 → 그 값 사용
           category 가 "auto" → 제목/설명 키워드 + 길이로 자동 분류
   ▼  멤버 태깅: data/members.json 의 aliases 로 제목·설명에서 멤버 추정
   ▼  병합: 기존 data/videos.json 의 addedAt 보존 (신규만 현재시각)
   ▼  저장: data/videos.json, data/meta.json
```

수집 대상이 **여러 소스에 중복**되면 **나중에 나오는 소스**의 카테고리가 이깁니다.
순서는 `업로드 전체 → playlists → extraChannels`. 즉, 특정 재생목록에 넣어두면
"업로드 전체"의 자동 분류보다 항상 우선합니다.

---

## 2. 필드 레퍼런스

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `handle` | string | handle/channelId 중 하나 | 공식 채널 핸들. `@fromis_9` 형태(@ 있어도/없어도 됨). 매 실행마다 조회 1회 소모 |
| `channelId` | string | handle/channelId 중 하나 | `UC...` 형태. 채우면 handle 조회를 건너뜀(권장) |
| `includeUploads` | bool | 아니오 (기본 `true`) | 공식 채널의 **업로드 영상 전체**를 수집 대상에 포함 |
| `uploadsCategory` | string | 아니오 (기본 `"auto"`) | 업로드 전체에 적용할 카테고리. 보통 `"auto"` 로 두고 키워드 자동 분류 |
| `maxPerPlaylist` | number | 아니오 (기본 `500`) | 재생목록 하나당 가져올 최대 영상 수 (최신순) |
| `playlists[]` | array | 아니오 | 공식 채널 안의 재생목록들. 각 항목 `{ id, category, label }` |
| `playlists[].id` | string | — | 재생목록 ID(`PL...`). 비어 있으면 그 항목은 무시됨 |
| `playlists[].category` | string | — | 이 재생목록 영상의 카테고리. `"auto"` 면 자동 분류 |
| `playlists[].label` | string | — | 사람이 알아보기 위한 메모(크롤러는 사용 안 함) |
| `playlists[].members` | string[] | — | 이 재생목록 영상의 기본 멤버. 제목·설명에서 멤버가 검출되지 않을 때만 이 값을 씀 (예: 하냥카세 → `["hayoung"]`). `extraChannels[]` 에도 동일하게 쓸 수 있음 |
| `extraChannels[]` | array | 아니오 | **공식 외** 채널의 재생목록. 각 항목 `{ playlistId, category, label }` |
| `extraChannels[].playlistId` | string | — | 외부 재생목록 ID. 비어 있으면 무시 |
| `extraChannels[].filterKeywords` | string[] | — | 있으면 **제목에 이 키워드 중 하나라도 포함된 영상만** 수집(대소문자 무시, OR). 여러 아이돌이 섞인 큰 재생목록에서 특정 그룹만 골라낼 때. `playlists[]` 에도 동일 적용 |
| `extraChannels[].skipIncremental` | bool | — | `true` 면 `--since` 로 도는 **정기(증분) 크롤에서는 생략**하고, `--since` 없는 **수동 실행에서만** 수집. (예: 새 시즌 MC 가 우리 그룹이 아니게 된 컬래버 시리즈) `playlists[]` 에도 동일 적용 |
| `keywordRules` | object | 아니오 | `"auto"` 분류에 쓰는 카테고리별 키워드 목록 (아래 5·6절) |
| `maxShortsSeconds` | number | 아니오 (기본 `61`) | 이 길이(초) 이하면 무조건 `shorts` 로 분류 |
| `_comment` 등 `_` 로 시작하는 키 | any | — | 주석용. 크롤러가 무시하므로 자유롭게 메모 가능 |

> **카테고리 값 주의**: `category` 에 넣는 문자열은 `assets/js/config.js` 의 `categories[].id` 와
> **정확히 일치**해야 화면에 노출됩니다. 현재 유효한 값:
> `music_show`, `self_content`, `stage_fancam`, `mv_teaser`, `variety_external`, `shorts`, `"auto"`.
> 오타(예: `mv_teasers`)를 넣으면 그 영상들은 저장은 되지만 어느 탭에도 안 보입니다.

---

## 3. 채널 ID / 핸들 찾기

### 방법 A — 핸들 그대로 쓰기 (가장 쉬움)
브라우저에서 채널 주소가 `youtube.com/@fromis_9` 라면 핸들은 `@fromis_9`.
```json
"handle": "@fromis_9",
"channelId": ""
```

### 방법 B — 채널 ID 고정하기 (쿼터 절약·권장)
1. 채널 페이지 접속 → **채널 공유** → **채널 ID 복사** (`UC` 로 시작하는 24자)
2. 또는 채널 페이지에서 `보기 → 페이지 소스`, `"channelId":"UC...."` 검색
```json
"handle": "@fromis_9",
"channelId": "UCxxxxxxxxxxxxxxxxxxxxxx"
```

---

## 4. 재생목록 ID 찾기

재생목록을 연 주소가
`https://www.youtube.com/playlist?list=PLabcd1234EFGauto...` 이면
**`list=` 뒤의 값**(`PL...` 로 시작, 보통 34자)이 재생목록 ID입니다.

- 재생목록 안의 영상을 보고 있다면 주소가 `watch?v=xxxx&list=PL....` 형태 → 여기서도 `list=` 값
- **업로드 전체 재생목록은 직접 넣을 필요 없음** — `handle`/`channelId` 로 자동 해석됩니다
- 좋아하는 팬 계정이 큐레이션한 재생목록도 ID만 있으면 `extraChannels` 로 넣을 수 있음

---

## 5. 카테고리 결정 규칙 (우선순위)

한 영상의 카테고리는 아래 순서로 정해집니다.

1. **재생목록에 `category` 를 `"auto"` 가 아닌 값으로 지정** → 무조건 그 값
2. 지정이 없거나 `"auto"` → 아래 자동 분류:
   1. 영상 길이 ≤ `maxShortsSeconds` **또는** 제목·설명에 `keywordRules.shorts` 키워드 → **`shorts`**
   2. 아니면 다음 순서로 첫 매칭: **`stage_fancam` → `music_show` → `mv_teaser` → `self_content`**
   3. 아무것도 안 걸리면 → **`variety_external`** (기본값)

> 자동 분류의 검사 순서는 크롤러에 고정되어 있습니다(`stage_fancam` 이 `music_show` 보다 먼저).
> "직캠"이면서 "교차편집"인 영상은 `stage_fancam` 이 됩니다. 원치 않으면 해당 영상을
> `music_show` 재생목록에 넣어 1번 규칙으로 덮으세요.

### 언제 무엇을 쓰나

| 상황 | 넣을 곳 | category |
|---|---|---|
| 공식 채널의 자체콘텐츠 재생목록이 따로 있음 | `playlists` | `self_content` |
| 공식 채널 MV/티저 재생목록 | `playlists` | `mv_teaser` |
| 공식 채널 업로드에 잡다하게 섞여 있음 | `includeUploads: true` | `uploadsCategory: "auto"` |
| M2·스브스 등 외부 채널의 직캠 재생목록 | `extraChannels` | `stage_fancam` |
| 특정 음방 채널의 프로미스나인 무대 재생목록 | `extraChannels` | `music_show` |

---

## 6. `keywordRules` 작성법

`"auto"` 로 분류되는 영상에만 적용됩니다. **소문자로 비교**되고 **부분 일치**입니다
(제목+설명을 이어붙여 검사).

```json
"keywordRules": {
  "shorts":       ["#shorts", "shorts"],
  "stage_fancam": ["직캠", "fancam", "세로직캠", "4k 직캠", "focus cam"],
  "music_show":   ["교차편집", "stage mix", "인기가요", "음악중심", "뮤직뱅크",
                   "music bank", "엠카운트다운", "mcountdown", "쇼챔피언", "더쇼"],
  "mv_teaser":    ["m/v", "official mv", "teaser", "티저", "concept trailer",
                   "highlight medley", "예고편", "performance video", "special video"],
  "self_content": ["채널나인", "flowering", "비하인드", "behind", "메이킹",
                   "making", "브이로그", "vlog", "ep.", "다이어리"],
  "variety_external": []
}
```

팁:
- 오분류가 보이면 **키워드를 추가**하는 게 가장 빠른 교정입니다.
- `variety_external` 의 키워드는 사용되지 않습니다(항상 마지막 기본값이라서). 비워 두세요.
- 너무 일반적인 단어(`live`, `4k` 단독 등)는 오탐이 많으니 피하세요.
- `config.js` 에 **새 카테고리를 추가**한 경우, 자동 분류는 그 카테고리를 모릅니다.
  새 카테고리는 재생목록 `category` 로 직접 지정해서만 채워집니다.

---

## 7. 멤버 자동 태깅

`data/members.json` 의 `aliases` 로 **제목·설명에서** 멤버를 추정합니다(소문자·부분 일치).
하나도 안 걸리면 `["all"]`(전원).

```json
{ "id": "nagyung", "name": "이나경", "aliases": ["이나경", "나경", "nagyung", "lee nagyung"] }
```

- 특정 멤버 코너(하냥카세 등)는 재생목록에 `"members": ["hayoung"]` 를 지정하면
  제목에 이름이 없어도 그 멤버로 태깅됩니다(제목에서 다른 멤버가 잡히면 그쪽이 우선).
- 직캠처럼 특정 멤버 영상이 많은 소스인데 이름 표기가 제각각이면 alias 를 보강하세요.
- 두 글자 alias(`지원`, `지선`, `채영` 등)는 다른 단어에 우연히 포함될 수 있습니다.
  오탐이 잦으면 두 글자 alias 를 빼고 `박지원` / `노지선` 처럼 성을 붙인 형태만 남기세요.
- 크롤러는 멤버를 화면 필터용으로만 씁니다. 나중에 `data/videos.json` 을 직접 고쳐도 됩니다.

---

## 8. 전체 예시

### 8-1. 최소 구성 (공식 채널 업로드만, 전부 자동 분류)

```json
{
  "handle": "@fromis_9",
  "channelId": "",
  "includeUploads": true,
  "uploadsCategory": "auto",
  "maxPerPlaylist": 500,
  "playlists": [],
  "extraChannels": [],
  "keywordRules": {
    "shorts": ["#shorts", "shorts"],
    "stage_fancam": ["직캠", "fancam"],
    "music_show": ["교차편집", "stage mix", "인기가요", "음악중심", "뮤직뱅크", "mcountdown"],
    "mv_teaser": ["m/v", "official mv", "teaser", "티저"],
    "self_content": ["채널나인", "behind", "비하인드", "making", "메이킹", "vlog"],
    "variety_external": []
  },
  "maxShortsSeconds": 61
}
```

### 8-2. 권장 구성 (재생목록으로 정확히 나누고, 나머지는 자동)

```json
{
  "handle": "@fromis_9",
  "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "includeUploads": true,
  "uploadsCategory": "auto",
  "maxPerPlaylist": 800,

  "playlists": [
    { "id": "PL_selfcontent_id", "category": "self_content", "label": "채널나인 + 자체콘텐츠" },
    { "id": "PL_mv_id",          "category": "mv_teaser",     "label": "MV / 티저 / 퍼포먼스" },
    { "id": "PL_stage_id",       "category": "music_show",    "label": "음악방송 무대" }
  ],

  "extraChannels": [
    { "playlistId": "PL_m2_fancam_id",  "category": "stage_fancam", "label": "M2 직캠" },
    { "playlistId": "PL_sbs_fancam_id", "category": "stage_fancam", "label": "SBS KPOP 직캠" }
  ],

  "keywordRules": {
    "shorts": ["#shorts", "shorts"],
    "stage_fancam": ["직캠", "fancam", "세로직캠"],
    "music_show": ["교차편집", "stage mix", "인기가요", "음악중심", "뮤직뱅크", "music bank", "mcountdown", "엠카운트다운", "쇼챔피언", "더쇼", "the show"],
    "mv_teaser": ["m/v", "official mv", "teaser", "티저", "concept trailer", "highlight medley", "예고편", "special video", "performance video"],
    "self_content": ["채널나인", "flowering", "behind", "비하인드", "making", "메이킹", "vlog", "브이로그", "ep.", "다이어리"],
    "variety_external": []
  },
  "maxShortsSeconds": 61
}
```

### 8-3. 특정 멤버 팬채널 재생목록만 모으기

```json
"extraChannels": [
  { "playlistId": "PL_jiheon_fancam", "category": "stage_fancam", "label": "백지헌 직캠 모음" }
]
```
제목에 "백지헌"이 들어 있으면 멤버 태깅도 자동으로 `jiheon` 이 됩니다.

### 8-4. 여러 아이돌이 섞인 외부 예능 재생목록에서 우리 그룹만

```json
"extraChannels": [
  {
    "playlistId": "PLHqqPM2t7weLoaMZe5JLFB2iOVydteL9R",
    "category": "workdol",
    "label": "워크맨 · 워크돌",
    "members": ["jiwon"],
    "filterKeywords": ["프로미스나인"]
  }
]
```
128개 재생목록 중 제목에 "프로미스나인"이 있는 회차만 수집합니다.
`category` 값(`workdol`)은 `assets/js/config.js` 의 `categories[]` 에도 추가해야 탭이 보입니다.

---

## 8-5. `search` — 검색 기반 수집 (방송국 무대 / 직캠 / 킬링보이스 등)

재생목록이 없는 콘텐츠는 `search[]` 로 `search.list` API 를 씁니다.
**호출당 100 쿼터**이므로 `queries` · `channels` · `maxPerQuery` 로 범위를 좁히세요.

```jsonc
"searchPublishedAfter": "2024-01-01T00:00:00Z",   // search 공통 시작일

"defaultFilter": {                                 // filter 없는 search 항목에 적용
  "titleAny": ["프로미스나인", "fromis_9", "fromis9"],
  "excludeText": ["cover", "커버", "reaction", "리액션", "dance practice", "안무 연습"]
},

"search": [
  {
    "label": "방송국 무대·교차편집",
    "queries": ["프로미스나인 교차편집", "프로미스나인 무대"],
    "channelIds": ["UCeLPm9yH_a_QH8n6445G-Ow", "..."],  // 이 채널들로만 검색 (권장)
    "category": "music_show",
    "order": "date",           // date | relevance | viewCount
    "maxPerQuery": 40          // (쿼리 × 채널) 조합당 상한
  },
  {
    "label": "스페셜 (킬링보이스 등)",
    "queries": ["프로미스나인", "fromis_9"],
    "channels": ["@dingomusic", "@The_FirstTake"],       // 핸들도 가능 (자동 ID 변환)
    "category": "special_stage",
    "order": "relevance",
    "maxPerQuery": 25,
    "filter": { "titleAny": ["프로미스나인", "fromis"], "excludeText": ["cover", "리액션"] }
  }
]
```

- `channels`(핸들) 와 `channelIds`(UC..) 는 합쳐집니다. 하나라도 있으면 그 채널들 안에서만 검색.
  둘 다 없으면 **전체 검색**(노이즈 많음 → `filter` 를 빡세게).
- 검색 후보는 `videos.list` 상세 조회를 거쳐 아래 `filter` 규칙으로 최종 선별됩니다.
- 확보해 둔 채널 ID: `crawlers/sources.json` 의 `search[].channelIds` 주석 참고
  (KBS `UCeLPm9yH_a_QH8n6445G-Ow`, MBC `UCe52oeb7Xv_KaJsEzcKXJJg`,
   SBS `UCS_hnpJLQTvBkqALgapi_4g`, Mnet `UCqJ3rYYs-n5blu6JxpciQjA`,
   M2/MPD `UCbNC3nyv42BLe71Q9mW5H0Q`, 1theK `UCweOkPb1wVVH0Q0Tlj4a5Pw`).

---

## 8-6. `filter` — 상세 필터 규칙 (playlists · extraChannels · search 공용)

`filter` 는 `videos.list` 상세(제목·설명·채널명·길이·게시일)에 적용됩니다.
지정한 항목만 검사하며 **모두 AND** 로 동작합니다.

| 키 | 의미 |
|---|---|
| `titleAny` / `titleAll` | 제목에 (하나 이상 / 전부) 포함 |
| `textAny` / `textAll` | 제목+설명에 (하나 이상 / 전부) 포함 |
| `channelAny` | `channelTitle` 에 하나 이상 포함 (전체 검색 시 방송국만 남길 때) |
| `excludeText` | 제목+설명에 하나라도 있으면 **탈락** (커버·리액션·안무연습 등) |
| `excludeChannels` | `channelTitle` 에 하나라도 있으면 탈락 |
| `minSec` / `maxSec` | 영상 길이(초) 하한 / 상한 (`0` = 무제한). 예: 직캠만 원하면 `minSec: 60` |
| `publishedAfter` / `publishedBefore` | ISO8601 게시일 범위 |

- 모든 비교는 **소문자·부분 일치**.
- `playlists[]` / `extraChannels[]` 의 `filterKeywords: [...]` 는 `filter: { "titleAny": [...] }` 의 축약형입니다. 둘 다 있으면 `filter` 가 우선.
- `search[]` 항목에 `filter` 가 없으면 최상위 `defaultFilter` 가 적용됩니다(`filter: {}` 로 명시하면 필터 없음).

예 — 전체 검색에서 방송 4사 무대만, 30초 이상, 커버 제외:
```json
"filter": {
  "channelAny": ["kbs", "mbc", "sbs", "mnet", "m2", "1thek"],
  "excludeText": ["cover", "커버", "reaction", "리액션", "교차편집 by"],
  "minSec": 30
}
```

---

## 9. API 쿼터

- 기본 일일 한도 **10,000 유닛**.
- `playlistItems.list` · `videos.list` · `channels.list` = 호출당 **1 유닛**(최대 50개).
- **`search.list` = 호출당 100 유닛.** `search[]` 는 (쿼리 수 × 채널 수 × 페이지 수) 만큼
  호출되니 주의. 예: 쿼리 3 × 채널 6 × 1페이지 = 18호출 ≈ **1,800 유닛**.
- 영상 800개 재생목록 ≈ (16 페이지 + 16 상세) ≈ **32 유닛**.
- 쿼터 절약: `searchPublishedAfter` 를 최근으로 올리기, `maxPerQuery` 낮추기,
  `channels` 를 꼭 필요한 곳만, `order: "date"` 로 최신부터.
- `channelId` 를 채워두면 매 실행 `channels.list forHandle` 1회를 아낍니다.

### 전체 백필 vs 증분 수집

- `sources.json` 의 `searchPublishedAfter` 는 **전체 백필용**(예: 데뷔 연도). 로컬에서
  `--since` 없이 1회 실행해 과거 데이터를 모두 채웁니다. (`--dry-run` 도 실제 API 를
  호출하므로 여러 번 돌리면 그날 쿼터가 소진됩니다.)
- 정기 실행(`update-data.yml`)은 `--since <최근 날짜>` 를 넘겨 **최근 며칠만** 검색합니다.
  크롤러는 기존 `data/videos.json` 을 병합(기존 `addedAt` 보존, 신규만 추가)하므로
  백필 결과 위에 증분이 계속 쌓입니다.

```bash
# 전체 백필(로컬, 쿼터 여유 있을 때 1회)
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data

# 증분(정기) — 최근 30일만
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data --since 2025-08-01
```

### 쿼터 없이 백필: `collect_ytdlp.py` (yt-dlp)

`search.list` 쿼터(호출당 100)를 쓰기 싫거나 소진됐을 때, 같은 `sources.json` 을
읽어 **yt-dlp 스크래핑**으로 수집합니다. API 키·쿼터 불필요.

```bash
python -m pip install --user yt-dlp
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data           # 전체
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data --only search
```

- `search[]` 는 `youtube.com/channel/<ID>/search?query=` 탭을 flat 추출 → 2018 데뷔분까지 수집.
- flat 모드엔 description 이 없어 `textAny/textAll` 은 **제목 기준**으로만 검사됩니다.
- 기존 `data/videos.json` 과 병합(addedAt 보존) — API 데이터 위에 얹어도 됩니다.
- **GitHub Actions IP 는 봇 차단을 자주 맞으므로** 정기 수집은 API(`youtube_crawler.py`),
  이 스크립트는 **로컬 백필 전용**으로 쓰세요.

---

## 10. 자주 하는 실수

| 증상 | 원인 / 해결 |
|---|---|
| 실행은 되는데 영상 0개 | `handle` 오타, 또는 모든 `playlists[].id` 가 비어 있고 `includeUploads: false` |
| 특정 영상이 어느 탭에도 안 뜸 | `category` 값이 `config.js` id 와 불일치(오타). 5절 유효값 확인 |
| 직캠이 음악방송으로 들어감 | 자동 분류 순서상 키워드 경합. 해당 재생목록을 `stage_fancam` 으로 명시 |
| 라이브/예정 영상이 안 들어옴 | 의도된 동작. `liveBroadcastContent` 가 `live`/`upcoming` 이면 제외 |
| 비공개·임베드 불가 영상 누락 | 의도된 동작(`privacyStatus != public` 또는 `embeddable == false` 제외) |
| "추가된 순"이 매번 뒤섞임 | `data/videos.json` 을 커밋하지 않아 `addedAt` 이 유지되지 않음. Actions가 커밋하도록 두거나 로컬 결과를 커밋 |
| `HTTP 403 ... quota` 로 중단 | 쿼터 초과. `search[]` 가 원인인 경우가 많음 → `maxPerQuery`·쿼리 수 줄이기, `searchPublishedAfter` 올리기. 다음 날(태평양시간 자정) 초기화 |
| `HTTP 403 ... referer ... blocked` | API 키에 **HTTP 리퍼러 제한**이 걸림. 스크립트/Actions 에서는 못 씀 → Cloud Console 에서 애플리케이션 제한을 **없음**, API 제한만 YouTube Data API v3 로 |
| search 결과에 커버·리액션·직캠러 영상 섞임 | `filter.excludeText` / `filter.excludeChannels` 보강, `channels` 로 채널 제한, `filter.channelAny` 로 방송국만 |
| search 가 우리 그룹 아닌 영상까지 가져옴 | `defaultFilter.titleAny` 또는 항목별 `filter.titleAny` 에 그룹명 필수 지정 |

---

## 11. 실행 & 검증

```bash
export YOUTUBE_API_KEY="발급받은_키"

# 1) 먼저 미리보기 — 파일을 쓰지 않고 개수·카테고리 분포만 출력
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data --dry-run

# 2) 결과가 납득되면 실제 기록
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data
```

출력 예:
```
수집 742개 / 제외 18개 / 신규 742개
카테고리: {"music_show": 210, "mv_teaser": 41, "self_content": 96, "stage_fancam": 355, "shorts": 28, "variety_external": 12}
기록 완료 -> data/videos.json, data/meta.json
```

카테고리 분포가 이상하면 → `keywordRules` 보강 또는 재생목록 `category` 명시 후 다시 `--dry-run`.
로컬 확인: `python -m http.server 8080` → `http://localhost:8080`.

GitHub Actions 는 이 파일이 커밋되어 있으면 6시간마다 위 2)번을 자동 실행합니다.
