// 데이터 저장소 계층 — Google Sheets 전용
// 필요한 Netlify 환경변수: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID
//
// 각 탭 1행은 항상 헤더로 취급하고 2행부터 데이터를 읽고 쓴다 (헤더 그대로 입력):
//   Users:       이름 | 비밀번호해시 | 별명 | 상태 | 역할
//   Submissions: 이름 | dayIndex | 제출시각
//   Config:      key | value
//   Chapters:    책 | 장 | 절 | 내용   (관리자가 직접 입력하는 필사 원문)

const { getSheetsClient, SHEET_ID } = require("./_sheets");

/* ---------- Users ---------- */

async function getUsers(){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A2:E" });
  return (res.data.values || []).map(r => ({
    name: r[0], passwordHash: r[1], nickname: r[2] || "", status: r[3], role: r[4],
  }));
}

async function addUser(user){
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Users!A2:E",
    valueInputOption: "RAW",
    requestBody: { values: [[user.name, user.passwordHash, user.nickname || "", user.status, user.role]] },
  });
}

async function updateUser(name, patch){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A2:E" });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => r[0] === name);
  if (idx === -1) return false;
  const row = rows[idx];
  const sheetRow = idx + 2; // 1행은 헤더 → 데이터는 2행부터
  const updated = [
    name,
    row[1],
    patch.nickname !== undefined ? patch.nickname : (row[2] || ""),
    patch.status !== undefined ? patch.status : row[3],
    patch.role !== undefined ? patch.role : row[4],
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Users!A${sheetRow}:E${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [updated] },
  });
  return true;
}

async function removeUser(name){
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === "Users");
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A2:A" });
  const rows = (res.data.values || []).flat();
  const idx = rows.indexOf(name);
  if (idx === -1) return false;
  const rowIndex0 = idx + 1; // 0-based 시트 행 인덱스, 헤더(0번 행) 다음부터 데이터
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: "ROWS", startIndex: rowIndex0, endIndex: rowIndex0 + 1 } },
      }],
    },
  });
  return true;
}

// 관리자가 지정한 순서대로 회원 행을 재배열 (전체 회원/현황 화면 정렬 순서에 그대로 반영됨)
async function reorderUsers(orderedNames){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A2:E" });
  const rows = res.data.values || [];
  const byName = new Map(rows.map(r => [r[0], r]));
  const reordered = orderedNames.map(name => byName.get(name)).filter(Boolean);
  const remaining = rows.filter(r => !orderedNames.includes(r[0]));
  const allRows = [...reordered, ...remaining];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: "Users!A2:E", valueInputOption: "RAW", requestBody: { values: allRows },
  });
}

/* ---------- Submissions ---------- */

async function getSubmissions(){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Submissions!A2:C" });
  return (res.data.values || []).map(r => ({ name: r[0], dayIndex: Number(r[1]), at: r[2] }));
}

async function addSubmission(sub){
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Submissions!A2:C",
    valueInputOption: "RAW",
    requestBody: { values: [[sub.name, sub.dayIndex, sub.at]] },
  });
}

/* ---------- Config ---------- */

async function getConfig(){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Config!A2:B" });
  const rows = res.data.values || [];
  const row = rows.find(r => r[0] === "start_date");
  return { start_date: row ? row[1] : "" };
}

async function setConfig(patch){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Config!A2:B" });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => r[0] === "start_date");
  const value = [["start_date", patch.start_date]];
  if (idx === -1){
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: "Config!A2:B", valueInputOption: "RAW", requestBody: { values: value },
    });
  } else {
    const sheetRow = idx + 2; // 1행은 헤더 → 데이터는 2행부터
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `Config!A${sheetRow}:B${sheetRow}`, valueInputOption: "RAW", requestBody: { values: value },
    });
  }
}

/* ---------- Chapters (관리자가 입력하는 필사 원문) ---------- */

async function getChapterVerses(book, chapter){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Chapters!A2:D" });
  const rows = res.data.values || [];
  return rows
    .filter(r => r[0] === book && Number(r[1]) === chapter)
    .map(r => ({ verse: Number(r[2]), text: r[3] || "" }))
    .sort((a, b) => a.verse - b.verse);
}

// 해당 책/장의 기존 절을 전부 지우고 새로 저장 (부분 수정이 아니라 통째로 교체)
async function setChapterVerses(book, chapter, verses){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Chapters!A2:D" });
  const rows = res.data.values || [];
  const remaining = rows.filter(r => !(r[0] === book && Number(r[1]) === chapter));
  const newRows = verses.map(v => [book, chapter, v.verse, v.content]);
  const allRows = [...remaining, ...newRows];

  await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: "Chapters!A2:D" });
  if (allRows.length){
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: "Chapters!A2:D", valueInputOption: "RAW", requestBody: { values: allRows },
    });
  }
}

module.exports = {
  getUsers, addUser, updateUser, removeUser, reorderUsers,
  getSubmissions, addSubmission,
  getConfig, setConfig,
  getChapterVerses, setChapterVerses,
};
