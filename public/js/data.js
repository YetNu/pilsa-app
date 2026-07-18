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

/* 데모용 원문 텍스트 (실서비스에서는 Google Sheets에 저장된 개역한글 본문으로 교체) */
function getSampleVerses(book, chapter){
  const count = 6 + ((book.length + chapter) % 5); // 데모용 3~10절
  return Array.from({ length: count }, (_, i) => ({
    verse: i + 1,
    text: `(샘플 본문) ${book} ${chapter}장 ${i + 1}절 — 실제 서비스에서는 이 자리에 개역한글 원문이 표시됩니다.`
  }));
}

/* YYYY-MM-DD 문자열 유틸 */
function toISODate(d){ return d.toISOString().slice(0, 10); }
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
    getAssignmentForDayIndex, formatAssignmentLabel, getSampleVerses,
    toISODate, addDays,
  };
}
