# FLOVER-FLIX

프로미스나인(fromis_9) 팬이 만드는 **비영리 영상 아카이브**.
[SCENE-FLIX](https://adam-yam.github.io/SCENE-FLIX/) 의 구조를 참고했습니다.

- **빌드 도구 없음** — 순수 HTML/CSS/JS. 그대로 GitHub Pages 에 올라갑니다.
- **데이터** — `data/*.json` (영상 메타데이터만, 영상 재호스팅 없음)
- **수집** — `crawlers/youtube_crawler.py` 가 **YouTube Data API v3**(공식 API) 로 수집
- **자동화** — GitHub Actions 가 6시간마다 수집 → 커밋 → Pages 재배포


----------------------------------------------------------------------------------------------------------------


## 저작권 / 운영 원칙

- 이 사이트는 **비영리 팬 아카이브**이며 영상을 저장·재배포하지 않고 YouTube 임베드만 사용합니다.
- 모든 저작권은 원저작자(소속사, 각 방송사, 업로더)에게 있습니다.
- 권리자 요청 시 해당 항목을 즉시 삭제합니다. 하단 고지 문구는 `index.html` 의 `.disclaimer` 참고.
- YouTube API 사용은 [YouTube API 서비스 약관](https://developers.google.com/youtube/terms/api-services-terms-of-service) 을 따릅니다.
