/* FROMIS-FLIX 설정 — 카테고리/멤버는 이 파일과 data/*.json 에서 관리 */
window.FF_CONFIG = {
  site: {
    title: "FROMIS-FLIX",
    fandom: "flover",
    group: "fromis_9",
  },

  /* 홈 화면에 노출할 카테고리 순서 및 라벨.
     id 값은 crawlers/collect.json (또는 sources.json) 및 data/videos.json 의 category 와 일치해야 함.
     현재는 @studiofromis_9(자체콘텐츠 채널)의 재생목록별로 구성. */
  categories: [
    { id: "home",          label: "홈" },
    { id: "music_show",    label: "음악방송" },
    { id: "stage_fancam",  label: "직캠" },
    { id: "special_stage", label: "스페셜무대" },
    { id: "sp_original",   label: "오리지널" },
    { id: "sp_vlog",       label: "슾log" },
    { id: "sp_game",       label: "게임할꼬" },
    { id: "sp_survive",    label: "살아남기" },
    { id: "sp_beauty",     label: "뷰티&패션" },
    { id: "sp_corp",       label: "프나상사" },
    { id: "sp_hayoung",    label: "하냥카세" },
    { id: "sp_jiwon",      label: "젼메추" },
    { id: "sp_chaeng",     label: "챙그랑" },
    { id: "workdol",       label: "워크돌" },
  ],

  /* 홈 화면 캐러셀에서 카테고리별로 보여줄 최대 개수 */
  homeRowSize: 18,

  /* 그리드 페이지네이션(더 보기 단위) */
  pageSize: 60,
};
