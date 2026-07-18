const jwt = require("jsonwebtoken");

// JWT_SECRET이 없으면(로컬 테스트) 개발용 기본값을 씀 — 배포 전 반드시 Netlify 환경변수로 설정할 것
const JWT_SECRET = process.env.JWT_SECRET || "local-dev-insecure-secret-change-me";
if (!process.env.JWT_SECRET){
  console.warn("[_auth] JWT_SECRET 환경변수가 없어 로컬 개발용 기본값을 사용합니다. 배포 전 반드시 설정하세요.");
}

// Authorization: Bearer <token> 헤더에서 사용자 정보를 검증/추출
function requireUser(event){
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw { statusCode: 401, message: "로그인이 필요해요." };
  try {
    return jwt.verify(token, JWT_SECRET); // { name, role, nickname }
  } catch {
    throw { statusCode: 401, message: "세션이 만료됐어요. 다시 로그인해주세요." };
  }
}

function requireAdmin(event){
  const user = requireUser(event);
  if (user.role !== "admin") throw { statusCode: 403, message: "관리자만 접근할 수 있어요." };
  return user;
}

module.exports = { requireUser, requireAdmin, JWT_SECRET };
