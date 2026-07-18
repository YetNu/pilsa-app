const store = require("./_store");
const { requireUser } = require("./_auth");
const { getAssignmentForDayIndex, getSampleVerses } = require("../../public/js/data");

// 채점은 반드시 서버(이 함수)에서만 수행 — 정답 비교 로직을 클라이언트에 두지 않기 위함
// 원문은 배정 로직(data.js)에서 결정적으로 생성되므로, 사용자가 화면에서 본 것과 항상 같은 본문으로 채점된다.
// TODO: 실제 개역한글 본문을 쓰게 되면 getSampleVerses 대신 Chapters 시트 조회로 교체 (README 6번 항목 참고)
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

    const source = pair.flatMap(p => getSampleVerses(p.book, p.chapter));

    // 절 번호까지는 사용자에게 알려주되, 정답 본문 자체는 절대 응답에 담지 않는다
    // (그대로 붙여넣기 하는 식으로 채점을 우회하지 못하게 하기 위함)
    let ok = rows.length === source.length;
    const wrongVerses = [];
    const maxLen = Math.max(rows.length, source.length);
    for (let i = 0; i < maxLen; i++){
      const r = rows[i];
      const s = source[i];
      if (!s) continue; // 원문보다 더 많이 입력한 절은 번호로 짚어줄 수 없음
      if (!r || r.verse !== s.verse || r.content !== s.text){
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
