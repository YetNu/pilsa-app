const bcrypt = require("bcryptjs");
const store = require("./_store");

const PW_RULE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=?.,])[A-Za-z\d!@#$%^&*()_\-+=?.,]{8,}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const body = JSON.parse(event.body || "{}");
    const { password, passwordConfirm } = body;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name || typeof password !== "string" || !password) return json(400, { error: "이름과 비밀번호를 입력해주세요." });
    // 이름은 다른 사람 화면(현황·관리자)에 그대로 보이므로 길이와 글자를 제한한다
    if (name.length > 20 || /[<>&"'`\\\u0000-\u001f]/.test(name)) return json(400, { error: "이름은 20자 이내로, 특수문자 없이 적어주세요." });
    if (password !== passwordConfirm) return json(400, { error: "비밀번호가 일치하지 않아요." });
    if (!PW_RULE.test(password)) return json(400, { error: "비밀번호는 영어+숫자+특수문자 포함 8자 이상이어야 해요." });

    const users = await store.getUsers();
    if (users.some(u => u.name === name)) return json(409, { error: "이미 사용 중인 이름이에요." });

    const passwordHash = await bcrypt.hash(password, 10);
    await store.addUser({ name, passwordHash, nickname: "", status: "pending", role: "member" });

    return json(200, { ok: true, message: "가입 신청 완료. 관리자 승인을 기다려주세요." });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "서버 오류가 발생했어요." });
  }
};

function json(statusCode, body){
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
