const store = require("./_store");
const { requireUser, requireAdmin } = require("./_auth");

// GET  ?book=로마서&chapter=1        → 로그인한 회원 누구나 (필사 화면에서 원문 조회)
// POST { book, chapter, verses }    → 관리자 전용 (해당 장의 원문을 통째로 저장/교체)
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET"){
      requireUser(event);
      const { book, chapter } = event.queryStringParameters || {};
      if (!book || !chapter) return json(400, { error: "book, chapter가 필요해요." });
      const verses = await store.getChapterVerses(book, Number(chapter));
      return json(200, { verses });
    }

    if (event.httpMethod === "POST"){
      requireAdmin(event);
      const { book, chapter, verses } = JSON.parse(event.body || "{}");
      if (!book || !Number.isInteger(chapter) || !Array.isArray(verses)){
        return json(400, { error: "잘못된 요청이에요." });
      }
      await store.setChapterVerses(book, chapter, verses);
      return json(200, { ok: true });
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
