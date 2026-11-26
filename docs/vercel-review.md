# Vercel 이전 검토 기록 (2026-11-23)

**결론: 이전하지 않고 GitHub Pages 를 유지한다.** 한도 기준이 같아서 옮겨도 얻는 것이 없다.

## 배경
GitHub 쪽 한도 때문에 게시가 제한된다는 우려에서 Vercel 로 옮길 수 있는지 검토했다.

## 확인한 사실
- 배포 사이트 65MB(`data/photos` 37MB, `data/discography` 27MB), 저장소 59MB, 파일 약 2,300개.
  GitHub Pages 의 사이트 1GB 한도와는 거리가 멀다.
- 최근 `update-data` 12회(11/17~11/22)는 모두 성공. 이전 실패 3건은 용량이 아니라
  YouTube API 쿼터(10/26), 영상 수 급감 가드·`deploy-pages` 일시 오류(11/9)였다.
- 남는 후보는 Pages 의 월 100GB 대역폭(소프트 한도)이다. Vercel Hobby 도 Fast Data Transfer 가
  월 100GB 포함이라 이 한도로는 차이가 없다.

## Vercel Hobby 조건 (공식 문서 기준)
- 비상업 개인 용도 전용.
- CLI 로 올리는 소스 파일은 100MB 까지(현재 65MB). Git 연동 배포에는 이 제한이 적용되지 않는다고 문서에 적혀 있다.
- 하루 100회 배포 — 12시간 주기 수집에는 충분.

## 이전한다면 이렇게 (미적용, 참고용)
1. `update-data`(크롤링·데이터 커밋)는 그대로 두고, Vercel 에서 저장소를 Git 연동해 커밋마다 자동 배포.
2. `vercel.json`: `{ "buildCommand": "rm -rf tools", "outputDirectory": ".", "framework": null }` — 로컬 전용 `tools/` 제외.
3. 워크플로의 Pages 배포 단계 제거. 봇 푸시로도 Vercel 자동 배포가 도는지는 첫 실행에서 확인 필요.
   안 되면 Actions 에서 Vercel CLI 로 직접 배포(`VERCEL_TOKEN` 시크릿).
4. 서비스 워커·매니페스트 경로는 `./` 상대 경로라 루트 배포(Pages 는 `/fp-pilot/`)에서도 동작할 것으로 보이나 이전 시 확인.

## 다시 검토할 조건
- 대역폭 한도 경고를 받았는데 사이트 용량·방문이 계속 늘 때 (이 경우 Vercel 이전보다 이미지 용량 축소·외부 이미지 호스팅이 먼저).
- `data/` 가 1GB 에 근접할 때.

출처: https://vercel.com/docs/limits , https://vercel.com/docs/limits/fair-use-guidelines
