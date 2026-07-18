const store = require("./_store");
const { requireAdmin } = require("./_auth");

// 관리자 전용
// GET: 전체 회원 목록 + 배정 시작일 조회
// POST body: { action: "approve" | "reject" | "remove" | "setNickname" | "setStartDate", ...payload }
exports.handler = async (event) => {
  try {
    requireAdmin(event); // role !== 'admin' 이면 403 에러

    if (event.httpMethod === "GET"){
      const [users, config] = await Promise.all([store.getUsers(), store.getConfig()]);
      const safeUsers = users.map(({ passwordHash, ...rest }) => rest); // 비밀번호 해시는 응답에서 제외
      return json(200, { users: safeUsers, startDate: config.start_date || "" });
    }

    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { action, name, nickname, startDate, names } = JSON.parse(event.body || "{}");

    if (action === "approve"){
      const ok = await store.updateUser(name, { status: "approved", nickname: nickname || "" });
      if (!ok) return json(404, { error: "회원을 찾을 수 없어요." });
      return json(200, { ok: true });
    }

    if (action === "reject" || action === "remove"){
      // reject: 승인 대기 중인 회원 삭제 / remove: 이미 승인된 회원 삭제 — 처리는 동일
      const ok = await store.removeUser(name);
      if (!ok) return json(404, { error: "회원을 찾을 수 없어요." });
      return json(200, { ok: true });
    }

    if (action === "setNickname"){
      const ok = await store.updateUser(name, { nickname: nickname || "" });
      if (!ok) return json(404, { error: "회원을 찾을 수 없어요." });
      return json(200, { ok: true });
    }

    if (action === "reorder"){
      if (!Array.isArray(names) || !names.length) return json(400, { error: "순서 정보가 없어요." });
      await store.reorderUsers(names);
      return json(200, { ok: true });
    }

    if (action === "setStartDate"){
      if (!startDate) return json(400, { error: "시작일을 선택해주세요." });
      await store.setConfig({ start_date: startDate });
      return json(200, { ok: true, startDate });
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
