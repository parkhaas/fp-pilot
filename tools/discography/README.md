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
| `docs.json` | 사이트 안 페이지로 만들 주요 문서(그룹·멤버·응원법 등) 목록. 여기에 적은 문서는 `fetch.js` 가 받아 `source/docs/` 에 저장하고, 본문의 나무위키 링크가 이 문서·앨범 페이지로 연결된다 |
| `scan-links.js` | 본문에 남은 나무위키 링크를 자주 나오는 순으로 보여 준다 (문서를 더 추가할지 판단할 때) |
| `source/docs/*.md` | 주요 문서 마크다운 |
| `source/covers.md` | 앨범 커버 원본 URL 목록 (build 때 갱신) |
| `source/details.json` | 상세 문서 링크 목록 |

## 자주 쓰는 옵션

- `node fetch.js --refresh` : 캐시를 무시하고 전부 다시 받는다 (나무위키 내용이 고쳐졌을 때).
- `node fetch.js --md-only` : 네트워크 없이 캐시한 HTML 로 마크다운만 다시 만든다 (변환기를 고쳤을 때).
- `node fetch-profiles.js` → `node extract-profile-info.js` : 멤버 프로필 사진 주소와 인물 정보 표(source/profiles.json, source/profile-info.json)를 새로 뽑는다. `fetch.js` 뒤, `build.js` 앞에 실행.
- `node build.js --covers` : 커버를 다시 만든다.

## 출력 (사이트가 읽는 것)

- `data/discography/index.json` — 앨범 목록(메타, 수록곡, 크레딧)
- `data/discography/albums/<id>.json` — 앨범 상세 섹션(소개·사양·성적·활동 등)과 곡 해설
- `data/discography/docs/<slug>.json` — 주요 문서(그룹·멤버·응원법 등) 섹션 HTML
- `data/discography/extras.json` — 방송·OST·참여 음반, 여담, 노래방 수록 목록
- `data/discography/covers/<id>.webp` — 커버 썸네일

`id` 는 `발매일-슬러그` 형식이다 (예: `2026-07-21-glow-me`).

## 알아둘 점

- 나무위키 콘텐츠는 **CC BY-NC-SA 2.0 KR** 이다. 사이트에는 출처·라이선스 표기(Discography 페이지 하단)가 있어야 하며, 비영리·동일 조건 공유를 지킨다. 커버 이미지의 저작권은 각 음반사에 있다.
- 일본 발매가 무산된 앨범처럼 커버가 없으면 자리표시 아이콘으로 표시한다.
- 이 폴더의 `node_modules/`, `.cache/` 는 git 에 올리지 않는다.

## 나무위키 링크 처리

본문의 나무위키 링크는 빌드할 때 바뀐다: `docs.json` 에 있는 문서와 앨범은 사이트 안 주소(`?view=discography&doc=…` / `&album=…`)로, 그 밖의 링크는 글자만 남긴다. 자주 나오는 문서를 사이트 안 페이지로 만들고 싶으면 `node scan-links.js` 로 빈도를 보고 `docs.json` 에 추가한 뒤 `fetch.js` → `build.js` 를 실행한다.

## 안내 문장뿐인 소절 (숨김)

"자세한 내용은 [문서] 문서를 참고하십시오" 같은 안내 문장만 있는 소절은 화면에 나오지 않는다. 삭제하지 않고 남겨 두었다.
- 소절 전체가 안내뿐이면 각 JSON 의 `hidden: [{ title, md }]` 에 원문이 들어간다.
- 소절 안의 하위 소절·안내 줄은 HTML 에 `<!-- hidden:pointer … -->` 주석으로 남는다.
- 링크가 사이트 안 문서·앨범(`docs.json`)으로 이어지는 안내는 쓸모가 있어 그대로 보인다.
- 되살리려면 `lib/pointers.js` 의 `hidePointers` / `isPointerOnly` 호출(`build.js` 의 `parseDetail`)을 끄면 된다. 목록은 `node scan-pointers.js` 로 본다.

## 표 변환 규칙 (나무위키 → 마크다운 → HTML)

- 방송·채널 **로고 이미지**(svg 포함)는 사진을 싣지 않는 대신 이름(alt·문서 제목)을 글자로 남긴다. 링크가 로고뿐이어도 마찬가지.
- **유튜브 아이콘**만 있는 링크는 `▶ YouTube` 링크로, 영상 임베드(iframe)도 같은 링크로 남긴다.
- 멤버·그룹 문서(`fetch.js` 의 docs 단계)는 **rowspan 으로 이어진 칸의 값을 되풀이**한다(40자 넘으면 〃). 앨범 문서의 곡 정보 표는 rowspan 칸이 비어 있어야 파싱되므로 되풀이하지 않는다.
- 연도 행("2019년")·표 제목 행·구분 행(앨범명 등)은 HTML 로 만들 때 한 칸(colspan)으로 합친다.
