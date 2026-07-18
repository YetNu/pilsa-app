// 공통 헬퍼: 서비스 계정으로 Google Sheets API 인증
// 필요한 Netlify 환경변수 (README 참고):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY        (줄바꿈은 \n 이스케이프로 저장)
//   GOOGLE_SHEET_ID

const { google } = require("googleapis");

function assertConfigured(){
  const missing = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEET_ID"]
    .filter(key => !process.env[key]);
  if (missing.length){
    throw new Error(`Google Sheets 환경변수가 없어요: ${missing.join(", ")}. .env 파일(로컬) 또는 Netlify 환경변수(배포)를 확인해주세요.`);
  }
}

function getAuth(){
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient(){
  assertConfigured();
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

module.exports = { getSheetsClient, SHEET_ID };
