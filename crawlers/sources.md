# `sources.json` 작성 가이드

`crawlers/sources.json` 하나가 **무엇을 수집하고 어떤 카테고리로 분류할지**를 정의합니다.
두 크롤러가 같은 파일을 읽습니다.

| 크롤러 | 방식 | 용도 |
|---|---|---|
| `youtube_crawler.py` | YouTube Data API v3 (키·쿼터 필요) | **정기 증분 — 영상** (GitHub Actions) |
| `collect_ytdlp.py` | yt-dlp 스크래핑 (키·쿼터 불필요) | **로컬 대량 백필** + **정기 증분 — 쇼츠** (`--only shorts`) |

> API 는 `/shorts` 탭을 못 주므로 쇼츠는 항상 yt-dlp 로 수집한다. 정기 수집(`update-data.yml`)은
> API 로 영상을 갱신한 뒤 `collect_ytdlp.py --only shorts` 를 best-effort 로 얹는다
> (GitHub IP 가 봇 차단되면 그 스텝만 건너뛰고 기존 쇼츠 유지). 자세한 흐름은 11절.

---

## 1. 수집 흐름

```
sources.json
   ├─ handle / channelId  ─▶ (includeUploads:true 일 때) 공식 채널 업로드 전체
   ├─ playlists[]          ─▶ 공식 채널 안 재생목록
   ├─ extraChannels[]      ─▶ 외부 채널 재생목록 (워크돌·채널나인·성수기 등)
   ├─ search[]             ─▶ 채널 내 검색 (방송국 무대·직캠·스페셜) — 재생목록 없는 콘텐츠
   └─ shortsChannels[]     ─▶ 채널 /shorts 탭 (collect_ytdlp.py 전용)
        │
        ▼ 후보 videoId 수집 (소스별 category·members·filter 꼬리표)
        ▼ 상세 조회 (제목·길이·공개여부·임베드 가능여부; API 는 설명도)
        ▼ filter 규칙 적용 (커버·리액션·비(非)fromis 제외 등)
        ▼ 카테고리 확정 (소스 지정값 우선, "auto" 는 키워드 분류)
        ▼ 멤버 태깅 (data/members.json aliases 로 제목에서 추정)
        ▼ 병합 (기존 data/videos.json 의 addedAt 보존, 신규만 현재시각)
        ▼ 저장: data/videos.json, data/meta.json
```

한 영상이 **여러 소스에 겹치면**: `playlists`/`extraChannels` 가 먼저 잡고,
`search[]` 는 이미 잡힌 건 건드리지 않습니다(그 분류 유지). URL 이 `/shorts/` 형태면
`shorts` 로 덮어씁니다.

---

## 2. 필드 레퍼런스

### 최상위

| 필드 | 타입 | 기본 | 설명 |
|---|---|---|---|
| `handle` | string | — | 공식 채널 핸들 `@studiofromis_9`. `channelId` 있으면 생략 가능 |
| `channelId` | string | — | `UC...` 24자. 채우면 매 실행 handle 조회 1회를 아낌 |
| `includeUploads` | bool | `true` | 공식 채널 **업로드 전체**를 수집 대상에 포함. 현재는 `false` (재생목록/검색으로만 수집) |
| `uploadsCategory` | string | `"auto"` | 업로드 전체에 적용할 카테고리 |
| `maxPerPlaylist` | number | `500` | 재생목록 하나당 최대 영상 수 |
| `keywordRules` | object | — | `"auto"` 분류용 카테고리별 키워드 (6절) |
| `defaultFilter` | object | — | `filter` 없는 `search[]` 항목에 적용되는 공통 규칙 (8절) |
| `searchPublishedAfter` | string | — | `search[]` 기본 시작일(ISO8601). `--since` 로 덮임 |
| `playlists[]` | array | — | 공식 채널 안 재생목록 |
| `extraChannels[]` | array | — | 외부 채널 재생목록 |
| `search[]` | array | — | 검색 기반 수집 (9절) |
| `shortsChannels[]` | array | — | 채널 `/shorts` 탭 수집 — **collect_ytdlp.py 전용** (10절) |
| `_` 로 시작하는 키 | any | — | 주석. 크롤러가 무시 |

