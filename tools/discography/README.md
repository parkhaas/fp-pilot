# 디스코그래피 데이터 도구

나무위키 [프로미스나인/음반](https://namu.wiki/w/프로미스나인/음반) 문서와 각 앨범 상세 문서를 가져와 사이트의 **Discography** 페이지(`?view=discography`)가 읽는 데이터로 만든다. 로컬 전용이며 `tools/` 는 배포에서 제외된다.

## 새 앨범이 나왔을 때

나무위키 문서에 새 앨범이 올라온 뒤에:

```bash
cd tools/discography
npm install          # 처음 한 번
node fetch.js        # 메인 문서 + 아직 없는 상세 문서만 새로 받음
node build.js        # data/discography/ 생성 (새 커버는 자동으로 내려받아 640px WebP 로 저장)
node check.js        # 곡 수·커버·정렬 점검
```

그다음 사이트를 열어 확인하고, 변경분(`data/discography/`, `tools/discography/source/`)을 커밋한다.
앨범 목록은 발매일 기준 **최신순**으로 자동 정렬되므로 코드를 고칠 필요가 없다.

## 파일 구성

| 경로 | 설명 |
| --- | --- |
| `fetch.js` | 문서 내려받기(2초 간격, HTML 은 `.cache/` 에 보관) → `source/*.md` |
| `lib/namu2md.js` | 나무위키 HTML → 마크다운 변환기 |
| `build.js` | `source/` 마크다운 → `data/discography/` JSON·커버 |
| `check.js` | 결과 점검 |
| `source/00-음반-목록.md` | 메인 문서(앨범 목록·트랙·크레딧) |
| `source/albums/*.md` | 앨범별 상세 문서 |
| `source/covers.md` | 앨범 커버 원본 URL 목록 (build 때 갱신) |
| `source/details.json` | 상세 문서 링크 목록 |

## 자주 쓰는 옵션

- `node fetch.js --refresh` : 캐시를 무시하고 전부 다시 받는다 (나무위키 내용이 고쳐졌을 때).
- `node fetch.js --md-only` : 네트워크 없이 캐시한 HTML 로 마크다운만 다시 만든다 (변환기를 고쳤을 때).
- `node build.js --covers` : 커버를 다시 만든다.

## 출력 (사이트가 읽는 것)

- `data/discography/index.json` — 앨범 목록(메타, 수록곡, 크레딧)
- `data/discography/albums/<id>.json` — 앨범 상세 섹션(소개·사양·성적·활동 등)과 곡 해설
- `data/discography/extras.json` — 방송·OST·참여 음반, 여담, 노래방 수록 목록
- `data/discography/covers/<id>.webp` — 커버 썸네일

`id` 는 `발매일-슬러그` 형식이다 (예: `2026-07-21-glow-me`).

## 알아둘 점

- 나무위키 콘텐츠는 **CC BY-NC-SA 2.0 KR** 이다. 사이트에는 출처·라이선스 표기(Discography 페이지 하단)가 있어야 하며, 비영리·동일 조건 공유를 지킨다. 커버 이미지의 저작권은 각 음반사에 있다.
- 일본 발매가 무산된 앨범처럼 커버가 없으면 자리표시 아이콘으로 표시한다.
- 이 폴더의 `node_modules/`, `.cache/` 는 git 에 올리지 않는다.
