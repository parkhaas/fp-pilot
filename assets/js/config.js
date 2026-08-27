/* FROMIS-FLIX 설정 */
window.FF_CONFIG = {
  site: { title: "FROMIS-FLIX", fandom: "flover", group: "fromis_9" },

  /* 카테고리 id → 표시 이름 (카드/모달 라벨, 자체컨텐츠 하위 메뉴에 사용).
     id 는 data/videos.json 의 category, crawlers/sources.json 의 category 와 일치. */
  catLabels: {
    music_show: "음악방송",
    stage_fancam: "직캠",
    special_stage: "스페셜무대",
    sp_original: "스프 오리지널",
    sp_vlog: "슾log",
    sp_game: "게임할꼬",
    sp_survive: "살아남기",
    sp_beauty: "뷰티&패션",
    sp_corp: "프나상사",
    sp_hayoung: "하냥카세",
    sp_jiwon: "젼메추",
    sp_chaeng: "챙그랑",
    sp_ch9: "채널나인",
    sp_iai: "이아이는요",
    sp_seongsugi: "성수기",
    workdol: "워크돌",
    shorts: "Shorts",
    variety_external: "기타",
  },

  /* 좌측 2단 내비게이션.
     - sel: 이 노드가 거는 필터. {} = 전체, {cat}, {cats:[...]}
     - subBy: "year" | "song" → 데이터에서 하위 항목 자동 생성
     - children: 명시적 하위 카테고리 id 목록
     - withAll: 하위에 "전체" 항목 추가
     - divider: 구분선 */
  nav: [
    { id: "all",     label: "전체보기",    sel: {} },
    { id: "period",  label: "기간별 보기",  sel: {}, subBy: "year" },
    { divider: true },
    {
      id: "self",
      label: "자체컨텐츠",
      sel: { cats: ["sp_original", "sp_vlog", "sp_game", "sp_survive", "sp_beauty", "sp_corp", "sp_hayoung", "sp_jiwon", "sp_chaeng", "sp_ch9", "sp_iai", "sp_seongsugi"] },
      children: ["sp_ch9", "sp_original", "sp_vlog", "sp_game", "sp_survive", "sp_beauty", "sp_corp", "sp_hayoung", "sp_jiwon", "sp_chaeng", "sp_iai", "sp_seongsugi"],
      withAll: true,
    },
    { id: "workdol", label: "워크돌",      sel: { cat: "workdol" }, subBy: "year", withAll: true },
    { id: "music",   label: "음악방송",    sel: { cat: "music_show" },    subBy: "song", withAll: true },
    { id: "fancam",  label: "직캠",        sel: { cat: "stage_fancam" },  subBy: "song", withAll: true },
    { id: "special", label: "스페셜무대",  sel: { cat: "special_stage" }, subBy: "year", withAll: true },
    { id: "shorts",  label: "Shorts",     sel: { cat: "shorts" },  subBy: "year", withAll: true },
  ],

  /* 하위 항목이 0개여도 상위 메뉴를 계속 노출할지 */
  showEmptyGroups: true,

  /* 그리드 페이지네이션(더 보기 단위) */
  pageSize: 60,
};
