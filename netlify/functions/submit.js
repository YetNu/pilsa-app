const store = require("./_store");
const { requireUser } = require("./_auth");
const { getAssignmentForDayIndex } = require("../../public/js/data");

// 채점은 반드시 서버(이 함수)에서만 수행 — 정답 비교 로직을 클라이언트에 두지 않기 위함
// 원문은 관리자가 Chapters 시트에 입력해둔 내용을 그대로 조회해서 채점한다 (chapters.js 참고)
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const user = requireUser(event); // { name, role, nickname }
    const { dayIndex, rows } = JSON.parse(event.body || "{}");
    // rows: [{ verse: 1, content: "..." }, ...]

    if (!Number.isInteger(dayIndex) || !Array.isArray(rows)){
      return json(400, { error: "잘못된 요청이에요." });
    }

    const pair = getAssignmentForDayIndex(dayIndex);
    if (!pair.length) return json(400, { error: "배정된 장이 없어요." });

    const sourceParts = await Promise.all(pair.map(p => store.getChapterVerses(p.book, p.chapter)));
    const emptyIdx = sourceParts.findIndex(v => v.length === 0);
    if (emptyIdx !== -1){
      const p = pair[emptyIdx];
      return json(400, { error: `아직 관리자가 ${p.book} ${p.chapter}장 본문을 등록하지 않았어요.` });
    }
    const source = sourceParts.flat();

    // 절 번호까지는 사용자에게 알려주되, 정답 본문 자체는 절대 응답에 담지 않는다
    // (그대로 붙여넣기 하는 식으로 채점을 우회하지 못하게 하기 위함)
    let ok = rows.length === source.length;
    const wrongVerses = [];
    const maxLen = Math.max(rows.length, source.length);
    for (let i = 0; i < maxLen; i++){
      const r = rows[i];
      const s = source[i];
      if (!s) continue; // 원문보다 더 많이 입력한 절은 번호로 짚어줄 수 없음
      if (!r || r.verse !== s.verse || normalizeVerseText(r.content) !== normalizeVerseText(s.text)){
        ok = false;
        wrongVerses.push(s.verse);
      }
    }

    if (!ok){
      const message = wrongVerses.length
        ? `${wrongVerses.join(", ")}절을 다시 확인해주세요.`
        : "입력한 절의 개수가 맞지 않아요.";
      return json(200, { ok: false, message });
    }

    // Submissions 시트에 완료 기록 append (사용자명 | dayIndex | 제출시각)
    await store.addSubmission({ name: user.name, dayIndex, at: new Date().toISOString() });

    return json(200, { ok: true, message: "제출 완료" });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// 관리자가 본문을 붙여넣기로 입력할 때 딸려올 수 있는 보이지 않는 문자(BOM, 폭 없는 공백 등)나
// 중복 공백 때문에 눈으로는 똑같아 보이는데 채점만 계속 틀리게 나오는 걸 막기 위한 정규화.
// (코드에 보이지 않는 문자를 그대로 적으면 알아보기 어려우니 항상 \uXXXX 코드값으로 표기)
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