### `playlists[]` / `extraChannels[]` 항목

| 필드 | 설명 |
|---|---|
| `id` (playlists) / `playlistId` (extraChannels) | 재생목록 ID (`PL...`). 비면 무시 |
| `category` | 이 소스 영상의 카테고리. `"auto"` 면 키워드 분류 |
| `label` | 사람용 메모 (크롤러 미사용) |
| `members` | 기본 멤버 배열. 제목에서 멤버가 안 잡힐 때 이 값 사용. 잡히면 **합집합** (예: `["hayoung"]` + 제목의 "나경" → `["hayoung","nagyung"]`) |
| `filter` | 상세 필터 객체 (8절) |
| `filterKeywords` | `filter: { titleAny: [...] }` 축약형. `filter` 와 같이 있으면 `filter` 우선 |
| `skipIncremental` | `true` 면 `--since`(정기 증분) 실행에서 **생략**, `--since` 없는 수동 실행에서만 수집. 기존 데이터는 유지됨. (예: 새 시즌 MC 가 바뀐 컬래버 시리즈) |

### `shortsChannels[]` 항목

`{ handle | channelId, category, filterKeywords?, members? }` — 해당 채널 `/shorts` 탭을
통째로 `category`(보통 `"shorts"`)로 수집.

---

## 3. 유효한 카테고리 값

`category` 문자열은 `assets/js/config.js` 의 `catLabels` 키와 **정확히 일치**해야 화면에 뜹니다.
오타면 저장은 되지만 어느 탭에도 안 보입니다.

```
music_show  stage_fancam  special_stage
sp_original  sp_vlog  sp_game  sp_survive  sp_beauty  sp_corp  sp_hayoung  sp_jiwon  sp_chaeng
sp_ch9  workdol  plunen_idanjang  pulmuone_ei2  musinsa_seongsugi
shorts  variety_external
```

새 카테고리를 추가하려면 `sources.json` 의 `category` + `config.js` 의 `catLabels`
+ (필요하면) `config.js` 의 `nav` 트리에 함께 넣습니다.

---

## 4. 채널 / 재생목록 ID 찾기

- **채널 ID**: 채널 페이지 → 공유 → 채널 ID 복사 (`UC` + 24자). 또는 페이지 소스에서
  `"channelId":"UC..."` 검색. 핸들(`@name`)도 크롤러가 자동 변환하지만 ID 가 빠름.
- **재생목록 ID**: 재생목록 주소 `.../playlist?list=PL....` 의 `list=` 값 (`PL...` 34자).

### 확보해 둔 채널 ID

| 채널 | ID | 용도 |
|---|---|---|
| @studiofromis_9 | `UCeUJ8B3krxw8zuDi19AlhaA` | 자체콘텐츠 재생목록·쇼츠 |
| @fromis_9 | `UCcv8TMaKxLhVax56o8q7dfQ` | (쇼츠 탭 없음) |
| KBS Kpop | `UCeLPm9yH_a_QH8n6445G-Ow` | 음악방송 (뮤직뱅크) |
| MBCkpop | `UCe52oeb7Xv_KaJsEzcKXJJg` | 음악방송 (음악중심) |
| SBS Inkigayo | `UCS_hnpJLQTvBkqALgapi_4g` | 음악방송 (인기가요) |
| Mnet K-POP | `UCqJ3rYYs-n5blu6JxpciQjA` | 음악방송 (엠카운트다운) |
| M2 | `UCTQVIXvcHrR9jYoJ6qaBAow` | 직캠 (MPD직캠·입덕직캠) |
| STUDIO CHOOM | `UCEIi7zFR_wE23jFncVtd6-A` | 포커스캠·퍼포먼스 |
| 딩고 뮤직 | `UCtCiO5t2voB14CmZKTkIzPQ` | 킬링보이스 등 |

---

## 5. 카테고리 결정 규칙

1. URL 이 `/shorts/` 형태 (YouTube 가 Shorts 로 분류) → **`shorts`** (다른 카테고리 무시)
2. 소스에 `category` 가 `"auto"` 가 아닌 값으로 지정 → 그 값
3. `"auto"` → 키워드 자동 분류:
   1. 제목·설명에 `keywordRules.shorts`(`#shorts`) → `shorts`
   2. 순서대로 첫 매칭: `stage_fancam` → `music_show` → `mv_teaser` → `self_content`
   3. 없으면 `variety_external`

