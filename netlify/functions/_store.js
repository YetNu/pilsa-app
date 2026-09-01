// 데이터 저장소 계층 — Google Sheets 전용
// 필요한 Netlify 환경변수: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID
//
// 각 탭 1행은 항상 헤더로 취급하고 2행부터 데이터를 읽고 쓴다 (헤더 그대로 입력):
//   Users:       이름 | 비밀번호해시 | 별명 | 상태 | 역할
//   Submissions: 이름 | dayIndex | 제출시각
//   Config:      key | value
//   Chapters:    책 | 장 | 절 | 내용   (관리자가 직접 입력하는 필사 원문)

const { getSheetsClient, SHEET_ID } = require("./_sheets");

/* ---------- 짧은 시간만 유지하는 메모리 캐시 ----------
   시트 값을 읽을 때마다 매번 구글 시트 API를 부르면, 특히 필사 원문(Chapters)처럼
   전체 서신서 분량이 쌓일 표는 회원이 어떤 날짜를 열 때마다 표 전체를 긁어오게 되어
   느려진다. Netlify Functions가 같은 컨테이너를 재사용하는 동안(warm)만 유지되는
   메모리 캐시를 둬서, 짧은 시간 안에 반복되는 읽기는 시트를 다시 부르지 않게 한다.
   쓰기(추가/수정/삭제) 후에는 그 자리에서 바로 캐시를 비워서 다음 읽기부터는
   반영되게 한다 — 다만 여러 컨테이너가 동시에 떠 있으면 캐시가 서로 공유되지 않으므로
   TTL을 안전망으로 짧게 잡아, 최악의 경우에도 그 시간 안에는 최신 값으로 갱신된다. */
const SHORT_TTL_MS = 20 * 1000;   // 회원 목록/제출 기록: 자주 바뀌니 짧게
const CONTENT_TTL_MS = 2 * 60 * 1000; // 필사 원문: 관리자만 가끔 바꾸니 좀 더 길게

const cache = { users: null, submissions: null, chapters: null }; // 각각 { at, data }

function cacheGet(key, ttl){
  const c = cache[key];
  return c && Date.now() - c.at < ttl ? c.data : null;
}
function cacheSet(key, data){
  cache[key] = { at: Date.now(), data };
}
function cacheClear(key){
  cache[key] = null;
}

/* ---------- Users ---------- */

async function getUsers(){
  const cached = cacheGet("users", SHORT_TTL_MS);
  if (cached) return cached;
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A2:E" });
  const data = (res.data.values || []).map(r => ({
    name: r[0], passwordHash: r[1], nickname: r[2] || "", status: r[3], role: r[4],
  }));
  cacheSet("users", data);
  return data;
}

async function addUser(user){
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Users!A2:E",
    valueInputOption: "RAW",
    requestBody: { values: [[user.name, user.passwordHash, user.nickname || "", user.status, user.role]] },
  });
  cacheClear("users");
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
  cacheClear("users");
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
  cacheClear("users");
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
  cacheClear("users");
}

/* ---------- Submissions ---------- */

async function getSubmissions(){
  const cached = cacheGet("submissions", SHORT_TTL_MS);
  if (cached) return cached;
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Submissions!A2:C" });
  const data = (res.data.values || []).map(r => ({ name: r[0], dayIndex: Number(r[1]), at: r[2] }));
  cacheSet("submissions", data);
  return data;
}

async function addSubmission(sub){
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Submissions!A2:C",
    valueInputOption: "RAW",
    requestBody: { values: [[sub.name, sub.dayIndex, sub.at]] },
  });
  cacheClear("submissions");
}

/* ---------- Config ---------- */

async function getConfig(){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Config!A2:B" });
  const rows = res.data.values || [];
  const find = key => rows.find(r => r[0] === key);
  const startDateRow = find("start_date");
  const allowFutureRow = find("allow_future");
  return {
    start_date: startDateRow ? startDateRow[1] : "",
    // 값이 아예 없으면(기존 시트) 켜짐으로 취급 — 미리 열기는 이미 켜진 채로 배포됐던 기능이라
    // 관리자가 아직 한 번도 끄지 않았다면 그대로 켜져 있어야 한다
    allow_future: allowFutureRow ? allowFutureRow[1] !== "0" : true,
  };
}

async function setConfig(patch){
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Config!A2:B" });
  const rows = res.data.values || [];

  const upserts = [];
  if (patch.start_date !== undefined) upserts.push(["start_date", patch.start_date]);
  if (patch.allow_future !== undefined) upserts.push(["allow_future", patch.allow_future ? "1" : "0"]);

  for (const [key, value] of upserts){
    const idx = rows.findIndex(r => r[0] === key);
    if (idx === -1){
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: "Config!A2:B", valueInputOption: "RAW", requestBody: { values: [[key, value]] },
      });
      rows.push([key, value]); // 이번 호출 안에서 다음 upsert가 같은 키를 또 append하지 않도록 로컬 상태도 갱신
    } else {
      const sheetRow = idx + 2; // 1행은 헤더 → 데이터는 2행부터
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `Config!A${sheetRow}:B${sheetRow}`, valueInputOption: "RAW", requestBody: { values: [[key, value]] },
      });
      rows[idx] = [key, value];
    }
  }
}

/* ---------- Chapters (관리자가 입력하는 필사 원문) ---------- */

// 절 하나하나가 아니라 Chapters 표 전체를 캐시한다 — 회원이 각자 다른 책/장을 열어도
// (관리자가 방금 저장한 게 아닌 이상) 한 번 읽은 원문으로 돌려막을 수 있기 때문
async function getChaptersRaw(){
  const cached = cacheGet("chapters", CONTENT_TTL_MS);
  if (cached) return cached;
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Chapters!A2:D" });
  const data = res.data.values || [];
  cacheSet("chapters", data);
  return data;
}

async function getChapterVerses(book, chapter){
  const rows = await getChaptersRaw();
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
  cacheClear("chapters");
}

module.exports = {
  getUsers, addUser, updateUser, removeUser, reorderUsers,
  getSubmissions, addSubmission,
  getConfig, setConfig,
  getChapterVerses, setChapterVerses,
};
