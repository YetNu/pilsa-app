const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const store = require("./_store");
const { JWT_SECRET } = require("./_auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { name, password } = JSON.parse(event.body || "{}");
    if (!name || !password) return json(400, { error: "이름과 비밀번호를 입력해주세요." });

    const users = await store.getUsers();
    const user = users.find(u => u.name === name);

    if (!user) return json(401, { error: "회원 정보를 찾을 수 없어요." });
    if (user.status !== "approved") return json(403, { error: "관리자 승인 대기 중이에요." });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return json(401, { error: "이름 또는 비밀번호가 올바르지 않아요." });

    const token = jwt.sign(
      { name: user.name, role: user.role, nickname: user.nickname || "" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    return json(200, { token, name: user.name, nickname: user.nickname || "", role: user.role });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
