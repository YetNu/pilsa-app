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

/* ---------- 날짜 ↔ dayIndex(= CHAPTER_SEQUENCE에서 몇 번째 장인지) ----------
   처음에는 시작일부터 매일(주말 포함) 1장씩이었는데, 2026-10-11(일)부터는 평일(월~금)에만
   1장씩(주 5장) 하기로 바꿨다. 이미 제출된 기록(Submissions의 dayIndex)은 "몇 번째 장"이라는
   뜻 그대로 유효해야 하므로, 전환일 이전 날짜는 예전처럼 달력 날짜 수로, 전환일부터는
   평일 수로 이어서 센다. (시작일 자체가 전환일 이후면 처음부터 평일만 센다) */
const PILSA_WEEKDAY_ONLY_FROM = "2026-10-11";

function daysBetween(fromStr, toStr){
  const utc = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(toStr) - utc(fromStr)) / 86400000);
}

/* 그 날짜에 배정된 장의 dayIndex. 시작일 이전이거나 (평일 전용 기간의) 주말이면 null */
function dateToDayIndex(dateStr, startDate){
  if (!startDate || dateStr < startDate) return null;
  const dailyPeriod = startDate < PILSA_WEEKDAY_ONLY_FROM; // 매일 하던 기간이 있었는지
  if (dailyPeriod && dateStr < PILSA_WEEKDAY_ONLY_FROM) return daysBetween(startDate, dateStr);
  if (isWeekend(dateStr)) return null;
  const pivot = dailyPeriod ? PILSA_WEEKDAY_ONLY_FROM : startDate;
  const base = dailyPeriod ? daysBetween(startDate, pivot) : 0;
  return base + weekdaySerial(dateStr) - weekdaySerial(pivot);
}

/* dateToDayIndex의 반대 — dayIndex번째 장을 하는 날짜 */
function dayIndexToDate(dayIndex, startDate){
  const dailyPeriod = startDate < PILSA_WEEKDAY_ONLY_FROM;
  const base = dailyPeriod ? daysBetween(startDate, PILSA_WEEKDAY_ONLY_FROM) : 0;
  if (dayIndex < base) return addDays(startDate, dayIndex);
  let date = dailyPeriod ? PILSA_WEEKDAY_ONLY_FROM : startDate;
  while (isWeekend(date)) date = addDays(date, 1);
  const offset = daysBetween("1970-01-05", date) % 7; // 월=0 … 금=4
  const total = offset + (dayIndex - base);
  return addDays(date, Math.floor(total / 5) * 7 + (total % 5) - offset);
}

/* dateStr 이전(그 날짜는 제외)에 배정된 날이 모두 몇 개인지 = 그 날짜 이후 첫 배정일의 dayIndex */
function countAssignedBefore(dateStr, startDate){
  if (!startDate || dateStr <= startDate) return 0;
  let date = dateStr;
  while (dateToDayIndex(date, startDate) === null) date = addDays(date, 1);
  return dateToDayIndex(date, startDate);
}

/* "로마서1장" 형태로 표기 */
function formatAssignmentLabel(pair){
  if (pair.length === 0) return "-";
  return `${pair[0].book}${pair[0].chapter}장`;
}

/* ===========================================================
   계시록 암기 — 요한계시록 장별 절 수 (개역한글 기준, 총 404절)
   필사 배정(EPISTLES)과는 별개라서 따로 둔다. 본문 자체는 필사와 똑같이
   관리자가 "본문 입력"에서 Chapters 시트에 넣어둔 것을 쓴다.
   =========================================================== */
const REVELATION = {
  book: "요한계시록",
  verses: [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
};
const REVELATION_TOTAL_VERSES = REVELATION.verses.reduce((a, b) => a + b, 0);

/* 관리자가 본문을 입력할 수 있는 책 목록 (필사용 서신서 + 암기용 계시록) */
const CONTENT_BOOKS = [...EPISTLES, { book: REVELATION.book, chapters: REVELATION.verses.length }];

function isValidRevelationVerse(chapter, verse){
  return Number.isInteger(chapter) && Number.isInteger(verse)
    && chapter >= 1 && chapter <= REVELATION.verses.length
    && verse >= 1 && verse <= REVELATION.verses[chapter - 1];
}

/* 암기를 시작하는 장 — 관리자가 따로 정하지 않았을 때의 기본값 */
const MEMO_DEFAULT_START_CHAPTER = 9;

/* 1장 1절 → 22장 21절 순서로 펼친 전체 절 목록 */
const REVELATION_SEQUENCE = [];
REVELATION.verses.forEach((count, i) => {
  for (let v = 1; v <= count; v++) REVELATION_SEQUENCE.push({ chapter: i + 1, verse: v });
});

/* 날짜(YYYY-MM-DD)를 "평일만 센 일련번호"로 바꾼다 — 월~금은 하루에 1씩 늘고,
   토·일은 다음 월요일과 같은 번호가 된다. 두 날짜의 번호 차이가 곧 그 사이 평일 수.
   (시간대에 따라 하루가 밀리지 않도록 연/월/일을 UTC로 직접 계산) */
function weekdaySerial(dateStr){
  const [y, m, d] = dateStr.split("-").map(Number);
  const mondayBased = Math.round(Date.UTC(y, m - 1, d) / 86400000) + 3; // 1970-01-01은 목요일
  return Math.floor(mondayBased / 7) * 5 + Math.min(mondayBased % 7, 5);
}
function isWeekend(dateStr){
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

/* 암기 시작일부터 평일마다 한 절씩(주 5절) 순서대로 배정했을 때, 그 날짜에 외울 절.
   주말·시작일 이전·전체를 다 마친 뒤에는 null. 시작일이 주말이면 다음 월요일부터 시작한다. */
function getMemoVerseForDate(dateStr, startDate, startChapter){
  if (!startDate || dateStr < startDate || isWeekend(dateStr)) return null;
  const index = weekdaySerial(dateStr) - weekdaySerial(startDate);
  if (index >= REVELATION_SEQUENCE.length) return null;
  // 1장이 아닌 장부터 시작하면(기본 9장) 22장까지 간 뒤 1장으로 돌아와 시작 장 직전까지 — 그래야 전장을 다 돈다
  const offset = REVELATION_SEQUENCE.findIndex(v => v.chapter === (startChapter || MEMO_DEFAULT_START_CHAPTER));
  return REVELATION_SEQUENCE[(Math.max(offset, 0) + index) % REVELATION_SEQUENCE.length];
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
    PILSA_WEEKDAY_ONLY_FROM, dateToDayIndex, dayIndexToDate, countAssignedBefore,
    REVELATION, REVELATION_TOTAL_VERSES, CONTENT_BOOKS, isValidRevelationVerse,
    REVELATION_SEQUENCE, MEMO_DEFAULT_START_CHAPTER, getMemoVerseForDate,
    toISODate, addDays, normalizeVerseText,
  };
}