> **길이로 Shorts 판정하지 않습니다** (`maxShortsSeconds` 제거). 세로직캠은 3분 넘는
> 세로 영상이지 Shorts 가 아니기 때문. Shorts 판정은 10절.

> `stage_fancam` 이 `music_show` 보다 먼저 검사됩니다. "직캠"이자 "교차편집"인 영상은
> `stage_fancam` 이 됩니다. 원치 않으면 그 재생목록을 `music_show` 로 명시(2번 규칙).

---

## 6. `keywordRules`

`"auto"` 분류에만 쓰입니다. 소문자·부분 일치, 제목(API 는 +설명) 대상.

```json
"keywordRules": {
  "shorts":       ["#shorts", "shorts"],
  "stage_fancam": ["직캠", "fancam", "focus cam", "세로직캠", "4k 직캠"],
  "music_show":   ["교차편집", "stage mix", "인기가요", "음악중심", "뮤직뱅크", "music bank",
                   "엠카운트다운", "mcountdown", "쇼챔피언", "the show", "더쇼", "음악방송"],
  "mv_teaser":    ["m/v", "official mv", "티저", "teaser", "highlight medley", "예고편",
                   "performance video", "special video"],
  "self_content": ["채널나인", "flowering", "비하인드", "behind", "메이킹", "making",
                   "브이로그", "vlog", "ep.", "다이어리"],
  "variety_external": []
}
```

- `variety_external` 키워드는 무시됩니다(항상 마지막 기본값). 비워 두세요.
- 오분류가 보이면 키워드 보강이 가장 빠른 교정입니다.
- `config.js` 에만 있는 새 카테고리는 자동 분류가 모릅니다 → 소스 `category` 로 직접 지정.

---

## 7. 멤버 자동 태깅

`data/members.json` 의 `aliases` 로 **제목에서** 추정합니다(소문자·부분 일치).
설명란은 전 멤버 해시태그를 나열하는 경우가 많아 **제목만** 봅니다. 하나도 안 걸리면
`["all"]`.

- 데뷔 9인 전원(현 멤버 + `status:"former"` 4인)을 태깅합니다.
- 소스에 `"members": ["hayoung"]` 지정 시: 제목에 이름 없으면 그 값, 있으면 **합집합**.
- 두 글자 alias(`지원`·`지선` 등)는 오탐 가능. 잦으면 `박지원` 같은 형태만 남기세요.
- 영어 직캠 제목의 띄어쓴 로마자("BAEK JI HEON")는 alias 에 `"baek ji heon"` 형태를 추가해야 잡힙니다.

---

## 8. `filter` — 상세 필터 (playlists · extraChannels · search 공용)

지정한 키만 검사, **모두 AND**. 소문자·부분 일치.

| 키 | 의미 |
|---|---|
| `titleAny` / `titleAll` | 제목에 하나 이상 / 전부 |
| `textAny` / `textAll` | 제목+설명에 하나 이상 / 전부 (yt-dlp flat·쇼츠탭은 설명이 없어 제목만) |
| `channelAny` | `channelTitle` 에 하나 이상 (전체 검색에서 방송국만 남길 때) |
| `excludeText` | 제목+설명에 하나라도 있으면 **탈락** |
| `excludeChannels` | `channelTitle` 에 하나라도 있으면 탈락 |
| `minSec` / `maxSec` | 길이(초) 하한 / 상한 (`0`=무제한). 예: 세로직캠만 `minSec: 45` |
| `publishedAfter` / `publishedBefore` | ISO8601 게시일 범위 |

- `filterKeywords: [...]` = `filter: { titleAny: [...] }` 축약형.
- `search[]` 에 `filter` 없으면 `defaultFilter` 적용. `filter: {}` 로 명시하면 필터 없음.

---

## 9. `search[]` — 검색 기반 수집

재생목록이 없는 콘텐츠(방송국 무대·직캠·스페셜). **API 는 `search.list` 호출당 100 유닛**,
yt-dlp 는 채널 검색 탭 스크래핑(무료).

