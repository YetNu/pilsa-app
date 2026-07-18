const store = require("./_store");
const { requireUser } = require("./_auth");
const { CHAPTER_SEQUENCE } = require("../../public/js/data");

// 전체 참여자 현황 조회 (이름, 별명, 배정 시작일, 요일별 완료여부)
// 진행률/주간 계산은 클라이언트(data.js)가 이 원본 데이터를 가지고 동일한 로직으로 처리한다.
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    requireUser(event); // 로그인한 회원만 조회 가능
    const [users, submissionRows, config] = await Promise.all([
      store.getUsers(),
      store.getSubmissions(),
      store.getConfig(),
    ]);

    const approvedUsers = users
      .filter(u => u.status === "approved")
      .map(u => ({ name: u.name, nickname: u.nickname || "" }));

    // { [사용자명]: { [dayIndex]: true } } 형태로 매핑
    const submissions = {};
    submissionRows.forEach(({ name, dayIndex }) => {
      submissions[name] = submissions[name] || {};
      submissions[name][dayIndex] = true;
    });

    return json(200, {
      users: approvedUsers,
      submissions,
      startDate: config.start_date || "",
      totalChapters: CHAPTER_SEQUENCE.length,
    });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
