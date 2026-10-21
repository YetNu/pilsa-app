const store = require("./_store");
const { requireUser, requireAdmin } = require("./_auth");
const { REVELATION_TOTAL_VERSES, MEMO_DEFAULT_START_CHAPTER, isValidRevelationVerse } = require("../../public/js/data");

// 계시록 암기
// GET  → 로그인한 회원 누구나: 전체 참여자, 각자 체크한 절, 암기 시작일/시작 장
//        (날짜별 배정 절/주간 진행률/현황 계산은 클라이언트(data.js)가 이 원본 데이터로 처리한다)
// POST { action: "check", chapter, verse, done }      → 본인의 암기 완료 체크/해제
// POST { action: "setStartDate", startDate, startChapter } → 관리자 전용, 암기 시작일/시작 장 설정
//        (시작일부터 시작 장 1절부터 한 절씩 자동 배정된다 — 2026-10-25부터는 매일)
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET"){
      requireUser(event);
      const [users, checks, config] = await Promise.all([
        store.getUsers(),
        store.getMemoChecks(),
        store.getConfig(),
      ]);
      const approvedUsers = users
        .filter(u => u.status === "approved")
        .map(u => ({ name: u.name, nickname: u.nickname || "" }));
      return json(200, {
        users: approvedUsers, checks,
        startDate: config.memo_start_date || "",
        startChapter: Number(config.memo_start_chapter) || MEMO_DEFAULT_START_CHAPTER,
        totalVerses: REVELATION_TOTAL_VERSES,
      });
    }

    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { action, chapter, verse, done, startDate, startChapter } = JSON.parse(event.body || "{}");

    if (action === "check"){
      const user = requireUser(event);
      if (!isValidRevelationVerse(chapter, verse)) return json(400, { error: "잘못된 요청이에요." });
      await store.setMemoCheck(user.name, chapter, verse, !!done);
      return json(200, { ok: true });
    }

    if (action === "setStartDate"){
      requireAdmin(event);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) return json(400, { error: "시작일을 선택해주세요." });
      if (!isValidRevelationVerse(startChapter, 1)) return json(400, { error: "시작 장을 선택해주세요." });
      await store.setConfig({ memo_start_date: startDate, memo_start_chapter: startChapter });
      return json(200, { ok: true, startDate, startChapter });
    }

    return json(400, { error: "알 수 없는 action 입니다." });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