```json
"searchPublishedAfter": "2018-01-01T00:00:00Z",

"search": [
  {
    "label": "방송국 무대·교차편집 (KBS·MBC·SBS·Mnet)",
    "queries": ["프로미스나인"],
    "channelIds": ["UCeLPm9yH_a_QH8n6445G-Ow", "UCe52oeb7Xv_KaJsEzcKXJJg",
                   "UCS_hnpJLQTvBkqALgapi_4g", "UCqJ3rYYs-n5blu6JxpciQjA"],
    "category": "music_show",
    "order": "date",
    "maxPerQuery": 200
  },
  {
    "label": "직캠·포커스캠 (M2·STUDIO CHOOM)",
    "queries": ["프로미스나인", "fromis_9"],
    "channelIds": ["UCTQVIXvcHrR9jYoJ6qaBAow", "UCEIi7zFR_wE23jFncVtd6-A"],
    "category": "stage_fancam",
    "maxPerQuery": 300,
    "filter": {
      "titleAny": ["직캠", "fancam", "focus", "포커스"],
      "textAny": ["프로미스나인", "fromis_9", "fromis9"],
      "excludeText": ["cover", "커버", "reaction", "리액션", "릴레이댄스"],
      "minSec": 45
    }
  }
]
```

| 필드 | 설명 |
|---|---|
| `queries` | 검색어 배열 |
| `channelIds` / `channels` | 이 채널들로만 검색(권장). `channels` 는 `@handle` 도 가능. 둘 다 없으면 전체 검색(노이즈↑ → `filter` 강하게) |
| `category` | 결과 카테고리 (보통 명시값) |
| `order` | `date` \| `relevance` \| `viewCount` (API 만) |
| `maxPerQuery` | (쿼리 × 채널) 조합당 상한 |
| `filter` | 8절. 없으면 `defaultFilter` |

- **채널이 겹치면 안 됨**: 같은 채널을 `music_show` 와 `stage_fancam` 양쪽에 넣으면
  먼저 처리된 쪽이 선점합니다. M2 는 직캠에만, 방송 4사는 무대에만.
- yt-dlp: `youtube.com/channel/<ID>/search?query=` 탭을 flat 추출.

---

## 10. Shorts 판정

`maxShortsSeconds`(길이 기준) **제거**. 두 신호로 구분:

1. **신호 #1 (항상)** — 영상 URL 이 `youtube.com/shorts/<id>` = YouTube 가 Shorts 로 분류.
   `shortsChannels[]` 로 채널 `/shorts` 탭을 통째로 수집:
   ```json
   "shortsChannels": [
     { "handle": "@studiofromis_9", "category": "shorts" }
   ]
   ```
   ※ `@fromis_9` 는 `/shorts` 탭이 없어(매 실행 에러) 제외함.
2. **신호 #3 (`--shorts-aspect`, opt-in)** — 길이 3분 이내 **and** 세로비율(height>width)
   후보만 영상별 조회해 `shorts` 로 재분류. 세로직캠(3분↑)은 자동 제외. 느림.

API 크롤러는 aspect 를 못 봐서 `#shorts` 키워드만 봅니다. 정확한 Shorts 수집은
`collect_ytdlp.py --only shorts` (+ 필요 시 `--shorts-aspect`).

---

## 11. 백필 vs 증분 · 실행

**영상 / 쇼츠 이원화** — API 크롤러는 `/shorts` 탭을 못 주므로, 쇼츠는 항상 yt-dlp 로 별도 수집한다.

| | 영상 (music_show·직캠·자체콘텐츠 …) | 쇼츠 |
|---|---|---|
| **전체 백필 (로컬)** | `collect_ytdlp.py --only video` 또는 `youtube_crawler.py`(`--since` 없이) | 이어서 `collect_ytdlp.py --only shorts` |
| **정기 (GitHub `update-data.yml`)** | `youtube_crawler.py --since $(30일 전)` (API) | 이어서 `collect_ytdlp.py --only shorts` (best-effort, 봇 차단 시 스킵) |

