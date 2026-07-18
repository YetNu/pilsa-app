/* ===========================================================
   서신서 순서 (로마서 → 유다서), 개역한글 기준 장 수
   실제 서비스에서는 이 목록 순서대로 하루 2장씩 자동 배정됩니다.
   =========================================================== */
const EPISTLES = [
  { book: "로마서",     chapters: 16 },
  { book: "고린도전서", chapters: 16 },
  { book: "고린도후서", chapters: 13 },
  { book: "갈라디아서", chapters: 6 },
  { book: "에베소서",   chapters: 6 },
  { book: "빌립보서",   chapters: 4 },
  { book: "골로새서",   chapters: 4 },
  { book: "데살로니가전서", chapters: 5 },
  { book: "데살로니가후서", chapters: 3 },
  { book: "디모데전서", chapters: 6 },
  { book: "디모데후서", chapters: 4 },
  { book: "디도서",     chapters: 3 },
  { book: "빌레몬서",   chapters: 1 },
  { book: "히브리서",   chapters: 13 },
  { book: "야고보서",   chapters: 5 },
  { book: "베드로전서", chapters: 5 },
  { book: "베드로후서", chapters: 3 },
  { book: "요한1서",    chapters: 5 },
  { book: "요한2서",    chapters: 1 },
  { book: "요한3서",    chapters: 1 },
  { book: "유다서",     chapters: 1 },
];

/* 전체 (책, 장) 순서를 1차원 리스트로 펼침 */
function buildChapterSequence(){
  const seq = [];
  EPISTLES.forEach(({ book, chapters }) => {
    for (let c = 1; c <= chapters; c++) seq.push({ book, chapter: c });
  });
  return seq; // 총 121개
}
const CHAPTER_SEQUENCE = buildChapterSequence();

/* startDate(YYYY-MM-DD) 기준, index번째 날(0=시작일)에 배정되는 장 2개를 반환 */
function getAssignmentForDayIndex(dayIndex){
  const a = CHAPTER_SEQUENCE[dayIndex * 2];
  const b = CHAPTER_SEQUENCE[dayIndex * 2 + 1]; // 마지막 날은 undefined일 수 있음(총 121장 홀수)
  return [a, b].filter(Boolean);
}

/* 두 장을 "로마서1~2장" 또는 책이 바뀌면 "로마서16장, 고린도전서1장" 형태로 표기 */
function formatAssignmentLabel(pair){
  if (pair.length === 0) return "-";
  if (pair.length === 1) return `${pair[0].book}${pair[0].chapter}장`;
  const [a, b] = pair;
  if (a.book === b.book) return `${a.book}${a.chapter}~${b.chapter}장`;
  return `${a.book}${a.chapter}장, ${b.book}${b.chapter}장`;
}

/* YYYY-MM-DD 문자열 유틸
   주의: toISOString()은 UTC 기준으로 변환하기 때문에, 한국(UTC+9)처럼 UTC보다 앞선
   시간대에서는 자정 근처(또는 addDays로 만든 로컬 자정 Date)에 하루가 밀려서 나오는
   버그가 있었다. 로컬 캘린더 기준 연/월/일을 직접 조합해서 항상 보이는 그대로의
   날짜가 나오게 한다. */
function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/* Netlify Functions(Node)에서도 같은 배정/본문 로직을 재사용하기 위한 export
   (브라우저에서는 module이 없어 이 블록이 그냥 무시됨) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EPISTLES, CHAPTER_SEQUENCE, buildChapterSequence,
    getAssignmentForDayIndex, formatAssignmentLabel,
    toISODate, addDays,
  };
}
