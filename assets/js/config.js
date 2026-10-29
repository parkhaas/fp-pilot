/* FLOVER-FLIX 설정 */
window.FF_CONFIG = {
  site: { title: "FLOVER-FLIX", fandom: "flover", group: "fromis_9" },

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
    workdol: "워크돌",
    plunen_idanjang: "이단장",
    pulmuone_ei2: "이아이는요2",
    musinsa_seongsugi: "성수기",
    bangpan: "방판소녀들",
    kpan_ipdeok: "K판 입덕투어",
    shorts: "Shorts",
    unsorted: "미분류 영상",
    variety_external: "기타",
  },

  /* 좌측 2단 내비게이션.
     - sel: 이 노드가 거는 필터. {} = 전체, {cat}, {cats:[...]}
     - subBy: "year" | "song" → 데이터에서 하위 항목 자동 생성
     - children: 명시적 하위 카테고리 id 목록
     - withAll: 하위에 "전체" 항목 추가
     - divider: 구분선 */
  nav: [
    { id: "all",      label: "전체보기",    icon: "layout-grid", sel: {} },
    { id: "period",   label: "기간별 보기",  icon: "calendar",    sel: {}, subBy: "year" },
    { id: "byMember", label: "멤버별 보기",  icon: "users",       sel: {}, subBy: "member" },
    { divider: true },
    {
      id: "self",
      label: "자체컨텐츠",
      icon: "clapperboard",
      sel: { cats: ["sp_original", "sp_vlog", "sp_game", "sp_survive", "sp_beauty", "sp_corp", "sp_hayoung", "sp_jiwon", "sp_chaeng", "sp_ch9", "unsorted"] },
      children: ["sp_original", "sp_vlog", "sp_game", "sp_survive", "sp_beauty", "sp_corp", "sp_hayoung", "sp_jiwon", "sp_chaeng", "sp_ch9", "unsorted"],
      withAll: true,
    },
    { id: "workdol", label: "워크돌",      icon: "hammer",       sel: { cat: "workdol" }, subBy: "year", withAll: true },
    { id: "plunen_idanjang", label: "이단장",      icon: "gamepad-2",    sel: { cat: "plunen_idanjang" }, subBy: "year", withAll: true },
    { id: "pulmuone_ei2", label: "이아이는요2",      icon: "utensils",     sel: { cat: "pulmuone_ei2" }, subBy: "year", withAll: true },
    { id: "musinsa_seongsugi", label: "성수기",      icon: "shirt",        sel: { cat: "musinsa_seongsugi" }, subBy: "year", withAll: true },
    { id: "bangpan", label: "방판소녀들",  icon: "shopping-bag", sel: { cat: "bangpan" }, subBy: "year", withAll: true },
    { id: "kpan_ipdeok", label: "K판 입덕투어", icon: "map-pin",      sel: { cat: "kpan_ipdeok" }, subBy: "year", withAll: true },
    { id: "music",   label: "음악방송",    icon: "music",        sel: { cat: "music_show" },    subBy: "song", withAll: true },
    { id: "fancam",  label: "직캠",        icon: "video",        sel: { cat: "stage_fancam" },  subBy: "song", withAll: true },
    { id: "special", label: "스페셜무대",  icon: "sparkles",     sel: { cat: "special_stage" }, subBy: "year", withAll: true },
    { id: "shorts",  label: "Shorts",     icon: "smartphone",   sel: { cat: "shorts" },  subBy: "year", withAll: true },
    { divider: true },
    { id: "group", label: "그룹소개", icon: "users", view: "group" },
    { id: "discography", label: "Discography", icon: "disc-3", view: "discography" },
    { id: "sbs_photos", label: "SBS 인기가요 : 현장포토", icon: "image", view: "photos" },
  ],

  /* 하위 항목이 0개여도 상위 메뉴를 계속 노출할지 */
  showEmptyGroups: true,

  /* 그리드 페이지네이션(더 보기 단위) */
  pageSize: 60,
};
