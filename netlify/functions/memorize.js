const store = require("./_store");
const { requireUser, requireAdmin } = require("./_auth");
const { REVELATION_TOTAL_VERSES, MEMO_DEFAULT_START_CHAPTER, isValidRevelationVerse } = require("../../public/js/data");

// 계시록 암기
// GET  → 로그인한 회원 누구나: 전체 참여자, 각자 체크한 절, 암기 시작일/시작 장
//        (날짜별 배정 절/주간 진행률/현황 계산은 클라이언트(data.js)가 이 원본 데이터로 처리한다)
// POST { action: "check", chapter, verse, done }      → 본인의 암기 완료 체크/해제
// POST { action: "setStartDate", startDate, startChapter } → 관리자 전용, 암기 시작일/시작 장 설정
//        (시작일부터 시작 장 1절부터 한 절씩 자동 배정된다 — 2026-10-25부터는 매일)
// POST { action: "setStrict", strict }                → 관리자 전용, 범위 암기 테스트 보호 켜기/끄기
//        (전체화면 필수 · 다른 화면에 다녀오면 답 지우기 · 분할 화면 막기)
// POST { action: "setReview", on, reviewer }         → 관리자 전용, 범위 암기 테스트를 채점자 한 명에게 보내기 켜기/끄기와 채점자 지정
// POST { action: "submitTest", chapter, from, to, parts?, answers: [{ chapter?, verse, text }] }
//        (parts: 여러 장에 걸친 시험이면 [{ chapter, from, to }…] — 이때 답안마다 chapter) → 채점자에게 보내기가 켜져 있을 때 테스트 제출 (시험 결과에 남는다)
// GET  ?tests=1                                       → 지정된 채점자만: 아직 결과를 보내지 않은 테스트 목록 (보낸 것은 채점자 목록에서 빠짐)
// POST { action: "sendResult", name, at }            → 채점자만: 그 사람에게 채점 결과 보내기
// POST { action: "ackResults", ats: [제출시각…] }     → 본인: 받은 결과를 확인함 (기록은 남기고 "확인" 표시만)
// GET  ?all=1                                        → 관리자: 모든 사람의 시험 기록 (시험 결과 관리)
// POST { action: "deleteTest", name, at }            → 관리자: 시험 기록 하나 지우기
// GET 응답의 myTests: 내 시험 결과 — pending이면 채점자에게 제출하고 결과를 기다리는 중, seen이 비어 있으면 받은 결과를 아직 열어 보지 않은 것
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET" && (event.queryStringParameters || {}).all){
      requireAdmin(event);
      const [tests, users] = await Promise.all([store.getMemoTests(), store.getUsers()]);
      const approved = users.filter(u => u.status === "approved").map(u => ({ name: u.name, nickname: u.nickname || "" }));
      return json(200, { tests, users: approved });
    }

    if (event.httpMethod === "GET" && (event.queryStringParameters || {}).tests){
      const user = requireUser(event);
      const config = await store.getConfig();
      if (config.memo_review_on !== "1" || !config.memo_reviewer || user.name !== config.memo_reviewer){
        return json(403, { error: "채점자로 지정된 사람만 볼 수 있어요." });
      }
      return json(200, { tests: (await store.getMemoTests()).filter(t => !t.sent) });
    }

    if (event.httpMethod === "GET"){
      const me = requireUser(event);
      const [users, checks, config, tests] = await Promise.all([
        store.getUsers(),
        store.getMemoChecks(),
        store.getConfig(),
        store.getMemoTests(),
      ]);
      // 채점자에게 제출하고 아직 결과를 못 받은 것은 pending — 답안은 결과를 받은 뒤에만 내려준다
      const myTests = tests.filter(t => t.name === me.name)
        .map(({ at, chapter, from, to, parts, answers, sent, seen }) => sent
          ? { at, chapter, from, to, parts, answers, seen }
          : { at, chapter, from, to, parts, answers: [], seen: "", pending: true });
      const approvedUsers = users
        .filter(u => u.status === "approved")
        .map(u => ({ name: u.name, nickname: u.nickname || "" }));
      return json(200, {
        users: approvedUsers, checks,
        startDate: config.memo_start_date || "",
        startChapter: Number(config.memo_start_chapter) || MEMO_DEFAULT_START_CHAPTER,
        strict: config.memo_strict !== "0",
        reviewOn: config.memo_review_on === "1" && !!config.memo_reviewer,
        reviewer: config.memo_reviewer || "",
        myTests,
        totalVerses: REVELATION_TOTAL_VERSES,
        memoOverrides: config.memo_overrides || {},
      });
    }

    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { action, chapter, verse, done, startDate, startChapter, strict, on, reviewer, from, to, answers, parts, name, at, ats, date, count } = JSON.parse(event.body || "{}");

    if (action === "check"){
      const user = requireUser(event);
      if (!isValidRevelationVerse(chapter, verse)) return json(400, { error: "잘못된 요청이에요." });
      await store.setMemoCheck(user.name, chapter, verse, !!done);
      return json(200, { ok: true });
    }

    if (action === "deleteTest"){
      requireAdmin(event);
      const ok = await store.deleteMemoTest(String(name || ""), String(at || ""));
      if (!ok) return json(404, { error: "기록을 찾을 수 없어요. 새로고침 후 다시 해주세요." });
      return json(200, { ok: true });
    }

    if (action === "setStartDate"){
      requireAdmin(event);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) return json(400, { error: "시작일을 선택해주세요." });
      if (!isValidRevelationVerse(startChapter, 1)) return json(400, { error: "시작 장을 선택해주세요." });
      await store.setConfig({ memo_start_date: startDate, memo_start_chapter: startChapter });
      return json(200, { ok: true, startDate, startChapter });
    }

    // 암기 배정 달력: 그 날 배정할 절 수 (0 = 배정 안 함, null = 기본대로)
    if (action === "setMemoOverride"){
      requireAdmin(event);
      const okDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
      const okCount = count === null || (Number.isInteger(count) && count >= 0 && count <= 5);
      if (!okDate || !okCount) return json(400, { error: "잘못된 요청이에요." });
      const overrides = await store.setScheduleOverride("memo", date, count);
      return json(200, { ok: true, overrides });
    }

    if (action === "setStrict"){
      requireAdmin(event);
      if (typeof strict !== "boolean") return json(400, { error: "잘못된 요청이에요." });
      await store.setConfig({ memo_strict: strict });
      return json(200, { ok: true, strict });
    }

    if (action === "setReview"){
      requireAdmin(event);
      if (typeof on !== "boolean") return json(400, { error: "잘못된 요청이에요." });
      const name = (reviewer || "").trim();
      if (on){
        const users = await store.getUsers();
        if (!users.some(u => u.name === name && u.status === "approved")) return json(400, { error: "채점자를 선택해주세요." });
      }
      await store.setConfig({ memo_review_on: on, memo_reviewer: name });
      return json(200, { ok: true });
    }

    if (action === "sendResult"){
      const user = requireUser(event);
      const config = await store.getConfig();
      if (config.memo_review_on !== "1" || user.name !== config.memo_reviewer) return json(403, { error: "채점자로 지정된 사람만 보낼 수 있어요." });
      if (!name || !at) return json(400, { error: "잘못된 요청이에요." });
      const ok = await store.markMemoTestSent(name, at);
      if (!ok) return json(404, { error: "이미 확인했거나 없는 테스트예요." });
      return json(200, { ok: true });
    }

    if (action === "ackResults"){
      const user = requireUser(event);
      if (!Array.isArray(ats) || !ats.length) return json(400, { error: "잘못된 요청이에요." });
      await store.markMemoTestsSeen(user.name, ats.map(String));
      return json(200, { ok: true });
    }

    if (action === "submitTest"){
      const user = requireUser(event);
      const config = await store.getConfig();
      if (config.memo_review_on !== "1") return json(400, { error: "지금은 채점자에게 보내지 않아요. 새로고침 후 다시 해주세요." });
      // 범위 목록 — 예전처럼 한 장이면 chapter/from/to 하나
      const ranges = Array.isArray(parts) && parts.length ? parts : [{ chapter, from, to }];
      const validRange = p => p && Number.isInteger(p.chapter) && Number.isInteger(p.from) && Number.isInteger(p.to) && p.from <= p.to
        && isValidRevelationVerse(p.chapter, p.from) && isValidRevelationVerse(p.chapter, p.to);
      if (ranges.length > 10 || !ranges.every(validRange) || !Array.isArray(answers)){
        return json(400, { error: "잘못된 요청이에요." });
      }
      const clean = ranges.map(({ chapter, from, to }) => ({ chapter, from, to }));
      const multi = clean.length > 1;
      const inRange = (c, v) => clean.some(p => p.chapter === c && v >= p.from && v <= p.to);
      const cleanAnswers = answers
        .filter(a => a && Number.isInteger(a.verse) && inRange(multi ? a.chapter : clean[0].chapter, a.verse))
        .map(a => multi ? { chapter: a.chapter, verse: a.verse, text: String(a.text || "").slice(0, 2000) }
                        : { verse: a.verse, text: String(a.text || "").slice(0, 2000) });
      await store.addMemoTest({ name: user.name, at: new Date().toISOString(), ...clean[0], parts: multi ? clean : null, answers: cleanAnswers });
      return json(200, { ok: true });
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
