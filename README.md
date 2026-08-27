# FROMIS-FLIX

프로미스나인(fromis_9) 팬이 만드는 **비영리 영상 아카이브**.
[SCENE-FLIX](https://adam-yam.github.io/SCENE-FLIX/) 의 구조를 참고했습니다.

- **빌드 도구 없음** — 순수 HTML/CSS/JS. 그대로 GitHub Pages 에 올라갑니다.
- **데이터** — `data/*.json` (영상 메타데이터만, 영상 재호스팅 없음)
- **수집** — `crawlers/youtube_crawler.py` 가 **YouTube Data API v3**(공식 API) 로 수집
- **자동화** — GitHub Actions 가 6시간마다 수집 → 커밋 → Pages 재배포

```
fp-pilot/
├── index.html                 # 앱 셸
├── assets/
│   ├── css/style.css
│   └── js/{config.js, app.js}  # config.js 에서 카테고리/행 개수 조정
├── data/
│   ├── videos.json            # 크롤러가 덮어씀 (지금은 샘플)
│   ├── members.json           # 멤버 목록 + 별칭(멤버 자동 태깅용)
│   └── meta.json              # 마지막 업데이트/카테고리별 개수
├── crawlers/
│   ├── youtube_crawler.py
│   └── sources.json           # 수집 대상 채널/재생목록 정의
├── .github/workflows/
│   ├── update-data.yml        # cron 수집 + 커밋
│   └── deploy.yml             # Pages 배포
├── manifest.json / service-worker.js   # PWA
└── image/logo.svg
```

## 로컬 실행

정적 파일이라 아무 정적 서버로 열면 됩니다 (`file://` 는 fetch 제약으로 불가).

```bash
python -m http.server 8080
# http://localhost:8080 접속
```

## 데이터 수집 (YouTube Data API v3)

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 프로젝트 생성 →
   **YouTube Data API v3** 사용 설정 → **API 키** 발급 (무료, 일 10,000 유닛 쿼터).
2. `crawlers/sources.json` 편집:
   - `handle` 은 공식 채널 핸들 (기본 `@fromis_9`). `channelId` 를 알면 채워두면 조회 1회 절약.
   - `playlists[].id` 에 자체콘텐츠/MV/음악방송 **재생목록 ID** 를 넣고 `category` 지정.
   - `extraChannels[].playlistId` 로 공식 외 채널(직캠 등)의 특정 재생목록도 추가 가능.
   - 재생목록에 `category` 를 지정하면 그 값이 우선하고, `uploads`(채널 업로드 전체)는
     `keywordRules` + 길이로 자동 분류됩니다.
3. 실행:

```bash
export YOUTUBE_API_KEY="발급받은_키"
python crawlers/youtube_crawler.py --config crawlers/sources.json --out data
# 미리보기만: --dry-run
```

`data/videos.json` 과 `data/meta.json` 이 갱신됩니다. 기존 항목의 `addedAt` 은 보존되어
"추가된 순" 정렬이 유지됩니다.

## 배포 (GitHub Pages)

1. GitHub 저장소 생성 후 이 디렉터리를 push (`git init` 필요 — 아직 git 저장소 아님).
2. **Settings → Secrets and variables → Actions** 에 `YOUTUBE_API_KEY` 추가.
3. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정.
4. main 에 push 하면 `deploy.yml` 이 배포. `update-data.yml` 은 6시간마다 자동 수집.
   수동 실행: Actions 탭 → update-data → **Run workflow**.

## 커스터마이징 포인트

| 하고 싶은 것 | 파일 |
|---|---|
| 카테고리 추가/이름 변경 | `assets/js/config.js` + `crawlers/sources.json` 의 `keywordRules` |
| 멤버 추가/별칭 보정 | `data/members.json` |
| 색상/폰트 | `assets/css/style.css` 상단 `:root` 변수 |
| 홈 캐러셀 개수, 페이지 크기 | `assets/js/config.js` |
| 분류 규칙 | `crawlers/sources.json` 의 `keywordRules`, `maxShortsSeconds` |

## 저작권 / 운영 원칙

- 이 사이트는 **비영리 팬 아카이브**이며 영상을 저장·재배포하지 않고 YouTube 임베드만 사용합니다.
- 모든 저작권은 원저작자(Pledis Entertainment, 각 방송사, 업로더)에게 있습니다.
- 권리자 요청 시 해당 항목을 즉시 삭제합니다. 하단 고지 문구는 `index.html` 의 `.disclaimer` 참고.
- YouTube API 사용은 [YouTube API 서비스 약관](https://developers.google.com/youtube/terms/api-services-terms-of-service) 을 따릅니다.
