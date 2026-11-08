const crypto = require("crypto");
const store = require("./_store");
const { requireUser, requireAdmin } = require("./_auth");

// 뽑기 — 뽑기 종류(세트)를 여러 개 만들 수 있고, 세트마다 이름·항목·회원별 기회가 따로 있다.
// 관리자가 회원에게 어떤 뽑기의 기회를 주면, 그 회원은 기회 하나에 한 번씩 그 뽑기를 뽑을 수 있다
// GET                         → 본인: { sets: [{ id, name, items: [{ type, text }], tokens: 남은 기회 }] }
// GET ?mine=1                 → 본인: { log: [{ at, text, type, setName, used }] } (내가 뽑은 기록)
// GET ?admin=1                → 관리자: { sets: [{ id, name, items }], tokens: { 뽑기번호: { 이름: 남은 기회 } }, users, log }
// POST { action: "draw", set }                          → 본인: 그 뽑기의 기회 하나를 써서 뽑기 — 무엇이 나올지는 서버가 정한다
//                                                         { index, item, items, tokens }
// POST { action: "addSet", name, id? }                  → 관리자: 새 뽑기 만들기 { set: { id, name } }
//                                                         (화면이 기다리지 않도록 번호를 화면에서 정해 보낼 수 있다 — 겹치면 거절)
// POST { action: "renameSet", set, name }               → 관리자: 뽑기 이름 바꾸기
// POST { action: "deleteSet", set }                     → 관리자: 뽑기 없애기 (항목·기회도 함께, 기록은 남김)
// POST { action: "setItems", set, items: [{ type, text }] } → 관리자: 그 뽑기의 항목 목록을 통째로 바꿈
// POST { action: "setTokens", set, name, count }        → 관리자: 그 회원의 그 뽑기 남은 기회를 count로
// POST { action: "deleteLog", name, at }                → 관리자: 뽑은 기록 한 줄 지우기
// POST { action: "setLogUsed", name, at, used }         → 관리자: 뽑은 기록을 사용함 / 안 함으로 표시
const MAX_ITEMS = 100, MAX_TEXT = 40, MAX_TOKENS = 99, MAX_SETS = 20, MAX_SET_NAME = 20;

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET"){
      const q = event.queryStringParameters || {};
      const [sets, items, tokens] = await Promise.all([store.getGachaSets(), store.getGachaItems(), store.getGachaTokens()]);
      const itemsOf = id => items.filter(it => it.set === id).map(({ type, text }) => ({ type, text }));
      if (q.admin){
        requireAdmin(event);
        const [users, log] = await Promise.all([store.getUsers(), store.getGachaLog()]);
        const approved = users.filter(u => u.status === "approved").map(u => ({ name: u.name, nickname: u.nickname || "" }));
        return json(200, { sets: sets.map(x => ({ ...x, items: itemsOf(x.id) })), tokens, users: approved, log });
      }
      const me = requireUser(event);
      if (q.mine){ // 내가 뽑은 기록 전부 (최근 것부터)
        const log = (await store.getGachaLog(Infinity)).filter(l => l.name === me.name)
          .map(({ at, text, type, setName, used }) => ({ at, text, type, setName, used: !!used }));
        return json(200, { log });
      }
      return json(200, { sets: sets.map(x => ({ ...x, items: itemsOf(x.id), tokens: (tokens[x.id] || {})[me.name] || 0 })) });
    }

    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    const { action, set, items, name, count, at, used, id: wantId } = JSON.parse(event.body || "{}");
    const setId = String(set || "");
    const findSet = async () => (await store.getGachaSets()).find(x => x.id === setId);
    const cleanName = n => String(n || "").trim().slice(0, MAX_SET_NAME);

    if (action === "draw"){
      const me = requireUser(event);
      const [found, all, tokens] = await Promise.all([findSet(), store.getGachaItems(), store.getGachaTokens()]);
      if (!found) return json(404, { error: "없어진 뽑기예요. 새로고침 후 다시 해주세요." });
      const list = all.filter(it => it.set === setId).map(({ type, text }) => ({ type, text }));
      const left = (tokens[setId] || {})[me.name] || 0;
      if (left < 1) return json(400, { error: "뽑기 기회가 없어요." });
      if (!list.length) return json(400, { error: "아직 뽑기 항목이 없어요." });
      const index = crypto.randomInt(list.length);
      const item = list[index];
      await store.setGachaTokens(setId, me.name, left - 1);
      await store.addGachaLog({ name: me.name, at: new Date().toISOString(), text: item.text, type: item.type, setName: found.name });
      return json(200, { index, item, items: list, tokens: left - 1 });
    }

    if (action === "addSet"){
      requireAdmin(event);
      const n = cleanName(name);
      if (!n) return json(400, { error: "뽑기 이름을 적어 주세요." });
      const sets = await store.getGachaSets();
      if (sets.length >= MAX_SETS) return json(400, { error: `뽑기는 ${MAX_SETS}개까지 만들 수 있어요.` });
      let id = String(Math.max(0, ...sets.map(x => parseInt(x.id, 10) || 0)) + 1);
      if (wantId !== undefined){
        if (!/^\d{1,6}$/.test(String(wantId)) || sets.some(x => x.id === String(wantId))) return json(409, { error: "뽑기를 만들지 못했어요. 새로고침 후 다시 해주세요." });
        id = String(wantId);
      }
      await store.addGachaSet({ id, name: n });
      return json(200, { ok: true, set: { id, name: n } });
    }

    if (action === "renameSet"){
      requireAdmin(event);
      const n = cleanName(name);
      if (!n) return json(400, { error: "뽑기 이름을 적어 주세요." });
      const sets = await store.getGachaSets();
      if (!sets.some(x => x.id === setId)) return json(404, { error: "없어진 뽑기예요. 새로고침 후 다시 해주세요." });
      await store.saveGachaSets(sets.map(x => x.id === setId ? { ...x, name: n } : x));
      return json(200, { ok: true, set: { id: setId, name: n } });
    }

    if (action === "deleteSet"){
      requireAdmin(event);
      const sets = await store.getGachaSets();
      if (!sets.some(x => x.id === setId)) return json(404, { error: "없어진 뽑기예요. 새로고침 후 다시 해주세요." });
      if (sets.length < 2) return json(400, { error: "뽑기는 하나 이상 있어야 해요." });
      await store.deleteGachaSet(setId);
      return json(200, { ok: true });
    }

    if (action === "setItems"){
      requireAdmin(event);
      if (!(await findSet())) return json(404, { error: "없어진 뽑기예요. 새로고침 후 다시 해주세요." });
      if (!Array.isArray(items) || items.length > MAX_ITEMS) return json(400, { error: `항목은 ${MAX_ITEMS}개까지 넣을 수 있어요.` });
      const clean = items
        .map(it => ({ type: it && ["pen", "love"].includes(it.type) ? it.type : "win", text: String((it && it.text) || "").trim().slice(0, MAX_TEXT) }))
        .filter(it => it.text);
      await store.setGachaItems(setId, clean);
      return json(200, { ok: true, items: clean });
    }

    if (action === "setTokens"){
      requireAdmin(event);
      if (!(await findSet())) return json(404, { error: "없어진 뽑기예요. 새로고침 후 다시 해주세요." });
      const n = Number(count);
      if (!Number.isInteger(n) || n < 0 || n > MAX_TOKENS) return json(400, { error: `뽑기 기회는 0~${MAX_TOKENS}번으로 정해 주세요.` });
      const users = await store.getUsers();
      if (!users.some(u => u.name === name && u.status === "approved")) return json(404, { error: "회원을 찾을 수 없어요." });
      await store.setGachaTokens(setId, name, n);
      return json(200, { ok: true, name, count: n });
    }

    if (action === "setLogUsed"){
      requireAdmin(event);
      const ok = await store.setGachaLogUsed(String(name || ""), String(at || ""), !!used);
      if (!ok) return json(404, { error: "기록을 찾을 수 없어요. 새로고침 후 다시 해주세요." });
      return json(200, { ok: true });
    }

    if (action === "deleteLog"){
      requireAdmin(event);
      const ok = await store.deleteGachaLog(String(name || ""), String(at || ""));
      if (!ok) return json(404, { error: "기록을 찾을 수 없어요. 새로고침 후 다시 해주세요." });
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
