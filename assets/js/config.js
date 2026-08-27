/* FROMIS-FLIX 설정 — 카테고리/멤버는 이 파일과 data/*.json 에서 관리 */
window.FF_CONFIG = {
  site: {
    title: "FROMIS-FLIX",
    fandom: "flover",
    group: "fromis_9",
  },

  /* 홈 화면에 노출할 카테고리 순서 및 라벨.
     id 값은 crawlers/sources.json 및 data/videos.json 의 category 와 일치해야 함 */
  categories: [
    { id: "home",             label: "홈" },
    { id: "music_show",       label: "음악방송" },
    { id: "self_content",     label: "자체콘텐츠" },
    { id: "stage_fancam",     label: "무대·직캠" },
    { id: "mv_teaser",        label: "MV·티저" },
    { id: "variety_external", label: "예능·외부" },
    { id: "shorts",           label: "쇼츠" },
  ],

  /* 홈 화면 캐러셀에서 카테고리별로 보여줄 최대 개수 */
  homeRowSize: 18,

  /* 그리드 페이지네이션(더 보기 단위) */
  pageSize: 60,
};