- 두 크롤러 모두 기존 `data/videos.json` 과 **병합**(`addedAt` 보존)하며, 증분(`--since`) 실행은
  이번에 재수집 안 된 기존 영상을 **삭제하지 않는다**. 전체 정리는 `--since` 없는 로컬 실행에서만.
- `collect_ytdlp.py` 는 `--only` 가 `all` 이 아닐 때 아무것도 못 긁으면 파일을 안 건드리고 정상 종료.
- `--dry-run` 도 실제 API 를 호출하므로 여러 번 돌리면 그날 `search` 쿼터가 소진됩니다.

### 명령

```bash
export YOUTUBE_API_KEY="발급받은_키"

# API — 미리보기 / 전체 백필 / 증분 / 검색 생략
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data --dry-run
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data --since 2025-08-01
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data --no-search   # 재생목록만

# yt-dlp (키·쿼터 불필요) — 백필은 video → shorts 순차
python -m pip install --user yt-dlp
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data --only video     # 재생목록+검색(쇼츠 제외)
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data --only shorts     # /shorts 탭만
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data                   # = video + shorts
python crawlers/collect_ytdlp.py --config crawlers/sources.json --out data --shorts-aspect   # 신호#3 (느림)
```

`--only` 값: `all`(기본) \| `video` \| `search` \| `playlists` \| `shorts`.

로컬 확인: `python -m http.server 8080` → `http://localhost:8080`.

---

## 12. API 쿼터

- 일일 한도 **10,000 유닛**.
- `playlistItems.list` · `videos.list` · `channels.list` = 호출당 **1 유닛**(최대 50개).
- **`search.list` = 100 유닛.** `search[]` 는 (쿼리 × 채널 × 페이지) 만큼 호출.
  현재 설정 전체 백필 ≈ 3,000~5,000 유닛.
- 절약: `searchPublishedAfter` 올리기 · `maxPerQuery` 낮추기 · `channels` 최소화 ·
  `order: "date"` · 쿼터 소진 시 `collect_ytdlp.py` 로.

---

## 13. 자주 하는 실수

| 증상 | 원인 / 해결 |
|---|---|
| 특정 영상이 어느 탭에도 안 뜸 | `category` 가 `config.js` `catLabels` 키와 불일치 (3절) |
| 직캠이 음악방송에 섞임 | `search[]` 채널이 겹침. M2 는 직캠에만, 방송 4사는 무대에만 |
| search 에 커버·리액션·비fromis 섞임 | `filter.excludeText` / `excludeChannels` 보강, `filter.titleAny` 에 그룹명 필수 |
| `HTTP 403 ... quota` | `search` 쿼터 초과. `maxPerQuery`·쿼리 수 줄이거나 `collect_ytdlp.py` 사용. 태평양시간 자정 리셋 |
| `HTTP 403 ... referer blocked` | API 키에 HTTP 리퍼러 제한. Cloud Console 에서 애플리케이션 제한 **없음** + API 제한만 YouTube Data API v3 |
| yt-dlp `Sign in to confirm you're not a bot` | Actions IP 차단. `collect_ytdlp.py` 는 로컬에서만 |
| "추가된 순"이 매번 뒤섞임 | 크롤 결과 `data/videos.json` 을 커밋 안 함 → `addedAt` 유실 |
| 라이브/예정·비공개·임베드 불가 영상 누락 | 의도된 동작 |

---

## 14. 현재 `sources.json` 요약

- **메인 채널**: `@studiofromis_9` (`includeUploads: false`)
- **playlists** (자체콘텐츠 9종): 스프 오리지널/슾log/게임할꼬/살아남기/뷰티&패션/프나상사/하냥카세/젼메추/챙그랑
- **extraChannels**: 워크돌(`filterKeywords:["프로미스나인"]`) · 채널나인 · 이아이는요2 · 성수기(`skipIncremental`) · 이단장
- **search**: 방송무대(KBS·MBC·SBS·Mnet) · 직캠(M2·STUDIO CHOOM) · 스페셜(딩고·퍼스트테이크)
- **shortsChannels**: `@studiofromis_9` (`@fromis_9` 은 쇼츠 탭 없어 제외)
- `searchPublishedAfter`: `2018-01-01`
