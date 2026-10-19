/* ===========================================================
   백엔드 연동 (Netlify Functions → /api/*)
   로그인 세션은 JWT 토큰을 localStorage에 저장해 유지한다.
   (그 외 데이터는 전부 서버에서 매번 새로 조회 — 클라이언트에 진행상황을 저장하지 않음)
   =========================================================== */
const AUTH = {
  get token(){ return localStorage.getItem("pilsa_token") || ""; },
  set token(v){ v ? localStorage.setItem("pilsa_token", v) : localStorage.removeItem("pilsa_token"); },
  get user(){
    try { return JSON.parse(localStorage.getItem("pilsa_user") || "null"); }
    catch { return null; }
  },
  set user(v){ v ? localStorage.setItem("pilsa_user", JSON.stringify(v)) : localStorage.removeItem("pilsa_user"); },
};

function getCurrentUser(){ return AUTH.user; }

async function api(path, { method = "GET", body } = {}){
  const headers = { "Content-Type": "application/json" };
  if (AUTH.token) headers.Authorization = `Bearer ${AUTH.token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("서버에 연결할 수 없어요. 네트워크 상태를 확인해주세요.");
  }

  let data = {};
  try { data = await res.json(); } catch { /* 응답 본문이 없을 수 있음 */ }

  if (res.status === 401){
    logout();
    throw new Error(data.error || "세션이 만료됐어요. 다시 로그인해주세요.");
  }
  if (!res.ok) throw new Error(data.error || "요청 처리 중 오류가 발생했어요.");
  return data;
}

function logout(){
  AUTH.token = null;
  AUTH.user = null;
  showView("view-auth");
}

let weekOffset = 0;          // 내 필사 화면: 0 = 이번 주
let statusWeekOffset = 0;    // 전체 현황의 요일별 달성률 박스: 0 = 이번 주
let openAssignment = null;   // 현재 펼쳐진 (날짜, 배정쌍)

/* ---------- 화면 전환 ---------- */
const views = ["view-auth", "view-status", "view-mypilsa", "view-memo", "view-admin"];
function showView(id){
  views.forEach(v => document.getElementById(v).hidden = (v !== id));
  document.getElementById("topbar").hidden = (id === "view-auth");
  const me = getCurrentUser();
  document.getElementById("btn-admin").hidden = !(me && me.role === "admin");
  document.getElementById("topbar-name").textContent = me ? me.name : "";
  // 상단 메뉴에서 지금 보고 있는 화면 표시
  const menuFor = { "view-status": "btn-status", "view-mypilsa": "btn-mypilsa", "view-memo": "btn-memo", "view-admin": "btn-admin" };
  document.querySelectorAll(".topbar__btn").forEach(b => b.classList.toggle("is-active", b.id === menuFor[id]));
  if (id === "view-status") renderStatusTab();
  if (id === "view-mypilsa"){ weekOffset = weekOffset || 0; renderWeek(); }
  if (id === "view-memo") renderMemo();
  if (id === "view-admin") renderAdmin();
}

/* ---------- 회원가입 모달 ---------- */
function openSignupModal(){
  document.getElementById("form-signup").reset();
  document.getElementById("signup-error").textContent = "";
  document.getElementById("signup-overlay").hidden = false;
  document.getElementById("signup-name").focus();
}
function closeSignupModal(){
  document.getElementById("signup-overlay").hidden = true;
}
document.getElementById("btn-open-signup").addEventListener("click", openSignupModal);
document.getElementById("btn-close-signup").addEventListener("click", closeSignupModal);
document.getElementById("signup-overlay").addEventListener("click", e => {
  if (e.target.id === "signup-overlay") closeSignupModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !document.getElementById("signup-overlay").hidden) closeSignupModal();
});

/* ---------- 알림 모달 (제출 결과 등) ---------- */
function showAlertModal(message){
  document.getElementById("alert-modal-message").textContent = message;
  document.getElementById("alert-modal").hidden = false;
}
function closeAlertModal(){
  document.getElementById("alert-modal").hidden = true;
}
document.getElementById("btn-alert-confirm").addEventListener("click", closeAlertModal);
document.getElementById("alert-modal").addEventListener("click", e => {
  if (e.target.id === "alert-modal") closeAlertModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !document.getElementById("alert-modal").hidden) closeAlertModal();
});

/* ---------- 로그인 ---------- */
document.getElementById("form-login").addEventListener("submit", async e => {
  e.preventDefault();
  const name = document.getElementById("login-name").value.trim();
  const pw = document.getElementById("login-pw").value;
  const errEl = document.getElementById("login-error");
  const btn = e.target.querySelector("button[type=submit]");

  errEl.textContent = "";
  btn.disabled = true;
  try {
    const data = await api("/login", { method: "POST", body: { name, password: pw } });
    AUTH.token = data.token;
    AUTH.user = { name: data.name, nickname: data.nickname, role: data.role };
    document.getElementById("form-login").reset();
    showView("view-status"); // 로그인 기본 화면 = 현황
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 회원가입 ---------- */
document.getElementById("form-signup").addEventListener("submit", async e => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const pw = document.getElementById("signup-pw").value;
  const pw2 = document.getElementById("signup-pw2").value;
  const errEl = document.getElementById("signup-error");
  const btn = e.target.querySelector("button[type=submit]");

  errEl.textContent = "";
  btn.disabled = true;
  try {
    await api("/signup", { method: "POST", body: { name, password: pw, passwordConfirm: pw2 } });
    alert("가입 신청이 완료됐어요. 관리자 승인 후 로그인할 수 있어요.");
    closeSignupModal();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 상단바 이동 ---------- */
// 필사 패널에 입력 중이던 내용은 타이핑하는 동안 계속 임시저장(draft)되기 때문에
// (아래 draftKey/saveDraft 등 참고) 화면을 이동해도 잃어버리지 않는다 — 그래서
// 예전에 있던 "정말 나가시겠어요?" 확인창은 더 이상 필요 없어서 제거함
document.getElementById("btn-status").addEventListener("click", () => { statusWeekOffset = 0; memoStatusWeekOffset = 0; showView("view-status"); });
document.getElementById("btn-mypilsa").addEventListener("click", () => { weekOffset = 0; showView("view-mypilsa"); });
document.getElementById("btn-memo").addEventListener("click", () => { memoWeekOffset = 0; showView("view-memo"); });
document.getElementById("btn-admin").addEventListener("click", () => showView("view-admin"));
document.getElementById("btn-logout").addEventListener("click", () => logout());

/* ===========================================================
   현황 페이지
   =========================================================== */
let statusData = null; // 마지막으로 불러온 /status 응답 — 주 이동 시 다시 불러오지 않고 재사용
let statusTab = "pilsa"; // 현황은 필사 / 암기 두 탭으로 나뉜다

function renderStatusTab(){
  document.querySelectorAll(".tabs__btn[data-status-tab]").forEach(b =>
    b.classList.toggle("is-active", b.dataset.statusTab === statusTab));
  document.getElementById("status-pilsa").hidden = statusTab !== "pilsa";
  document.getElementById("status-memo").hidden = statusTab !== "memo";
  if (statusTab === "pilsa") renderStatus(); else renderMemoStatus();
}
document.querySelectorAll(".tabs__btn[data-status-tab]").forEach(btn => {
  btn.addEventListener("click", () => { statusTab = btn.dataset.statusTab; renderStatusTab(); });
});

async function renderStatus(){
  const list = document.getElementById("status-list");
  list.innerHTML = `<p class="form-note">불러오는 중…</p>`;

  let data;
  try { data = await api("/status"); }
  catch (err){
    list.innerHTML = `<p class="form-error">${err.message}</p>`;
    document.getElementById("status-week-avg").textContent = "";
    return;
  }
  statusData = data;
  renderStatusWeekBox();
  renderStatusList();
}

// 전체 참여자별 카드 — 요일별 달성률 박스와 같은 주(statusWeekOffset)를 보여준다
function renderStatusList(){
  const list = document.getElementById("status-list");
  if (!statusData) return;
  const { users, submissions, startDate, totalChapters } = statusData;
  const today = toISODate(new Date());
  const days = getWeekDates(statusWeekOffset);

  list.innerHTML = users.map(u => {
    const pct = calcProgressPct(u.name, today, submissions, startDate, totalChapters);
    const sub = submissions[u.name] || {};
    const cells = days.map(d => {
      const dayIndex = dateToDayIndex(d, startDate);
      const done = dayIndex !== null && sub[dayIndex];
      // 한 주가 통째로 열려 있어서 미리 한 날은 ⭕로 보이고, ❌는 그 날짜가 실제로 된 뒤에만 붙인다
      let cls = "", mark = "-";
      if (done){ mark = "⭕"; cls = "is-done"; }
      else if (dayIndex !== null && d <= today){ mark = "❌"; cls = "is-fail"; }
      return `<td class="${cls}">${mark}</td>`;
    }).join("");

    return `
      <div class="status-card">
        <div class="status-card__head">
          <span class="status-card__name">${u.name}<span class="status-card__nick">${u.nickname ? "· " + u.nickname : ""}</span></span>
          <span class="status-card__pct">진행률 <span class="status-card__pct-num">${pct}%</span></span>
        </div>
        <table>
          <tr><th>요일</th>${["일","월","화","수","목","금","토"].map(d=>`<th>${d}</th>`).join("")}</tr>
          <tr><th>완료</th>${cells}</tr>
        </table>
      </div>`;
  }).join("") || `<p class="form-note">아직 승인된 참여자가 없어요.</p>`;
}

// 요일별 달성률 = 그 날짜에 배정이 있었던 요일에 한해, 전체 참여 인원 중 완료한 인원의 비율.
// 평균 달성률은 그 주에서 계산 가능했던(배정이 있고 이미 지난) 요일들의 평균이다.
function renderStatusWeekBox(){
  if (!statusData) return;
  const { users, submissions, startDate } = statusData;
  const days = getWeekDates(statusWeekOffset);
  const today = toISODate(new Date());
  const dayLabels = ["일","월","화","수","목","금","토"];
  const totalUsers = users.length;

  document.getElementById("status-week-range").textContent = `${days[0]} ~ ${days[6]}`;

  const dayRow = [`<th>요일</th>`];
  const chapRow = [`<th>필사</th>`]; // 그 요일에 어떤 장을 필사하는지
  const rateRow = [`<th>달성률</th>`];
  const applicableRates = [];

  days.forEach((d, i) => {
    dayRow.push(`<td>${dayLabels[i]}</td>`);
    const dayIndex = dateToDayIndex(d, startDate);
    const isFuture = d > today; // 아직 안 온 날은 (미리 한 사람이 있어도) 달성률을 매기지 않는다
    const pair = dayIndex !== null ? getAssignmentForDayIndex(dayIndex) : [];
    const hasAssignment = pair.length > 0;
    chapRow.push(`<td>${formatAssignmentLabelHTML(pair)}</td>`);

    if (!hasAssignment || isFuture || totalUsers === 0){
      rateRow.push(`<td>-</td>`);
      return;
    }
    const doneCount = users.filter(u => submissions[u.name] && submissions[u.name][dayIndex]).length;
    const pct = Math.round((doneCount / totalUsers) * 100);
    applicableRates.push(pct);
    rateRow.push(`<td>${pct}%</td>`);
  });

  document.getElementById("status-week-table").querySelector("tbody").innerHTML =
    `<tr class="row-day">${dayRow.join("")}</tr>
     <tr class="row-label">${chapRow.join("")}</tr>
     <tr class="row-rate">${rateRow.join("")}</tr>`;

  const avg = applicableRates.length
    ? Math.round(applicableRates.reduce((a, b) => a + b, 0) / applicableRates.length)
    : 0;
  document.getElementById("status-week-avg").innerHTML =
    applicableRates.length
      ? `평균 달성률 <span class="status-week-avg__num">${avg}%</span>`
      : `평균 달성률 <span class="status-week-avg__num">-</span>`;
}

document.getElementById("status-week-prev").addEventListener("click", () => { statusWeekOffset--; renderStatusWeekBox(); renderStatusList(); });
document.getElementById("status-week-next").addEventListener("click", () => { statusWeekOffset++; renderStatusWeekBox(); renderStatusList(); });

function calcProgressPct(userName, today, submissions, startDate, totalChapters){
  if (!startDate || today < startDate) return 0;
  // 오늘까지 배정된 장 수 (평일에만 배정되는 기간의 주말은 세지 않는다)
  const totalAssignedDays = Math.min(countAssignedBefore(addDays(today, 1), startDate), totalChapters);
  if (totalAssignedDays <= 0) return 0;
  const sub = submissions[userName] || {};
  let done = 0;
  for (let i = 0; i < totalAssignedDays; i++) if (sub[i]) done++;
  return Math.round((done / totalAssignedDays) * 100);
}

/* ===========================================================
   내 필사 (주간 박스)
   =========================================================== */
// 좁은 표 칸에서 책 이름과 장 번호가 줄바꿈될 때 이상한 지점에서 끊기지 않도록,
// 책 이름과 장 번호 사이에서 줄바꿈해서 보여주는 HTML 버전
function formatAssignmentLabelHTML(pair){
  if (pair.length === 0) return "-";
  return `${pair[0].book}<br>${pair[0].chapter}장`;
}

// 미리 필사할 수 있는 마지막 날짜 — 기본은 이번 주 토요일(이번 주 분량은 전부 열림).
// 관리자가 "미리 열기 마감일"을 그보다 뒤로 정해두면 그 날짜까지 더 열린다
function getPreviewEnd(openUntil){
  const thisSaturday = getWeekDates(0)[6];
  return openUntil && openUntil > thisSaturday ? openUntil : thisSaturday;
}

function getWeekDates(offset){
  // 이번 주 일요일부터 토요일까지 7일 (offset주 이동)
  const now = new Date();
  const day = now.getDay(); // 0=일
  const sunday = new Date(now); sunday.setDate(now.getDate() - day + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday); d.setDate(sunday.getDate() + i);
    return toISODate(d);
  });
}

async function renderWeek(){
  const days = getWeekDates(weekOffset);
  document.getElementById("week-range").textContent = `${days[0]} ~ ${days[6]}`;
  const table = document.getElementById("week-table");

  let data;
  try { data = await api("/status"); }
  catch (err){
    table.querySelector("tbody").innerHTML = `<tr><td class="form-error">${err.message}</td></tr>`;
    return;
  }

  const { submissions, startDate, openUntil } = data;
  const me = getCurrentUser();
  const mySub = submissions[me.name] || {};
  const today = toISODate(new Date());
  const previewEnd = getPreviewEnd(openUntil);
  const dayLabels = ["일","월","화","수","목","금","토"];

  const dayRow = [`<th>요일</th>`];
  const chapRow = [`<th>필사</th>`];
  const doneRow = [`<th>완료</th>`];

  days.forEach((d, i) => {
    dayRow.push(`<td>${dayLabels[i]}</td>`);
    const dayIndex = dateToDayIndex(d, startDate);
    const isFuture = d > previewEnd;
    const pair = dayIndex !== null ? getAssignmentForDayIndex(dayIndex) : [];
    const label = pair.length ? formatAssignmentLabelHTML(pair) : "-";

    if (!pair.length){
      chapRow.push(`<td>-</td>`);
      doneRow.push(`<td>-</td>`);
    } else if (isFuture){
      chapRow.push(`<td class="is-locked">${label}</td>`);
      doneRow.push(`<td>-</td>`);
    } else {
      const done = !!mySub[dayIndex];
      chapRow.push(`<td data-day-index="${dayIndex}" data-done="${done}">${label}</td>`);
      // 열려 있어도 아직 안 온 날은 ❌ 대신 "-" (그 날짜가 되면 ❌)
      doneRow.push(done ? `<td class="is-done">⭕</td>` : d <= today ? `<td class="is-fail">❌</td>` : `<td>-</td>`);
    }
  });

  table.querySelector("tbody").innerHTML =
    `<tr class="row-day">${dayRow.join("")}</tr>
     <tr class="row-chapter">${chapRow.join("")}</tr>
     <tr class="row-done">${doneRow.join("")}</tr>`;

  table.querySelectorAll(".row-chapter td[data-day-index]").forEach(td => {
    td.addEventListener("click", () => {
      openPilsaPanel(Number(td.dataset.dayIndex), td.dataset.done === "true");
    });
  });

  renderIncompleteWarning(startDate, mySub);
  document.getElementById("pilsa-panel").hidden = true;
}

document.getElementById("week-prev").addEventListener("click", () => { weekOffset--; renderWeek(); });
document.getElementById("week-next").addEventListener("click", () => { weekOffset++; renderWeek(); });

function renderIncompleteWarning(startDate, sub){
  const warnEl = document.getElementById("week-warning");
  const oldest = findOldestIncompleteDayIndex(startDate, sub);
  warnEl.hidden = oldest === null;
}

// 이번 주(오늘이 속한 주) 안에서는 아직 다 못 했어도 경고를 띄우지 않는다.
// 한 주가 완전히 지나서 다음 주 일요일이 되어야 — 즉 이번 주가 시작되기 전(=지난 주 이전)
// 날짜 중에 안 한 게 있을 때만 — 경고를 띄운다
function findOldestIncompleteDayIndex(startDate, sub){
  if (!startDate) return null;
  const thisWeekSunday = toISODate(startOfWeek(new Date()));
  const maxDayIndex = countAssignedBefore(thisWeekSunday, startDate); // 지난 주까지 배정된 장 수
  for (let i = 0; i < maxDayIndex; i++){
    if (getAssignmentForDayIndex(i).length && !sub[i]) return i;
  }
  return null;
}

document.getElementById("btn-jump-oldest").addEventListener("click", async () => {
  const me = getCurrentUser();
  let data;
  try { data = await api("/status"); } catch { return; }
  const sub = data.submissions[me.name] || {};
  const idx = findOldestIncompleteDayIndex(data.startDate, sub);
  if (idx === null) return;
  const targetDate = dayIndexToDate(idx, data.startDate);
  const now = new Date(); const today0 = new Date(toISODate(now));
  const target = new Date(targetDate);
  const diffWeeks = Math.floor((startOfWeek(target) - startOfWeek(today0)) / (7 * 86400000));
  weekOffset = diffWeeks;
  await renderWeek();
  openPilsaPanel(idx, false); // 그 주로 이동만 하지 않고, 가장 오래된 미완료 필사를 바로 열어준다
});
function startOfWeek(d){ const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }

/* ---------- 필사 패널 (본문 + 타이핑) ---------- */
async function openPilsaPanel(dayIndex, done){
  const pair = getAssignmentForDayIndex(dayIndex);
  openAssignment = { dayIndex, pair, verses: [], done: !!done };

  document.getElementById("pilsa-panel__title").textContent = formatAssignmentLabel(pair);
  document.getElementById("pilsa-panel__text").innerHTML = `<p class="form-note">불러오는 중…</p>`;
  document.getElementById("typing-area").hidden = true;
  document.getElementById("pilsa-panel").classList.remove("is-typing");
  document.getElementById("typing-area-list").innerHTML = "";
  document.querySelector(".typing-hint").hidden = openAssignment.done;
  document.getElementById("btn-submit").hidden = openAssignment.done;
  document.getElementById("btn-submit").disabled = true;
  document.getElementById("pilsa-panel").hidden = false;
  document.getElementById("pilsa-panel").scrollIntoView({ behavior: "smooth", block: "start" });

  let verses;
  try {
    const results = await Promise.all(
      pair.map(p => api(`/chapters?book=${encodeURIComponent(p.book)}&chapter=${p.chapter}`))
    );
    verses = results.flatMap((r, i) => r.verses.map(v => ({ ...v, book: pair[i].book, chapter: pair[i].chapter })));
  } catch (err) {
    document.getElementById("pilsa-panel__text").innerHTML = `<p class="form-error">${err.message}</p>`;
    return;
  }

  if (!verses.length){
    document.getElementById("pilsa-panel__text").innerHTML =
      `<p class="form-note">아직 관리자가 이 날짜의 본문을 등록하지 않았어요.</p>`;
    return;
  }

  // 맨 끝의 빈 칸(spacer)은 마지막 절도 원문 칸의 맨 위까지 올라올 수 있게 하는 여백 — showSourceVerse 참고
  document.getElementById("pilsa-panel__text").innerHTML =
    // 아래 입력칸(verse-input-row)과 똑같은 배치: 왼쪽에 "N절", 오른쪽에 같은 폭·같은 글자 크기의 본문
    // — 원문과 내가 쓰는 글이 같은 자리에서 시작하고 같은 곳에서 줄이 바뀐다
    verses.map((v, i) => `
      <div class="source-row" data-source-idx="${i}">
        <span class="verse-input-row__num">${v.verse}절</span>
        <div class="source-row__text">${v.text}</div>
      </div>`).join("") +
    `<div class="pilsa-panel__text-spacer" aria-hidden="true"></div>`;

  openAssignment.verses = verses;
  if (!openAssignment.done){
    document.getElementById("typing-area").hidden = false;
    document.getElementById("pilsa-panel").classList.add("is-typing"); // 폰에서는 이때 원문 박스를 숨기고 절마다 원문을 입력칸 위에 보여준다
    document.getElementById("btn-submit").disabled = false;
    buildTypingArea();
  }
}

document.getElementById("btn-cancel").addEventListener("click", () => {
  // 입력하던 내용은 draft로 남아있어서, 닫아도 같은 날짜를 다시 열면 이어서 쓸 수 있다
  document.getElementById("pilsa-panel").hidden = true;
});

// 모바일에서는 새로고침/이탈 경고창(beforeunload)이 거의 안 뜨기 때문에(특히 iOS Safari는
// 아예 지원 안 함), 실수로 새로고침하거나 나가도 입력 중이던 내용을 잃지 않도록 타이핑하는
// 동안 계속 localStorage에 절 단위로 임시 저장해두고, 같은 날짜를 다시 열면 자동으로 복원한다.
// 제출에 성공하면 그때만 지운다 (닫기/다른 화면 이동 시에는 나중에 이어 쓸 수 있게 남겨둠).
function draftKey(dayIndex){
  const me = getCurrentUser();
  return `pilsa_draft_${me ? me.name : "anon"}_${dayIndex}`;
}
function loadDraft(dayIndex){
  try { return JSON.parse(localStorage.getItem(draftKey(dayIndex)) || "{}"); }
  catch { return {}; }
}
function saveDraftVerse(dayIndex, verse, text){
  const draft = loadDraft(dayIndex);
  if (text) draft[verse] = text; else delete draft[verse];
  if (Object.keys(draft).length) localStorage.setItem(draftKey(dayIndex), JSON.stringify(draft));
  else localStorage.removeItem(draftKey(dayIndex));
}
function clearDraft(dayIndex){
  localStorage.removeItem(draftKey(dayIndex));
}

// 지금 입력하려는 절이 위쪽 원문 칸의 맨 윗줄에 오도록 원문을 스크롤한다
// (1절 칸을 누르면 원문도 1절부터, 10절 칸을 누르면 10절부터 보이게)
function showSourceVerse(index){
  const box = document.getElementById("pilsa-panel__text");
  const target = box.querySelector(`[data-source-idx="${index}"]`);
  if (!target) return;

  box.querySelectorAll(".is-current").forEach(el => el.classList.remove("is-current"));
  target.classList.add("is-current");

  // 뒤쪽 절은 그 아래 남은 원문이 칸 높이보다 짧아서 맨 위까지 못 올라오므로, 모자란 만큼 끝에 여백을 둔다
  const spacer = box.querySelector(".pilsa-panel__text-spacer");
  const last = spacer.previousElementSibling;
  spacer.style.height = Math.max(0, box.clientHeight - last.offsetHeight) + "px";

  // 그 절의 첫 줄을 칸의 맨 위에 정확히 맞춘다. 칸 높이와 모든 절의 높이가 줄 높이의 배수라서(style.css 참고)
  // 이렇게 맞추면 칸 맨 아래도 줄 경계에서 끊겨, 위아래 어디에도 반쯤 잘린 글자가 보이지 않는다
  const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTo({ top, behavior: "smooth" });
}

// 폰/태블릿 배치인지 (style.css의 같은 조건과 짝) — 이 배치에서는 위쪽 원문 박스 대신
// 절마다 "원문 → 바로 아래 입력칸"으로 붙여서 보여준다
const PHONE_LAYOUT_QUERY = "(max-width: 600px), (hover: none) and (pointer: coarse)";
function isPhoneLayout(){ return window.matchMedia(PHONE_LAYOUT_QUERY).matches; }

// 폰에서 입력칸을 누르면, 그 절의 원문과 입력칸이 키보드 위 남은 화면에 함께 들어오도록 화면을 옮긴다.
// 브라우저가 알아서 해주는 스크롤은 입력칸만 겨우 보이게 맞추는 데다, iOS는 키보드가 올라와도
// 페이지 높이가 그대로라서 실제로 보이는 영역(visualViewport) 기준으로 직접 계산해야 한다.
//
// 화면이 여러 번 출렁이지 않도록: 키보드가 올라오는 중에는 건드리지 않고 다 올라온 뒤 딱 한 번만,
// 그것도 원문이나 입력칸이 실제로 가려져 있을 때만 움직인다 (예전에는 누르자마자 한 번, 조금 뒤
// 또 한 번 움직여서 브라우저 자체 스크롤·키보드 애니메이션과 겹쳐 꿀렁거렸다)
let revealTimer = null;
let lastVerseBlurAt = 0; // 방금 다른 절 입력칸에 있었는지(= 키보드가 이미 올라와 있는지) 판단용
function revealTypingRow(row){
  if (!isPhoneLayout()) return;
  const TOP_MARGIN = 72; // 인앱 브라우저가 화면 위에 띄우는 주소창 등에 가리지 않을 만큼의 여유
  const move = () => {
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewHeight = vv ? vv.height : window.innerHeight;
    const topLimit = viewTop + TOP_MARGIN;
    const bottomLimit = viewTop + viewHeight - 10;
    const rect = row.getBoundingClientRect();
    if (rect.top >= topLimit - 4 && rect.bottom <= bottomLimit) return; // 이미 다 보이면 그대로 둔다

    let delta = rect.top - topLimit;
    // 절이 길어서 원문+입력칸이 한 화면에 다 안 들어가면 입력칸 아래쪽이 보이는 쪽을 우선한다
    const hiddenBelow = (rect.bottom - delta) - bottomLimit;
    if (hiddenBelow > 0) delta += hiddenBelow;
    if (Math.abs(delta) < 6) return;
    window.scrollBy({ top: delta, behavior: "smooth" });
  };
  clearTimeout(revealTimer);
  const keyboardAlreadyUp = Date.now() - lastVerseBlurAt < 200; // Enter 등으로 절에서 절로 바로 넘어온 경우
  revealTimer = setTimeout(move, keyboardAlreadyUp ? 0 : 450);
}

// PC 배치: 입력칸들은 자기 박스(#typing-area) 안에서 따로 스크롤된다. Enter로 다음 절로 넘어가거나
// 글이 길어져 입력칸이 아래로 커질 때, 지금 쓰는 칸이 박스 아래(또는 위)로 잘려 보이지 않도록
// 박스 안 스크롤을 필요한 만큼만 옮긴다
function keepTypingRowInBox(row, smooth){
  if (isPhoneLayout()) return;
  const container = document.getElementById("typing-area");
  const box = row.querySelector(".verse-input-row__box");
  const MARGIN = 10; // 칸 테두리가 박스 가장자리에 딱 붙지 않게
  const c = container.getBoundingClientRect();
  const r = box.getBoundingClientRect();
  let delta = 0;
  if (r.bottom > c.bottom - MARGIN) delta = r.bottom - (c.bottom - MARGIN);
  // 칸이 박스보다 클 정도로 길면 아래쪽(지금 쓰고 있는 줄)을 우선하고, 아니면 위가 잘리지 않게
  if (r.top - delta < c.top + MARGIN && r.height + MARGIN * 2 <= c.height) delta = r.top - (c.top + MARGIN);
  if (Math.abs(delta) < 1) return;
  container.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
}

// 복사·붙여넣기 금지 — 절 입력칸이 장을 열 때마다 새로 만들어지므로 만들어질 때마다 걸어준다.
// paste/drop 이벤트만으로는 모바일(키보드 위 "붙여넣기" 추천 칩 등)에서 안 막히는 경우가 있어서,
// 실제로 삽입되는 내용의 종류를 알려주는 beforeinput의 inputType으로 한 번 더 확실히 막는다
function preventPasteOn(textarea){
  ["paste", "drop"].forEach(evt => textarea.addEventListener(evt, e => e.preventDefault()));
  textarea.addEventListener("beforeinput", e => {
    const blocked = ["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertReplacementText"];
    if (blocked.includes(e.inputType)) { e.preventDefault(); return; }
    // 일부 모바일 키보드(삼성 키보드 클립보드 패널 등)는 붙여넣기를 일반 입력처럼 보고해서
    // 위 분류로 안 걸러지는 경우가 있음 — 한 번에 여러 글자가 통째로 들어오면(정상 타이핑은
    // 보통 한 글자~한 음절씩 들어옴) 붙여넣기로 간주하고 막는다
    if (typeof e.data === "string" && e.data.length > 10) e.preventDefault();
  });
}

function escapeHtml(s){
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 오타 판정 기준은 문장 전체가 아니라 "띄어쓰기 전까지"(어절) 단위 — 한 단어를 다 쓰고
// 스페이스를 누른 시점에 그 단어가 원문과 다르면 빨간 글씨로 표시한다. 타이핑 중(finalize
// 안 함)에는 지금 쓰고 있는 마지막 단어가 미완성일 수 있으니 색을 매기지 않지만,
// finalize=true로 부르면(칸을 벗어날 때 등) 스페이스 없이 끝난 마지막 단어도 확정해서 검사한다
// — 그렇지 않으면 절의 맨 끝 단어를 스페이스 없이 쓰고 바로 Enter로 다음 절로 넘어갔을 때
// 그 단어가 틀려도 절대 빨간 글씨로 안 뜨는 오류가 있었다.
function renderVerseOverlay(overlayEl, typed, sourceText, finalize){
  const sourceWords = normalizeVerseText(sourceText).split(" ").filter(Boolean);
  let html = "";
  let wordStart = 0;
  let wordIndex = 0;
  for (let i = 0; i <= typed.length; i++){
    const atEnd = i === typed.length;
    const isSpace = !atEnd && typed[i] === " ";
    if (isSpace || atEnd){
      const word = typed.slice(wordStart, i);
      if (word.length){
        const confirmed = isSpace || (atEnd && finalize);
        if (confirmed){
          const correct = sourceWords[wordIndex] === word;
          html += `<span class="${correct ? "" : "is-wrong"}">${escapeHtml(word)}</span>`;
          wordIndex++;
        } else {
          html += `<span>${escapeHtml(word)}</span>`;
        }
      }
      if (isSpace) html += " ";
      wordStart = i + 1;
    }
  }
  overlayEl.innerHTML = html;
}

// 입력칸 높이를 글 양에 맞춘다. 높이를 재려고 잠깐 "auto"로 줄이는 순간 페이지(또는 입력 박스)가 짧아져
// 브라우저가 스크롤 위치를 당겨버리는데, 글자 하나 칠 때마다 이게 반복되면 화면이 위아래로 출렁인다 —
// 그래서 재기 전 스크롤 위치를 기억했다가 그대로 되돌린다. 반환: 칸이 커졌는지(true/false)
function resizeTextareaKeepingScroll(textarea){
  const box = document.getElementById("typing-area");
  const pageY = window.scrollY, boxTop = box.scrollTop;
  const before = textarea.offsetHeight;
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  if (window.scrollY !== pageY) window.scrollTo(0, pageY);
  if (box.scrollTop !== boxTop) box.scrollTop = boxTop;
  return textarea.offsetHeight > before;
}

function autoResizeVerseInput(textarea, overlay){
  const grew = resizeTextareaKeepingScroll(textarea);
  overlay.style.minHeight = textarea.offsetHeight + "px";
  return grew;
}

// 폰에서 타이핑하다 줄이 늘어 입력칸이 키보드 밑으로 내려가면, 내려간 만큼만 화면을 올린다.
// (예전에는 글자를 칠 때마다 그 절을 화면 위쪽으로 다시 맞추려 해서, 브라우저가 커서를 따라가는
//  스크롤과 부딪쳐 화면이 왔다 갔다 했다 — 이제는 칸이 실제로 커졌을 때만, 필요한 만큼만 움직인다)
function keepGrowingInputVisible(textarea){
  if (!isPhoneLayout()) return;
  const vv = window.visualViewport;
  const viewBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 10;
  const hidden = textarea.getBoundingClientRect().bottom - viewBottom;
  if (hidden > 0) window.scrollBy(0, hidden);
}

// 필사 입력칸을 절마다 하나씩 만든다. Enter를 누르면 다음 절 칸으로 넘어가고,
// 입력할 때마다 원문과 비교해 틀린 단어를 실시간으로 빨간 글씨로 보여준다.
function buildTypingArea(){
  const container = document.getElementById("typing-area-list");
  container.innerHTML = "";
  if (!openAssignment || openAssignment.done) return;

  const draft = loadDraft(openAssignment.dayIndex);
  const textareas = [];

  openAssignment.verses.forEach((v, i) => {
    const row = document.createElement("div");
    row.className = "verse-input-row";
    row.innerHTML = `
      <span class="verse-input-row__num">${v.verse}절</span>
      <div class="verse-input-row__main">
        <div class="verse-input-row__source">${v.text}</div>
        <div class="verse-input-row__box">
          <div class="verse-input-row__overlay" aria-hidden="true"></div>
          <textarea class="verse-input-row__textarea" rows="1" data-verse="${v.verse}"
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"></textarea>
        </div>
      </div>`;
    container.appendChild(row);

    const textarea = row.querySelector(".verse-input-row__textarea");
    const overlay = row.querySelector(".verse-input-row__overlay");
    textarea.value = draft[v.verse] || "";
    renderVerseOverlay(overlay, textarea.value, v.text, true); // 복원된 임시저장 내용은 이미 다 쓴 것으로 취급
    autoResizeVerseInput(textarea, overlay);
    preventPasteOn(textarea);

    textarea.addEventListener("input", () => {
      renderVerseOverlay(overlay, textarea.value, v.text);
      // 줄이 늘어나 칸이 커졌을 때만 잘리지 않게 따라간다 (폰: 화면 / PC: 입력 박스 안 스크롤)
      if (autoResizeVerseInput(textarea, overlay)){
        keepGrowingInputVisible(textarea);
        keepTypingRowInBox(row, false);
      }
      saveDraftVerse(openAssignment.dayIndex, v.verse, textarea.value);
    });

    textarea.addEventListener("focus", () => {
      showSourceVerse(i);
      revealTypingRow(row);
      keepTypingRowInBox(row, true);
    });

    // 칸을 벗어날 때(Enter로 다음 절 이동, 다른 곳 클릭, 제출 버튼 클릭 등)는 스페이스 없이
    // 끝난 마지막 단어도 확정해서 검사한다
    textarea.addEventListener("blur", () => {
      lastVerseBlurAt = Date.now();
      renderVerseOverlay(overlay, textarea.value, v.text, true);
    });

    textarea.addEventListener("keydown", e => {
      // 빈 칸에서 Backspace를 누르면 앞 절 칸 맨 끝으로 돌아가 이어서 지울 수 있게
      if (e.key === "Backspace" && textarea.value === "" && i > 0 && !e.isComposing){
        e.preventDefault();
        const prev = textareas[i - 1];
        prev.focus();
        prev.setSelectionRange(prev.value.length, prev.value.length);
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const next = textareas[i + 1];
      if (next) next.focus(); else textarea.blur();
    });

    textareas.push(textarea);
  });

  if (textareas[0]) textareas[0].focus();
}

// 원문처럼 한 줄에 "절번호 내용"을 이어서 입력한 텍스트를 [{ verse, content }] 배열로 변환
// (관리자가 본문을 등록할 때 쓰는 형식 — 회원 필사 입력은 절마다 따로 입력하므로 여기엔 안 쓰임)
function parseTypedRows(text){
  return text.split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const m = line.match(/^(\d+)\s*(.*)$/);
      return m ? { verse: Number(m[1]), content: m[2].trim() } : null;
    })
    .filter(Boolean);
}

document.getElementById("btn-submit").addEventListener("click", async () => {
  const rows = Array.from(document.querySelectorAll("#typing-area-list .verse-input-row__textarea"))
    .map(t => ({ verse: Number(t.dataset.verse), content: t.value.trim() }));
  const btn = document.getElementById("btn-submit");

  btn.disabled = true;
  try {
    const data = await api("/submit", { method: "POST", body: { dayIndex: openAssignment.dayIndex, rows } });
    if (!data.ok){
      showAlertModal(data.message || "가감하였습니다.");
      return;
    }
    clearDraft(openAssignment.dayIndex);
    document.getElementById("pilsa-panel").hidden = true;
    renderWeek();
  } catch (err) {
    showAlertModal(err.message);
  } finally {
    btn.disabled = false;
  }
});

/* ===========================================================
   계시록 암기
   화면은 3단계: 전체 장(1~22장 박스) → 한 장의 절 목록(체크박스) → 한 절 보기/테스트
   =========================================================== */
let memoData = null;          // 마지막으로 불러온 /memorize 응답 { users, checks, startDate, startChapter, totalVerses }
let memoWeekOffset = 0;       // 계시록 암기 화면의 주간 박스: 0 = 이번 주
let memoStatusWeekOffset = 0; // 현황(암기 탭)
let memoChapterNum = null;    // 지금 열려 있는 장
let memoOpen = null;          // 지금 열려 있는 절 { chapter, verse, text }
const memoTextCache = {};     // { [장]: [{ verse, text }] } — 한 번 불러온 본문은 다시 안 부른다
const MEMO_WEEKDAYS = ["월","화","수","목","금"];
const MEMO_DAY_LABELS = ["일","월","화","수","목","금","토"]; // 화면 표는 필사와 똑같이 일~토 7칸 (일·토는 배정이 없어 "-")

function memoKey(chapter, verse){ return `${chapter}:${verse}`; }
function memoChecksOf(name){ return new Set((memoData && memoData.checks[name]) || []); }

// 그 주의 일~토 날짜와 요일별 배정 절(주말처럼 배정 없는 날은 null).
// 배정은 따로 저장하지 않고, 관리자가 정한 암기 시작일부터 평일마다 한 절씩 순서대로 계산한다
function getMemoWeek(offset){
  const dates = getWeekDates(offset);
  const { startDate, startChapter } = memoData || {};
  const slots = dates.map(d => getMemoVerseForDate(d, startDate, startChapter));
  return { dates, slots };
}

function memoNoPlanMessage(){
  return memoData && memoData.startDate
    ? "이 주에는 배정된 암기 절이 없어요."
    : "아직 관리자가 암기 시작일을 정하지 않았어요.";
}

// 그 주에 지정된 절 중 체크된 비율 (지정된 절이 없으면 null)
function calcMemoWeekPct(checks, slots){
  const planned = slots.filter(Boolean);
  if (!planned.length) return null;
  const done = planned.filter(s => checks.has(memoKey(s.chapter, s.verse))).length;
  return Math.round((done / planned.length) * 100);
}

// 체크했으면 ⭕, 아직 안 했는데 그 요일이 이미 됐으면 ❌, 아직 안 온 요일이면 -
function memoMarkCell(slot, checks, date, today){
  if (!slot) return `<td>-</td>`;
  if (checks.has(memoKey(slot.chapter, slot.verse))) return `<td class="is-done">⭕</td>`;
  return date <= today ? `<td class="is-fail">❌</td>` : `<td>-</td>`;
}

function showMemoSection(name){
  ["home", "chapter", "verse", "range"].forEach(s => document.getElementById(`memo-${s}`).hidden = s !== name);
}

async function renderMemo(){
  showMemoSection("home");
  const grid = document.getElementById("memo-chapter-grid");
  grid.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  try { memoData = await api("/memorize"); }
  catch (err){ grid.innerHTML = `<p class="form-error">${err.message}</p>`; return; }
  renderMemoHome();
}

/* ---------- 1단계: 주간 박스 + 1~22장 박스 ---------- */
function renderMemoHome(){
  showMemoSection("home");
  renderMemoWeekBox();

  const mine = memoChecksOf(getCurrentUser().name);
  const doneByChapter = {};
  mine.forEach(key => { const c = key.split(":")[0]; doneByChapter[c] = (doneByChapter[c] || 0) + 1; });

  const totalPct = Math.round((mine.size / REVELATION_TOTAL_VERSES) * 100);
  document.getElementById("memo-total").innerHTML =
    `전체 진행 <span class="status-week-avg__num">${mine.size}</span> / ${REVELATION_TOTAL_VERSES}절 (${totalPct}%)`;

  const grid = document.getElementById("memo-chapter-grid");
  grid.innerHTML = REVELATION.verses.map((count, i) => {
    const chapter = i + 1;
    const done = doneByChapter[chapter] || 0;
    const pct = Math.round((done / count) * 100);
    // 박스 전체는 그 장의 절 목록으로 들어가는 버튼, 오른쪽 위 책 아이콘은 그 장 전체 본문을 바로 띄우는 버튼
    // (버튼 안에 버튼을 넣을 수 없어서 두 버튼을 나란히 겹쳐 놓는다)
    return `
      <div class="memo-chapter-box${done === count ? " is-complete" : ""}">
        <button type="button" class="memo-chapter-box__main" data-chapter="${chapter}">
          <span class="memo-chapter-box__num">${chapter}장</span>
          <span class="memo-chapter-box__count">${done} / ${count}절</span>
          <span class="memo-chapter-box__bar"><i style="width:${pct}%"></i></span>
        </button>
        <button type="button" class="memo-chapter-box__text" data-chapter-text="${chapter}" title="${chapter}장 본문 보기" aria-label="${chapter}장 본문 보기">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5v14c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/>
            <path d="M12 6v14"/>
          </svg>
        </button>
      </div>`;
  }).join("");
  grid.querySelectorAll("[data-chapter]").forEach(btn =>
    btn.addEventListener("click", () => openMemoChapter(Number(btn.dataset.chapter))));
  grid.querySelectorAll("[data-chapter-text]").forEach(btn =>
    btn.addEventListener("click", () => openChapterTextModal(Number(btn.dataset.chapterText))));
}

function renderMemoWeekBox(){
  const { dates, slots } = getMemoWeek(memoWeekOffset);
  const mine = memoChecksOf(getCurrentUser().name);
  const today = toISODate(new Date());
  document.getElementById("memo-week-range").textContent = `${dates[0]} ~ ${dates[6]}`;

  const dayRow = [`<th>요일</th>`];
  const verseRow = [`<th>암기</th>`];
  const doneRow = [`<th>완료</th>`];
  slots.forEach((slot, i) => {
    dayRow.push(`<td>${MEMO_DAY_LABELS[i]}</td>`);
    verseRow.push(slot
      ? `<td data-chapter="${slot.chapter}" data-verse="${slot.verse}">${slot.chapter}장<br>${slot.verse}절</td>`
      : `<td>-</td>`);
    doneRow.push(memoMarkCell(slot, mine, dates[i], today));
  });

  const table = document.getElementById("memo-week-table");
  table.querySelector("tbody").innerHTML =
    `<tr class="row-day">${dayRow.join("")}</tr>
     <tr class="row-chapter">${verseRow.join("")}</tr>
     <tr class="row-done">${doneRow.join("")}</tr>`;
  table.querySelectorAll("td[data-chapter]").forEach(td =>
    td.addEventListener("click", () => openMemoVerse(Number(td.dataset.chapter), Number(td.dataset.verse))));

  // 표 아래에는 배정이 없는 주일 때의 안내만 띄운다 (주간 진행률은 현황의 암기 탭에서 본다)
  const noteEl = document.getElementById("memo-week-pct");
  const hasPlan = slots.some(Boolean);
  noteEl.textContent = hasPlan ? "" : memoNoPlanMessage();
  noteEl.hidden = hasPlan;
}

document.getElementById("memo-week-prev").addEventListener("click", () => { memoWeekOffset--; renderMemoWeekBox(); });
document.getElementById("memo-week-next").addEventListener("click", () => { memoWeekOffset++; renderMemoWeekBox(); });

/* ---------- 암기 테스트 (장·절 범위를 골라 필사하듯 절마다 입력) ---------- */
let memoRange = null; // 지금 테스트 중인 범위 { chapter, verses: [{ verse, text }] }

(function initMemoRangePicker(){
  const chapterSel = document.getElementById("memo-range-chapter");
  // 기본 선택은 "0장 0 ~ 0절"(아무것도 안 고른 상태) — 0은 고르기 전 자리표시용
  chapterSel.innerHTML = `<option value="0">0</option>` +
    REVELATION.verses.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  chapterSel.addEventListener("change", () => fillMemoRangeVerses(0, 0));
  // 시작 절을 끝 절보다 뒤로 고르면(끝 절이 아직 0이어도) 끝 절을 따라 옮긴다 (반대도 마찬가지)
  document.getElementById("memo-range-from").addEventListener("change", e => {
    const to = document.getElementById("memo-range-to");
    if (Number(e.target.value) > Number(to.value)) to.value = e.target.value;
  });
  document.getElementById("memo-range-to").addEventListener("change", e => {
    const from = document.getElementById("memo-range-from");
    const v = Number(e.target.value);
    if (v && (Number(from.value) === 0 || Number(from.value) > v)) from.value = e.target.value;
  });
})();

function fillMemoRangeVerses(from, to){
  const chapter = Number(document.getElementById("memo-range-chapter").value);
  const count = chapter ? REVELATION.verses[chapter - 1] : 0;
  const options = `<option value="0">0</option>` +
    Array.from({ length: count }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  const fromSel = document.getElementById("memo-range-from"), toSel = document.getElementById("memo-range-to");
  fromSel.innerHTML = options; toSel.innerHTML = options;
  fromSel.value = from; toSel.value = to;
}

function openMemoRange(){
  document.getElementById("memo-range-chapter").value = "0";
  fillMemoRangeVerses(0, 0);
  document.getElementById("memo-range-panel").hidden = true;
  memoRange = null;
  showMemoSection("range");
}

async function startMemoRange(){
  const chapter = Number(document.getElementById("memo-range-chapter").value);
  const from = Number(document.getElementById("memo-range-from").value);
  const to = Number(document.getElementById("memo-range-to").value);
  if (!chapter || !from || !to){ showAlertModal("장과 절을 선택해주세요."); return; }
  const panel = document.getElementById("memo-range-panel");
  const list = document.getElementById("memo-range-list");
  const btn = document.getElementById("btn-memo-range-start");

  document.getElementById("memo-range-title").textContent = `${REVELATION.book} ${chapter}장 ${from}~${to}절`;
  document.getElementById("memo-range-summary").hidden = true;
  list.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  panel.hidden = false;
  btn.disabled = true;

  let texts;
  try { texts = await getRevelationChapterText(chapter); }
  catch (err){ list.innerHTML = `<p class="form-error">${err.message}</p>`; btn.disabled = false; return; }
  finally { btn.disabled = false; }

  const verses = [];
  for (let v = from; v <= to; v++){
    const found = texts.find(t => t.verse === v);
    verses.push({ verse: v, text: found ? found.text : null });
  }
  memoRange = { chapter, verses };
  buildMemoRangeRows();
}

// 필사 입력칸과 같은 모양("N절" + 입력칸)으로 절마다 한 줄씩. 채점 결과는 각 입력칸 바로 아래에 붙는다
function buildMemoRangeRows(focusFirst = true){
  const list = document.getElementById("memo-range-list");
  list.innerHTML = "";
  const textareas = [];

  memoRange.verses.forEach((v, i) => {
    const row = document.createElement("div");
    row.className = "verse-input-row";
    row.innerHTML = `
      <span class="verse-input-row__num">${v.verse}절</span>
      <div class="verse-input-row__main">
        <div class="verse-input-row__box memo-range__box">
          <textarea class="verse-input-row__textarea memo-range__input" rows="1" data-idx="${i}"
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"
            ${v.text === null ? "disabled placeholder=\"아직 본문이 등록되지 않은 절이에요\"" : ""}></textarea>
        </div>
        <div class="memo-range__result" hidden></div>
      </div>`;
    list.appendChild(row);

    const textarea = row.querySelector("textarea");
    resizeTextareaKeepingScroll(textarea);
    preventPasteOn(textarea);
    textarea.addEventListener("input", () => {
      if (resizeTextareaKeepingScroll(textarea)) keepGrowingInputVisible(textarea);
    });
    textarea.addEventListener("blur", () => { lastVerseBlurAt = Date.now(); });
    textarea.addEventListener("focus", () => revealTypingRow(row));
    textarea.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const next = textareas.slice(i + 1).find(t => !t.disabled);
      if (next) next.focus(); else textarea.blur();
    });
    textareas.push(textarea);
  });

  const first = textareas.find(t => !t.disabled);
  if (first && focusFirst) first.focus();
}

function gradeMemoRange(){
  if (!memoRange) return;
  const rows = [...document.querySelectorAll("#memo-range-list .verse-input-row")];
  const counts = { ok: 0, space: 0, wrong: 0, skipped: 0 };

  // 채점하면 입력칸을 감추고, 그 자리에 내가 쓴 답(틀린 곳 표시)을 바로 보여준다 — 그 아래 판정과 정답.
  // 다시 쓰려면 "다시하기" (입력칸이 새로 만들어진다)
  memoRange.verses.forEach((v, i) => {
    const row = rows[i];
    const input = row.querySelector("textarea");
    const box = row.querySelector(".memo-range__box");
    const resultEl = row.querySelector(".memo-range__result");
    row.classList.remove("is-ok", "is-space", "is-wrong");
    if (v.text === null){ counts.skipped++; resultEl.hidden = true; return; }
    input.blur();
    box.hidden = true;

    if (!normalizeVerseText(input.value)){
      counts.wrong++;
      row.classList.add("is-wrong");
      resultEl.innerHTML = `<div class="memo-result__text memo-range__typed is-empty">(입력하지 않았어요)</div>
        <p class="memo-result__verdict is-wrong">❌ 입력하지 않았어요</p>
        <div class="memo-result__label">정답</div><div class="memo-result__text">${escapeHtml(normalizeVerseText(v.text))}</div>`;
      resultEl.hidden = false;
      return;
    }

    const g = gradeMemoAnswer(input.value, v.text);
    counts[g.status]++;
    row.classList.add(`is-${g.status}`);
    const typed = `<div class="memo-result__text memo-range__typed">${g.typedHTML}</div>`;
    resultEl.innerHTML =
      g.status === "ok" ? `${typed}<p class="memo-result__verdict is-correct">⭕ 정확해요</p>`
      : g.status === "space" ? `${typed}<p class="memo-result__verdict is-correct">⭕ 통과 — 띄어쓰기만 원문과 달라요 (주황색)</p>
          <div class="memo-result__label">정답</div><div class="memo-result__text">${g.sourceHTML}</div>`
      : `${typed}<p class="memo-result__verdict is-wrong">❌ 틀린 곳이 있어요 (빨강 = 글자, 주황 = 띄어쓰기)</p>
          <div class="memo-result__label">정답</div><div class="memo-result__text">${g.sourceHTML}</div>`;
    resultEl.hidden = false;
  });

  const graded = counts.ok + counts.space + counts.wrong;
  const summary = document.getElementById("memo-range-summary");
  summary.innerHTML = `${graded}개 절 중 <b>⭕ ${counts.ok + counts.space}개 통과</b> · <b>❌ ${counts.wrong}개</b>${counts.skipped ? ` · 본문 미등록 ${counts.skipped}개` : ""}`;
  summary.hidden = false;
}

function resetMemoRange(focusFirst = true){
  if (!memoRange) return;
  document.getElementById("memo-range-summary").hidden = true;
  buildMemoRangeRows(focusFirst);
}

// 범위 암기 테스트 중에 다른 화면(다른 앱·탭)으로 나가면 입력한 내용을 바로 지운다 (한 절 테스트는 지우지 않음) — 나가서 본문을 보고
// 돌아와 베끼지 못하게. 돌아오면 지웠다는 걸 알려준다. (채점한 뒤에는 이미 정답이 보이는 상태라 그대로 둔다)
let memoWipedWhileAway = false;
function wipeMemoAnswersOnLeave(){
  let wiped = false;

  // 범위 암기 테스트 — 채점 전에 입력칸에 쓴 게 하나라도 있으면 전부 비운다
  // (이미 채점했으면 정답이 다 보이는 상태라 결과를 그대로 둔다 — "다시하기"를 누르면 다시 지우는 대상)
  const rangeGraded = !document.getElementById("memo-range-summary").hidden;
  if (!document.getElementById("memo-range").hidden && memoRange && !rangeGraded){
    const inputs = [...document.querySelectorAll("#memo-range-list .memo-range__input")];
    if (inputs.some(t => t.value.trim())){
      inputs.forEach(t => t.blur());
      resetMemoRange(false); // 돌아왔을 때 키보드가 저절로 올라오지 않게 첫 칸에 커서를 두지 않는다
      wiped = true;
    }
  }

  if (wiped) memoWipedWhileAway = true;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden"){ wipeMemoAnswersOnLeave(); return; }
  if (memoWipedWhileAway){
    memoWipedWhileAway = false;
    showAlertModal("다른 화면으로 나갔다 와서\n입력한 내용이 지워졌습니다.\n처음부터 다시 입력 바랍니다.");
  }
});
window.addEventListener("pagehide", wipeMemoAnswersOnLeave);

document.getElementById("btn-memo-range").addEventListener("click", openMemoRange);
document.getElementById("btn-memo-range-back").addEventListener("click", renderMemoHome);
document.getElementById("btn-memo-range-start").addEventListener("click", startMemoRange);
document.getElementById("btn-memo-range-grade").addEventListener("click", gradeMemoRange);
document.getElementById("btn-memo-range-reset").addEventListener("click", resetMemoRange);

/* ---------- 2단계: 한 장의 절 목록 ---------- */
function openMemoChapter(chapter){
  memoChapterNum = chapter;
  memoOpen = null;
  renderMemoChapter();
  showMemoSection("chapter");
}

// 장 전체 본문 창 — 필사 원문과 같은 모양("N절" + 본문)으로 한 장을 통째로 보여준다
let chapterTextOpenFor = null; // 불러오는 사이에 창을 닫거나 다른 장을 열었는지 확인용
async function openChapterTextModal(chapter){
  const modal = document.getElementById("chapter-text-modal");
  const body = document.getElementById("chapter-text-body");
  chapterTextOpenFor = chapter;
  document.getElementById("chapter-text-title").textContent = `${REVELATION.book} ${chapter}장`;
  body.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  modal.hidden = false;
  body.scrollTop = 0;

  let texts;
  try { texts = await getRevelationChapterText(chapter); }
  catch (err){ if (chapterTextOpenFor === chapter) body.innerHTML = `<p class="form-error">${err.message}</p>`; return; }
  if (chapterTextOpenFor !== chapter || modal.hidden) return;

  body.innerHTML = Array.from({ length: REVELATION.verses[chapter - 1] }, (_, i) => {
    const found = texts.find(t => t.verse === i + 1);
    return `
      <div class="source-row">
        <span class="verse-input-row__num">${i + 1}절</span>
        <div class="source-row__text${found ? "" : " is-missing"}">${found ? escapeHtml(found.text) : "아직 본문이 등록되지 않았어요"}</div>
      </div>`;
  }).join("");
}
function closeChapterTextModal(){
  chapterTextOpenFor = null;
  document.getElementById("chapter-text-modal").hidden = true;
}
document.getElementById("btn-close-chapter-text").addEventListener("click", closeChapterTextModal);
document.getElementById("chapter-text-modal").addEventListener("click", e => {
  if (e.target.id === "chapter-text-modal") closeChapterTextModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !document.getElementById("chapter-text-modal").hidden) closeChapterTextModal();
});

function renderMemoChapter(){
  const chapter = memoChapterNum;
  const count = REVELATION.verses[chapter - 1];
  const mine = memoChecksOf(getCurrentUser().name);
  const thisWeek = new Set(getMemoWeek(0).slots.filter(Boolean).map(s => memoKey(s.chapter, s.verse)));

  let doneCount = 0;
  const html = Array.from({ length: count }, (_, i) => {
    const verse = i + 1;
    const key = memoKey(chapter, verse);
    const done = mine.has(key);
    if (done) doneCount++;
    return `
      <div class="memo-verse-item${done ? " is-done" : ""}">
        <input type="checkbox" data-verse="${verse}" ${done ? "checked" : ""} aria-label="${verse}절 암기 완료">
        <button type="button" class="memo-verse-item__btn" data-verse="${verse}">${verse}절${
          thisWeek.has(key) ? `<span class="memo-badge">이번 주</span>` : ""}</button>
      </div>`;
  }).join("");

  document.getElementById("memo-chapter-title").textContent = `${REVELATION.book} ${chapter}장`;
  document.getElementById("memo-chapter-count").textContent = `${doneCount} / ${count}절`;
  const list = document.getElementById("memo-verse-list");
  list.innerHTML = html;

  list.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", async () => {
    cb.disabled = true;
    await setMemoCheck(chapter, Number(cb.dataset.verse), cb.checked);
    if (memoChapterNum === chapter && !memoOpen) renderMemoChapter(); // 실패했으면 원래 상태로 다시 그려진다
  }));
  list.querySelectorAll(".memo-verse-item__btn").forEach(btn =>
    btn.addEventListener("click", () => openMemoVerse(chapter, Number(btn.dataset.verse))));
}

// 화면에는 먼저 반영하고 서버에 저장한다 — 저장에 실패하면 되돌리고 알려준다
async function setMemoCheck(chapter, verse, done){
  const name = getCurrentUser().name;
  const key = memoKey(chapter, verse);
  const apply = on => {
    const set = memoChecksOf(name);
    if (on) set.add(key); else set.delete(key);
    memoData.checks[name] = [...set];
  };
  apply(done);
  try {
    await api("/memorize", { method: "POST", body: { action: "check", chapter, verse, done } });
    return true;
  } catch (err) {
    apply(!done);
    showAlertModal(err.message);
    return false;
  }
}

document.getElementById("btn-memo-back-home").addEventListener("click", renderMemoHome);

/* ---------- 3단계: 한 절 보기 / 가리고 테스트 ---------- */
async function getRevelationChapterText(chapter){
  if (memoTextCache[chapter]) return memoTextCache[chapter];
  const data = await api(`/chapters?book=${encodeURIComponent(REVELATION.book)}&chapter=${chapter}`);
  if (data.verses.length) memoTextCache[chapter] = data.verses; // 아직 등록 전이면 나중에 다시 조회하게 캐시하지 않음
  return data.verses;
}

// startMode: 본문을 불러온 뒤 처음 보여줄 상태 (기본은 본문 보기 — "바로 테스트"로 넘길 때는 "test")
async function openMemoVerse(chapter, verse, startMode){
  memoChapterNum = chapter;
  updateMemoVerseNav(chapter, verse);
  const open = memoOpen = { chapter, verse, text: "" };
  const textEl = document.getElementById("memo-verse-text");

  document.getElementById("memo-verse-title").textContent = `${REVELATION.book} ${chapter}장 ${verse}절`;
  document.getElementById("memo-verse-check").checked =
    memoChecksOf(getCurrentUser().name).has(memoKey(chapter, verse));
  textEl.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  setMemoMode("none");
  showMemoSection("verse");

  let verses;
  try { verses = await getRevelationChapterText(chapter); }
  catch (err){
    if (memoOpen === open) textEl.innerHTML = `<p class="form-error">${err.message}</p>`;
    return;
  }
  if (memoOpen !== open) return; // 불러오는 사이에 다른 절/화면으로 이동함

  const found = verses.find(v => v.verse === verse);
  if (!found){
    textEl.innerHTML = `<p class="form-note">아직 관리자가 이 절의 본문을 등록하지 않았어요.</p>`;
    return;
  }
  open.text = found.text;
  textEl.textContent = found.text;
  setMemoMode(startMode || "view");
}

// 이전/다음 절 버튼 — 같은 장 안에서만. 없는 쪽 버튼은 자리는 그대로 두고 감춰서(visibility)
// 남은 버튼이 좌우로 움직이지 않게 한다
function updateMemoVerseNav(chapter, verse){
  const last = REVELATION.verses[chapter - 1];
  const prev = document.getElementById("btn-memo-prev"), next = document.getElementById("btn-memo-next");
  prev.textContent = `‹ ${verse - 1}절`;
  next.textContent = `${verse + 1}절 ›`;
  prev.style.visibility = verse > 1 ? "visible" : "hidden";
  next.style.visibility = verse < last ? "visible" : "hidden";
}
// "바로 테스트": 테스트 중(가리고 쓰는 중이거나 채점 결과를 보는 중)에 앞·뒤 절로 넘기면 본문을 한 번도
// 보여주지 않고 곧바로 가린 상태로 연다. 원치 않는 사람도 있어서 켜고 끌 수 있게 하고, 선택은 기기에 저장한다 (기본: 켬)
const MEMO_KEEP_TEST_KEY = "pilsa_memo_keep_test";
function memoKeepTestOn(){
  try { return localStorage.getItem(MEMO_KEEP_TEST_KEY) !== "0"; } catch { return true; }
}
(function initMemoKeepTest(){
  const cb = document.getElementById("memo-keep-test");
  cb.checked = memoKeepTestOn();
  cb.addEventListener("change", () => {
    try { localStorage.setItem(MEMO_KEEP_TEST_KEY, cb.checked ? "1" : "0"); } catch { /* 저장 안 되는 브라우저면 이번 방문에만 */ }
  });
})();

function moveMemoVerse(delta){
  if (!memoOpen) return;
  const verse = memoOpen.verse + delta;
  if (verse < 1 || verse > REVELATION.verses[memoOpen.chapter - 1]) return;
  const testing = memoMode === "test" || memoMode === "result";
  openMemoVerse(memoOpen.chapter, verse, testing && document.getElementById("memo-keep-test").checked ? "test" : "view");
}
document.getElementById("btn-memo-prev").addEventListener("click", () => moveMemoVerse(-1));
document.getElementById("btn-memo-next").addEventListener("click", () => moveMemoVerse(1));

// none: 본문 없음(불러오는 중/미등록) · view: 본문 보기 · test: 가리고 입력 · result: 채점 결과
let memoMode = "none"; // 한 절 화면의 지금 상태 (setMemoMode 참고)
function setMemoMode(mode){
  memoMode = mode;
  const hidden = mode === "test" || mode === "result";
  document.getElementById("memo-verse-text").hidden = hidden;
  document.getElementById("memo-test").hidden = mode !== "test";
  document.getElementById("memo-result").hidden = mode !== "result";
  document.getElementById("btn-memo-hide").hidden = mode !== "view";
  document.getElementById("btn-memo-grade").hidden = mode !== "test";
  document.getElementById("btn-memo-retry").hidden = mode !== "result";
  document.getElementById("btn-memo-show").hidden = !hidden;
  if (mode === "test"){
    const input = document.getElementById("memo-test-input");
    input.value = "";
    input.focus();
  }
}

// 두 문자열을 글자 단위로 맞춰 본다(LCS) — 양쪽에서 서로 짝이 맞은 글자만 true.
// 필사처럼 어절 단위로 보면 한 글자만 틀려도 단어 전체가 빨개지고, 자리(index)만 비교하면
// 한 글자 빠뜨렸을 때 그 뒤가 전부 틀린 걸로 나와서, 실제로 다른 글자만 짚어주기 위함
function diffChars(a, b){
  const A = Array.from(a), B = Array.from(b);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1)); // dp[i][j] = A[i:]와 B[j:]의 LCS 길이
  for (let i = n - 1; i >= 0; i--){
    for (let j = m - 1; j >= 0; j--){
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aKeep = new Array(n).fill(false), bKeep = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m){
    if (A[i] === B[j]){ aKeep[i++] = true; bKeep[j++] = true; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { aKeep, bKeep };
}

// 짝이 안 맞은 글자 표시: 글자는 빨강(is-wrong), 띄어쓰기(공백)는 주황(is-space)
// — 공백은 빨갛게 칠해도 눈에 잘 안 띄어서, 어디를 띄어야(붙여야) 하는지 따로 보이게 하기 위함
function markDiffChars(text, keep){
  return Array.from(text)
    .map((ch, i) => keep[i] ? escapeHtml(ch)
      : /\s/.test(ch) ? `<span class="is-space">${escapeHtml(ch)}</span>`
      : `<span class="is-wrong">${escapeHtml(ch)}</span>`)
    .join("");
}

// 외워서 쓴 글(typed)을 원문(sourceText)과 비교한다. 띄어쓰기만 다르면 통과("space"), 글자가 다르면 오답.
// 반환: { status: "ok"|"space"|"wrong", typedHTML, sourceHTML }
function gradeMemoAnswer(typedText, sourceText){
  const typed = normalizeVerseText(typedText);
  const source = normalizeVerseText(sourceText);
  // 띄어쓰기만 다른 경우(공백을 모두 빼면 같음)는 통과("space")로 본다 — 대신 다른 곳은 주황색으로 짚어준다
  const noSpace = s => s.replace(/\s+/g, "");
  const status = typed === source ? "ok" : noSpace(typed) === noSpace(source) ? "space" : "wrong";
  const { aKeep, bKeep } = diffChars(typed, source);
  return { status, typed, typedHTML: markDiffChars(typed, aKeep), sourceHTML: markDiffChars(source, bKeep) };
}

function gradeMemoTest(){
  if (!memoOpen || document.getElementById("memo-test").hidden) return;
  const input = document.getElementById("memo-test-input");
  if (!normalizeVerseText(input.value)){ input.focus(); return; }
  const g = gradeMemoAnswer(input.value, memoOpen.text);

  const doneHint = " 다 외웠다면 '암기 완료'를 체크하세요.";
  const compare = (typedNote, sourceNote) => `
       <div class="memo-result__label">내가 쓴 답 <small>(${typedNote})</small></div>
       <div class="memo-result__text">${g.typedHTML}</div>
       <div class="memo-result__label">정답 <small>(${sourceNote})</small></div>
       <div class="memo-result__text">${g.sourceHTML}</div>`;

  document.getElementById("memo-result").innerHTML =
    g.status === "ok"
      ? `<p class="memo-result__verdict is-correct">⭕ 정확해요!${doneHint}</p>
         <div class="memo-result__text">${escapeHtml(g.typed)}</div>`
    : g.status === "space"
      ? `<p class="memo-result__verdict is-correct">⭕ 통과! 내용은 다 맞아요.${doneHint}</p>
         <p class="memo-result__note">다만 띄어쓰기가 원문과 달라요 — 주황색으로 표시된 곳을 원문대로 띄어 쓰거나 붙여 써 보세요.</p>
         ${compare("주황색 = 원문에는 없는 띄어쓰기", "주황색 = 띄어 써야 하는 곳")}`
      : `<p class="memo-result__verdict is-wrong">❌ 틀린 곳이 있어요. 빨간 글자를 확인해보세요.</p>
         ${compare("빨간 글자 = 틀리게 쓴 곳 · 주황색 = 띄어쓰기", "빨간 글자 = 빠뜨리거나 다르게 쓴 곳 · 주황색 = 띄어쓰기")}`;
  setMemoMode("result");
}

document.getElementById("btn-memo-hide").addEventListener("click", () => setMemoMode("test"));
document.getElementById("btn-memo-show").addEventListener("click", () => setMemoMode("view"));
document.getElementById("btn-memo-retry").addEventListener("click", () => setMemoMode("test"));
document.getElementById("btn-memo-grade").addEventListener("click", gradeMemoTest);
document.getElementById("btn-memo-back-chapter").addEventListener("click", () => openMemoChapter(memoChapterNum));
preventPasteOn(document.getElementById("memo-test-input"));
document.getElementById("memo-test-input").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  setTimeout(gradeMemoTest, 0); // 한글 조합 중이던 마지막 글자가 확정된 뒤에 채점
});
document.getElementById("memo-verse-check").addEventListener("change", async e => {
  const cb = e.target;
  const open = memoOpen;
  if (!open) return;
  const done = cb.checked;
  cb.disabled = true;
  const ok = await setMemoCheck(open.chapter, open.verse, done);
  cb.disabled = false;
  if (!ok && memoOpen === open) cb.checked = !done;
});

/* ---------- 현황(암기 탭) ---------- */
async function renderMemoStatus(){
  const list = document.getElementById("memo-status-list");
  list.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  try { memoData = await api("/memorize"); }
  catch (err){
    list.innerHTML = `<p class="form-error">${err.message}</p>`;
    document.getElementById("memo-status-week-avg").textContent = "";
    return;
  }
  renderMemoStatusWeek();
}

// 요일별 달성률 = 그 요일에 지정된 절을 체크한 인원 / 전체 참여 인원.
// 주간 달성률 = 그 주에 지정된 모든 절 × 전체 인원 중 체크된 비율
function renderMemoStatusWeek(){
  if (!memoData) return;
  const { users } = memoData;
  const { dates, slots } = getMemoWeek(memoStatusWeekOffset);
  const today = toISODate(new Date());
  const checksByUser = users.map(u => memoChecksOf(u.name));
  document.getElementById("memo-status-week-range").textContent = `${dates[0]} ~ ${dates[6]}`;

  const dayCells = MEMO_DAY_LABELS.map(d => `<td>${d}</td>`).join("");
  // 필사 탭의 "필사" 줄과 같은 모양(굵게, 두 줄)으로 — 탭을 넘겨도 박스 크기가 같게
  const verseCells = slots.map(s => `<td>${s ? `${s.chapter}장<br>${s.verse}절` : "-"}</td>`).join("");
  let doneTotal = 0;
  const rateCells = slots.map(s => {
    if (!s || !users.length) return `<td>-</td>`;
    const doneCount = checksByUser.filter(set => set.has(memoKey(s.chapter, s.verse))).length;
    doneTotal += doneCount;
    return `<td>${Math.round((doneCount / users.length) * 100)}%</td>`;
  }).join("");

  document.getElementById("memo-status-week-table").querySelector("tbody").innerHTML =
    `<tr class="row-day"><th>요일</th>${dayCells}</tr>
     <tr class="row-label"><th>암기</th>${verseCells}</tr>
     <tr class="row-rate"><th>달성률</th>${rateCells}</tr>`;

  const plannedCount = slots.filter(Boolean).length;
  const weekAvg = plannedCount && users.length
    ? Math.round((doneTotal / (plannedCount * users.length)) * 100) + "%"
    : "-";
  document.getElementById("memo-status-week-avg").innerHTML = plannedCount
    ? `주간 달성률 <span class="status-week-avg__num">${weekAvg}</span>`
    : memoNoPlanMessage();

  document.getElementById("memo-status-list").innerHTML = users.map((u, idx) => {
    const checks = checksByUser[idx];
    const pct = calcMemoWeekPct(checks, slots);
    const cells = slots.map((s, i) => memoMarkCell(s, checks, dates[i], today)).join("");
    return `
      <div class="status-card">
        <div class="status-card__head">
          <span class="status-card__name">${u.name}<span class="status-card__nick">${u.nickname ? "· " + u.nickname : ""}</span></span>
          <span class="status-card__pct status-card__pct--memo">주간 <span class="status-card__pct-num">${pct === null ? "-" : pct + "%"}</span>
            · 전체 <span class="status-card__pct-num">${checks.size}</span>/${REVELATION_TOTAL_VERSES}</span>
        </div>
        <table>
          <tr><th>요일</th>${MEMO_DAY_LABELS.map(d => `<th>${d}</th>`).join("")}</tr>
          <tr><th>완료</th>${cells}</tr>
        </table>
      </div>`;
  }).join("") || `<p class="form-note">아직 승인된 참여자가 없어요.</p>`;
}

document.getElementById("memo-status-week-prev").addEventListener("click", () => { memoStatusWeekOffset--; renderMemoStatusWeek(); });
document.getElementById("memo-status-week-next").addEventListener("click", () => { memoStatusWeekOffset++; renderMemoStatusWeek(); });

/* ---------- 관리자: 암기 배정 ---------- */
// 시작일(과 시작 장)만 정하면 그날부터 평일(월~금)마다 시작 장 1절부터 한 절씩 자동으로 배정된다
async function loadAdminMemoPlan(){
  const statusEl = document.getElementById("memoplan-status");
  statusEl.textContent = "불러오는 중…";
  try { memoData = await api("/memorize"); }
  catch (err){ statusEl.textContent = err.message; return; }
  statusEl.textContent = "";
  document.getElementById("memoplan-start-date").value = memoData.startDate || "";
  const chapterSel = document.getElementById("memoplan-start-chapter");
  chapterSel.innerHTML = REVELATION.verses.map((_, i) => `<option value="${i + 1}">${i + 1}장</option>`).join("");
  chapterSel.value = memoData.startChapter;
  renderMemoPlanPreview(memoData.startDate, memoData.startChapter);
}

function renderMemoPlanPreview(startDate, startChapter){
  const el = document.getElementById("memoplan-preview");
  if (!startDate){ el.innerHTML = ""; return; }

  // 시작일이 주말이면 다음 월요일이 실제 첫날. 마지막 날은 계산식 대신 실제 배정을 따라가며 찾는다
  let first = startDate;
  while (!getMemoVerseForDate(first, startDate, startChapter)) first = addDays(first, 1);
  let last = first;
  for (let remaining = REVELATION_SEQUENCE.length - 1; remaining > 0; ){
    last = addDays(last, 1);
    if (getMemoVerseForDate(last, startDate, startChapter)) remaining--;
  }
  const label = date => { const v = getMemoVerseForDate(date, startDate, startChapter); return `${v.chapter}장 ${v.verse}절`; };

  const monday = addDays(first, 1 - new Date(first + "T00:00:00").getDay());
  const rows = [0, 1].map(week => {
    const cells = MEMO_WEEKDAYS.map((_, i) => {
      const v = getMemoVerseForDate(addDays(monday, week * 7 + i), startDate, startChapter);
      return `<td>${v ? `${v.chapter}:${v.verse}` : "-"}</td>`;
    }).join("");
    return `<tr><td>${addDays(monday, week * 7).slice(5)}~</td>${cells}</tr>`;
  }).join("");

  el.innerHTML = `
    <table class="week-table" style="margin-top:14px;">
      <tr><th>주</th>${MEMO_WEEKDAYS.map(d => `<th>${d}</th>`).join("")}</tr>${rows}
    </table>
    <p class="form-note">최초 2주 미리보기입니다. 총 ${REVELATION_SEQUENCE.length}절 — ${first}에 ${label(first)}로 시작해 ${last}에 ${label(last)}로 끝나요.</p>`;
}

document.getElementById("btn-memoplan-save").addEventListener("click", async () => {
  const startDate = document.getElementById("memoplan-start-date").value;
  const startChapter = Number(document.getElementById("memoplan-start-chapter").value);
  const statusEl = document.getElementById("memoplan-status");
  const btn = document.getElementById("btn-memoplan-save");
  if (!startDate){ statusEl.textContent = "시작일을 선택해주세요."; return; }

  btn.disabled = true;
  statusEl.textContent = "저장 중…";
  try {
    await api("/memorize", { method: "POST", body: { action: "setStartDate", startDate, startChapter } });
    if (memoData){ memoData.startDate = startDate; memoData.startChapter = startChapter; }
    statusEl.textContent = "저장 완료.";
    renderMemoPlanPreview(startDate, startChapter);
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ===========================================================
   관리자
   =========================================================== */
document.querySelectorAll(".tabs__btn[data-admin-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs__btn[data-admin-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    ["pending","members","assign","content","memoplan"].forEach(t =>
      document.getElementById(`admin-${t}`).hidden = t !== btn.dataset.adminTab);
    if (btn.dataset.adminTab === "content") jumpToFirstEmptyChapter();
  });
});

// 관리자 화면에 들어온 뒤 "본문 입력" 탭을 처음 열면, 아직 본문이 없는 첫 장으로 바로 띄운다
// (서신서 순서 → 요한계시록. 요한계시록은 절 수를 알고 있어서 일부만 넣은 장도 "덜 넣은 장"으로 본다)
// 입력하던 내용이 있으면 덮어쓰지 않도록, 관리자 화면에 들어올 때마다 한 번만 하고 입력칸이 비어 있을 때만 한다
let contentAutoPicked = false;
async function jumpToFirstEmptyChapter(){
  if (contentAutoPicked) return;
  contentAutoPicked = true;
  const textarea = document.getElementById("content-textarea");
  if (textarea.value.trim()) return;
  const statusEl = document.getElementById("content-status");
  statusEl.textContent = "아직 입력하지 않은 장을 찾는 중…";

  let list;
  try { list = (await api("/chapters")).chapters; }
  catch (err){ statusEl.textContent = err.message; return; }
  const saved = new Map(list.map(c => [c.book + "|" + c.chapter, c.verses]));

  let target = null;
  for (const b of CONTENT_BOOKS){
    for (let c = 1; c <= b.chapters && !target; c++){
      const count = saved.get(b.book + "|" + c) || 0;
      const expected = b.book === REVELATION.book ? REVELATION.verses[c - 1] : 1;
      if (count < expected) target = { book: b.book, chapter: c, count, expected };
    }
    if (target) break;
  }
  if (textarea.value.trim()) return; // 찾는 사이에 입력을 시작했으면 건드리지 않는다
  if (!target){ statusEl.textContent = "모든 장의 본문이 입력되어 있어요."; return; }

  const bookSel = document.getElementById("content-book");
  const chapterInput = document.getElementById("content-chapter");
  bookSel.value = target.book;
  chapterInput.max = CONTENT_BOOKS.find(b => b.book === target.book).chapters;
  chapterInput.value = target.chapter;
  await loadChapterContent();
  statusEl.textContent = target.count
    ? `아직 덜 입력된 첫 장이에요 — ${target.book} ${target.chapter}장 (${target.count} / ${target.expected}절 입력됨).`
    : `아직 입력하지 않은 첫 장이에요 — ${target.book} ${target.chapter}장.`;
}

async function renderAdmin(){
  contentAutoPicked = false; // 관리자 화면에 다시 들어오면 본문 입력 탭을 열 때 다시 빈 장을 찾는다
  const pendingEl = document.getElementById("admin-pending");
  pendingEl.innerHTML = `<p class="form-note">불러오는 중…</p>`;

  let data;
  try { data = await api("/admin"); }
  catch (err){ pendingEl.innerHTML = `<p class="form-error">${err.message}</p>`; return; }

  renderAdminPending(data.users);
  renderAdminMembers(data.users);
  document.getElementById("assign-start-date").value = data.startDate || "";
  renderAssignPreview(data.startDate);
  document.getElementById("assign-open-until").value = data.openUntil || "";
  loadAdminMemoPlan();
}

function renderAdminPending(users){
  const pending = users.filter(u => u.status === "pending");
  const el = document.getElementById("admin-pending");
  el.innerHTML = pending.map(u => `
    <div class="admin-row">
      <span>${u.name}</span>
      <input type="text" placeholder="별명" data-nick="${u.name}">
      <button class="btn btn--primary" data-approve="${u.name}">승인</button>
      <button class="btn btn--ghost" data-reject="${u.name}">거절</button>
    </div>`).join("") || `<p class="form-note">승인 대기 중인 회원이 없어요.</p>`;

  el.querySelectorAll("[data-approve]").forEach(btn => btn.addEventListener("click", async () => {
    const name = btn.dataset.approve;
    const nick = el.querySelector(`[data-nick="${name}"]`).value.trim();
    btn.disabled = true;
    try {
      await api("/admin", { method: "POST", body: { action: "approve", name, nickname: nick } });
      renderAdmin();
    } catch (err) { alert(err.message); btn.disabled = false; }
  }));
  el.querySelectorAll("[data-reject]").forEach(btn => btn.addEventListener("click", async () => {
    const name = btn.dataset.reject;
    btn.disabled = true;
    try {
      await api("/admin", { method: "POST", body: { action: "reject", name } });
      renderAdmin();
    } catch (err) { alert(err.message); btn.disabled = false; }
  }));
}

function renderAdminMembers(users){
  // 삭제는 없고 활성/비활성만 바꾼다 — 비활성 회원은 로그인과 현황에서 빠지지만 기록은 남는다
  const members = users.filter(u => u.status === "approved" || u.status === "inactive");
  const el = document.getElementById("admin-members");
  el.innerHTML = members.map(u => {
    const active = u.status === "approved";
    return `
    <div class="admin-row admin-row--draggable${active ? "" : " is-inactive"}" data-name="${u.name}">
      <span class="drag-handle" title="드래그해서 순서 변경">⠿</span>
      <span class="admin-row__name">${u.name}${active ? "" : ` <small class="admin-row__state">비활성</small>`}</span>
      <input type="text" value="${u.nickname}" data-editnick="${u.name}">
      <button class="btn btn--ghost" data-set-active="${u.name}" data-active="${!active}">${active ? "비활성화" : "활성화"}</button>
    </div>`;
  }).join("") || `<p class="form-note">회원이 없어요.</p>`;

  el.querySelectorAll("[data-editnick]").forEach(inp => inp.addEventListener("change", async () => {
    try {
      await api("/admin", { method: "POST", body: { action: "setNickname", name: inp.dataset.editnick, nickname: inp.value } });
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll("[data-set-active]").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await api("/admin", { method: "POST", body: { action: "setActive", name: btn.dataset.setActive, active: btn.dataset.active === "true" } });
      renderAdmin();
    } catch (err) { alert(err.message); btn.disabled = false; }
  }));

  initMemberDragReorder(el);
}

// 이름 왼쪽 드래그 핸들(⠿)로 순서를 바꾸면 서버에 그 순서를 저장하고,
// 현황 화면도 (같은 회원 목록 순서를 그대로 쓰기 때문에) 같은 순서로 보이게 된다
// HTML5 드래그앤드롭(dragstart 등)은 마우스 전용이라 모바일 터치에서 전혀 동작하지 않으므로,
// 데스크톱·모바일에서 동일하게 동작하는 Pointer Events로 직접 구현한다
function initMemberDragReorder(container){
  let dragRow = null;

  function onPointerMove(e){
    if (!dragRow) return;
    e.preventDefault();
    const rows = Array.from(container.querySelectorAll(".admin-row--draggable")).filter(r => r !== dragRow);
    for (const row of rows){
      const rect = row.getBoundingClientRect();
      if (e.clientY < rect.top || e.clientY > rect.bottom) continue;
      const before = e.clientY < rect.top + rect.height / 2;
      container.insertBefore(dragRow, before ? row : row.nextSibling);
      break;
    }
  }

  async function onPointerUp(){
    if (!dragRow) return;
    dragRow.classList.remove("is-dragging");
    const finishedRow = dragRow;
    dragRow = null;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);

    const names = Array.from(container.querySelectorAll(".admin-row--draggable")).map(r => r.dataset.name);
    try {
      await api("/admin", { method: "POST", body: { action: "reorder", names } });
    } catch (err) {
      alert(err.message);
      renderAdmin();
    }
  }

  container.querySelectorAll(".admin-row--draggable").forEach(row => {
    row.querySelector(".drag-handle").addEventListener("pointerdown", e => {
      e.preventDefault();
      dragRow = row;
      row.classList.add("is-dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });
  });
}

document.getElementById("btn-assign-save").addEventListener("click", async () => {
  const val = document.getElementById("assign-start-date").value;
  if (!val) return alert("시작일을 선택해주세요.");
  try {
    await api("/admin", { method: "POST", body: { action: "setStartDate", startDate: val } });
    renderAssignPreview(val);
  } catch (err) { alert(err.message); }
});

document.getElementById("assign-open-until").addEventListener("change", async e => {
  const input = e.target;
  const openUntil = input.value; // 비우면 기본값(이번 주까지)으로 되돌아감
  input.disabled = true;
  try {
    await api("/admin", { method: "POST", body: { action: "setOpenUntil", openUntil } });
  } catch (err) {
    alert(err.message);
    renderAdmin(); // 실패 시 서버 값으로 되돌림
  } finally {
    input.disabled = false;
  }
});

function renderAssignPreview(startDate){
  const el = document.getElementById("assign-preview");
  if (!startDate){ el.innerHTML = ""; return; }
  // 이번 주 일요일(시작 전이면 시작일)부터 2주 — 주말처럼 배정이 없는 날은 "-"
  const thisSunday = toISODate(startOfWeek(new Date()));
  const from = startDate > thisSunday ? startDate : thisSunday;
  const dayLabels = ["일","월","화","수","목","금","토"];
  const rows = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(from, i);
    const dayIndex = dateToDayIndex(date, startDate);
    const label = dayIndex === null ? "-" : formatAssignmentLabel(getAssignmentForDayIndex(dayIndex));
    return `<tr><td>${date} (${dayLabels[new Date(date + "T00:00:00").getDay()]})</td><td>${label}</td></tr>`;
  }).join("");
  const lastDate = dayIndexToDate(CHAPTER_SEQUENCE.length - 1, startDate);
  el.innerHTML = `
    <table class="week-table" style="margin-top:14px;">
      <tr><th>날짜</th><th>배정 장</th></tr>${rows}
    </table>
    <p class="form-note">앞으로 2주 미리보기입니다. 총 ${CHAPTER_SEQUENCE.length}장 — ${lastDate}에 유다서 1장으로 끝나요.</p>`;
}

/* ---------- 관리자: 본문 입력 ---------- */
// 책/장을 바꾸면(드롭다운 선택이든, 장 번호 직접 입력이든, 이전·다음 장 버튼이든) 그 자리에서
// 바로 원문을 불러온다 — 예전에는 장 번호만 바꿨을 때 "불러오기"를 따로 눌러야 했고,
// 안 누르고 저장하면 이전 장 내용이 새 장에 그대로 저장되는 사고가 날 수 있었다.
(function initContentPicker(){
  const bookSel = document.getElementById("content-book");
  bookSel.innerHTML = CONTENT_BOOKS.map(e => `<option value="${e.book}">${e.book} (총 ${e.chapters}장)</option>`).join("");
  bookSel.addEventListener("change", () => {
    const meta = CONTENT_BOOKS.find(e => e.book === bookSel.value);
    const chapterInput = document.getElementById("content-chapter");
    chapterInput.max = meta.chapters;
    if (Number(chapterInput.value) > meta.chapters) chapterInput.value = 1;
    loadChapterContent();
  });
  document.getElementById("content-chapter").addEventListener("change", loadChapterContent);
})();

// 현재 책의 장 범위를 넘어가면 자동으로 이전/다음 책으로 넘어간다 (책 경계에서는 멈춤)
function moveContentChapter(delta){
  const bookSel = document.getElementById("content-book");
  const chapterInput = document.getElementById("content-chapter");
  const bookIdx = CONTENT_BOOKS.findIndex(e => e.book === bookSel.value);
  let targetIdx = bookIdx;
  let chapter = Number(chapterInput.value) + delta;

  if (chapter < 1){
    targetIdx = bookIdx - 1;
    if (targetIdx < 0) return;
    chapter = CONTENT_BOOKS[targetIdx].chapters;
  } else if (chapter > CONTENT_BOOKS[bookIdx].chapters){
    targetIdx = bookIdx + 1;
    if (targetIdx >= CONTENT_BOOKS.length) return;
    chapter = 1;
  }

  bookSel.value = CONTENT_BOOKS[targetIdx].book;
  chapterInput.max = CONTENT_BOOKS[targetIdx].chapters;
  chapterInput.value = chapter;
  loadChapterContent();
}
document.getElementById("btn-content-prev").addEventListener("click", () => moveContentChapter(-1));
document.getElementById("btn-content-next").addEventListener("click", () => moveContentChapter(1));

async function loadChapterContent(){
  const book = document.getElementById("content-book").value;
  const chapter = Number(document.getElementById("content-chapter").value) || 1;
  const statusEl = document.getElementById("content-status");
  const textarea = document.getElementById("content-textarea");

  statusEl.textContent = "불러오는 중…";
  try {
    const data = await api(`/chapters?book=${encodeURIComponent(book)}&chapter=${chapter}`);
    textarea.value = data.verses.map(v => `${v.verse} ${v.text}`).join("\n");
    statusEl.textContent = data.verses.length ? `${data.verses.length}개 절이 저장되어 있어요.` : "아직 입력된 내용이 없어요.";
  } catch (err) {
    statusEl.textContent = err.message;
  }
}
document.getElementById("btn-content-load").addEventListener("click", loadChapterContent);

document.getElementById("btn-content-save").addEventListener("click", async () => {
  const book = document.getElementById("content-book").value;
  const chapter = Number(document.getElementById("content-chapter").value) || 1;
  const verses = parseTypedRows(document.getElementById("content-textarea").value);
  const statusEl = document.getElementById("content-status");
  const btn = document.getElementById("btn-content-save");

  if (!verses.length){ statusEl.textContent = "입력된 절이 없어요."; return; }

  btn.disabled = true;
  statusEl.textContent = "저장 중…";
  try {
    await api("/chapters", { method: "POST", body: { book, chapter, verses } });
    statusEl.textContent = `저장 완료 — ${book} ${chapter}장, ${verses.length}개 절.`;
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

/* ===========================================================
   시작
   =========================================================== */
showView(AUTH.token && AUTH.user ? "view-status" : "view-auth");
