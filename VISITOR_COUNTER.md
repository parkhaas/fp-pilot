# About. 방문자 수 카운터 — GoatCounter 도입 메모

상태: **코드 적용 완료, 카운터 공개 설정 대기**. 정리일 2026-10-16.
- site code: `fp-pilot` (https://fp-pilot.goatcounter.com)
- 적용됨: `index.html` 집계 스크립트, About 의 "누적 방문" 박스(`loadVisitCount`), 서비스 워커 v28.
- 남은 일: 대시보드 Settings 에서 "allow using the visitor counter" 를 켜야 한다.
  꺼져 있으면 `/counter/TOTAL.json` 이 403 이라 박스가 숨겨진다(정상 동작).
- 켠 뒤 확인: `count` 필드가 "방문자 수"로 맞는지(`count_unique` 와 비교), 라벨 조정.

## 왜 GoatCounter 인가

- GitHub Pages 는 서버가 없는 정적 호스팅이라, 방문 집계를 하려면 외부 서비스가 필요하다.
- GoatCounter 는 쿠키를 쓰지 않는 프라이버시 친화형 집계 서비스이고, 비상업 용도는 무료다.
  (비영리 팬 아카이브 운영 원칙과 잘 맞는다.)
- 대안인 간이 카운터(counterapi 등 "접속 시 +1" 방식)는 가입이 없어 쉽지만,
  서비스가 사라지면 숫자가 초기화되고 새로고침마다 올라가는 식이라 정확도가 낮다.

## 가입 (사용자가 직접 — 계정 생성은 Claude 가 대신하지 않는다)

- 가입 페이지: https://www.goatcounter.com/signup
- 입력하는 **site code** 가 `https://<code>.goatcounter.com` 의 `<code>` 가 된다.
- 가입 후 Claude 에게 site code 만 알려주면 된다. (비밀번호·키는 필요 없다.)

## 가입 후 설정

1. 대시보드 Settings 에서 방문자 수를 사이트에 공개 표시하는 옵션
   ("Allow adding visitor counts on your website" 계열)을 켠다.
   → 이걸 켜야 About 에서 숫자를 읽어올 수 있다.
2. 정확한 항목명·엔드포인트는 공식 문서(https://www.goatcounter.com/help/countjs-host,
   https://www.goatcounter.com/help/visitor-counter) 로 확인한다.

## 적용 계획 (Claude 작업)

- `index.html` 에 집계 스크립트 1줄 추가:
  `<script data-goatcounter="https://<code>.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`
- About 페이지 상단 통계 박스 옆(또는 푸터)에 "누적 방문자" 표시.
  숫자는 `https://<code>.goatcounter.com/counter/TOTAL.json` 에서 가져온다.
- 스타일은 기존 `.stat` 토큰 시스템을 그대로 쓴다. (이 프론트엔드는 Tailwind 아님)

## 확인할 것

- **PWA 서비스 워커**(`service-worker.js`) 가 외부 도메인 요청(`gc.zgo.at`,
  `*.goatcounter.com`)을 캐시하거나 막지 않는지.
- SPA 라서 `?view=` 전환이 페이지뷰로 잡히는지. 필요하면 라우팅 시 수동 집계 호출을 넣는다.
- 카운터 조회 실패(차단기·네트워크) 시 About 이 깨지지 않고 숫자 영역만 숨겨지는지.
- 방문자 수 집계 사실을 About 의 "페이지 안내"에 한 줄로 알릴지(쿠키 미사용 명시).
