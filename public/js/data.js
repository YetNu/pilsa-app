/* ===========================================================
   서신서 순서 (로마서 → 유다서), 개역한글 기준 장 수
   실제 서비스에서는 이 목록 순서대로 하루 1장씩 자동 배정됩니다.
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

/* startDate(YYYY-MM-DD) 기준, index번째 날(0=시작일)에 배정되는 장을 반환 (하루 1장) */
function getAssignmentForDayIndex(dayIndex){
  const a = CHAPTER_SEQUENCE[dayIndex];
  return a ? [a] : [];
}

/* "로마서1장" 형태로 표기 */
function formatAssignmentLabel(pair){
  if (pair.length === 0) return "-";
  return `${pair[0].book}${pair[0].chapter}장`;
}

/* 보이지 않는 문자(BOM, zero-width space 등)와 줄바꿈 없는 공백(NBSP), 중복 공백을
   정리해서 눈으로는 같아 보이는데 byte 단위로는 다른 텍스트 때문에 채점이 계속
   틀리게 나오는 걸 막는다. 서버(submit.js)와 클라이언트(실시간 오타 표시) 양쪽에서
   같은 기준으로 비교해야 하므로 여기 한 곳에만 둔다.
   (코드에 보이지 않는 문자를 그대로 적으면 알아보기 어려우니 항상 \uXXXX 코드값으로 표기) */
const INVISIBLE_CODE_POINTS = [
  0x200B, 0x200C, 0x200D, 0xFEFF, // ZWSP, ZWNJ, ZWJ, BOM
  0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, // 좌우 방향 제어문자
];
const INVISIBLE_CHARS_RE = new RegExp(
  "[" + INVISIBLE_CODE_POINTS.map(c => "\\u" + c.toString(16).padStart(4, "0")).join("") + "]", "g"
);
const NBSP_RE = new RegExp("\\u00A0", "g");

function normalizeVerseText(text){
  return (text || "")
    .replace(INVISIBLE_CHARS_RE, "")
    .replace(NBSP_RE, " ") // NBSP는 눈에 보이는 일반 공백으로 취급
    .replace(/\s+/g, " ")  // 중복 공백을 하나로
    .trim();
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
    toISODate, addDays, normalizeVerseText,
  };
}
