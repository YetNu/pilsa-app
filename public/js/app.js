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
let openAssignment = null;   // 현재 펼쳐진 (날짜, 배정쌍)

/* ---------- 화면 전환 ---------- */
const views = ["view-auth", "view-status", "view-mypilsa", "view-admin"];
function showView(id){
  views.forEach(v => document.getElementById(v).hidden = (v !== id));
  document.getElementById("topbar").hidden = (id === "view-auth");
  const me = getCurrentUser();
  document.getElementById("btn-admin").hidden = !(me && me.role === "admin");
  if (id === "view-status") renderStatus();
  if (id === "view-mypilsa"){ weekOffset = weekOffset || 0; renderWeek(); }
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
document.getElementById("btn-status").addEventListener("click", () => showView("view-status"));
document.getElementById("btn-mypilsa").addEventListener("click", () => { weekOffset = 0; showView("view-mypilsa"); });
document.getElementById("btn-admin").addEventListener("click", () => showView("view-admin"));
document.getElementById("btn-logout").addEventListener("click", () => logout());

/* ===========================================================
   현황 페이지
   =========================================================== */
async function renderStatus(){
  const list = document.getElementById("status-list");
  list.innerHTML = `<p class="form-note">불러오는 중…</p>`;

  let data;
  try { data = await api("/status"); }
  catch (err){ list.innerHTML = `<p class="form-error">${err.message}</p>`; return; }

  const { users, submissions, startDate, totalChapters } = data;
  const today = toISODate(new Date());
  const days = getWeekDates(0); // 이번 주 일~토

  list.innerHTML = users.map(u => {
    const pct = calcProgressPct(u.name, today, submissions, startDate, totalChapters);
    const sub = submissions[u.name] || {};
    const cells = days.map(d => {
      const dayIndex = dateToDayIndex(d, startDate);
      const done = dayIndex !== null && sub[dayIndex];
      const isFuture = d > today;
      let cls = "", mark = "-";
      if (!isFuture && dayIndex !== null){
        mark = done ? "⭕" : "❌";
        cls = done ? "is-done" : "is-fail";
      }
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

function calcProgressPct(userName, today, submissions, startDate, totalChapters){
  if (!startDate || today < startDate) return 0;
  const totalDayIndex = Math.floor((new Date(today) - new Date(startDate)) / 86400000);
  const totalAssignedDays = Math.min(totalDayIndex + 1, Math.ceil(totalChapters / 2));
  if (totalAssignedDays <= 0) return 0;
  const sub = submissions[userName] || {};
  let done = 0;
  for (let i = 0; i < totalAssignedDays; i++) if (sub[i]) done++;
  return Math.round((done / totalAssignedDays) * 100);
}

/* ===========================================================
   내 필사 (주간 박스)
   =========================================================== */
// 좁은 표 칸에서 "로마서13~14장"처럼 어색하게 줄바꿈되는 걸 막기 위해,
// 책 이름과 장 번호를 의도한 지점에서 줄바꿈해서 보여주는 HTML 버전
function formatAssignmentLabelHTML(pair){
  if (pair.length === 0) return "-";
  if (pair.length === 1) return `${pair[0].book}<br>${pair[0].chapter}장`;
  const [a, b] = pair;
  if (a.book === b.book) return `${a.book}<br>${a.chapter}~${b.chapter}장`;
  return `${a.book}${a.chapter}장,<br>${b.book}${b.chapter}장`;
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

function dateToDayIndex(dateStr, startDate){
  if (!startDate || dateStr < startDate) return null;
  return Math.floor((new Date(dateStr) - new Date(startDate)) / 86400000);
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

  const { submissions, startDate } = data;
  const me = getCurrentUser();
  const mySub = submissions[me.name] || {};
  const today = toISODate(new Date());
  const dayLabels = ["일","월","화","수","목","금","토"];

  const dayRow = [`<th>요일</th>`];
  const chapRow = [`<th>필사</th>`];
  const doneRow = [`<th>완료</th>`];

  days.forEach((d, i) => {
    dayRow.push(`<td>${dayLabels[i]}</td>`);
    const dayIndex = dateToDayIndex(d, startDate);
    const isFuture = d > today; // 요일이 되기 전엔 타이핑 불가
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
      chapRow.push(`<td data-day-index="${dayIndex}" data-date="${d}" data-done="${done}">${label}</td>`);
      doneRow.push(`<td class="${done ? "is-done" : "is-fail"}">${done ? "⭕" : "❌"}</td>`);
    }
  });

  table.querySelector("tbody").innerHTML =
    `<tr class="row-day">${dayRow.join("")}</tr>
     <tr class="row-chapter">${chapRow.join("")}</tr>
     <tr class="row-done">${doneRow.join("")}</tr>`;

  table.querySelectorAll(".row-chapter td[data-day-index]").forEach(td => {
    td.addEventListener("click", () => {
      openPilsaPanel(Number(td.dataset.dayIndex), td.dataset.date, td.dataset.done === "true");
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

// 오늘 몫은 아직 하루가 안 끝났으니 "미완료"로 안 치고, 이미 지나간 날짜만 확인한다
function findOldestIncompleteDayIndex(startDate, sub){
  if (!startDate) return null;
  const today = toISODate(new Date());
  const maxDayIndex = dateToDayIndex(today, startDate);
  if (maxDayIndex === null) return null;
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
  const targetDate = addDays(data.startDate, idx);
  const now = new Date(); const today0 = new Date(toISODate(now));
  const target = new Date(targetDate);
  const diffWeeks = Math.floor((startOfWeek(target) - startOfWeek(today0)) / (7 * 86400000));
  weekOffset = diffWeeks;
  renderWeek();
});
function startOfWeek(d){ const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }

/* ---------- 필사 패널 (본문 + 타이핑) ---------- */
async function openPilsaPanel(dayIndex, dateStr, done){
  const pair = getAssignmentForDayIndex(dayIndex);
  openAssignment = { dayIndex, pair, verses: [], done: !!done };

  document.getElementById("pilsa-panel__title").textContent = formatAssignmentLabel(pair);
  document.getElementById("pilsa-panel__text").innerHTML = `<p class="form-note">불러오는 중…</p>`;
  document.getElementById("typing-area").hidden = true;
  document.querySelector(".typing-hint").hidden = openAssignment.done;
  document.getElementById("btn-submit").hidden = openAssignment.done;
  document.getElementById("btn-submit").disabled = true;
  buildTypingArea();
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

  document.getElementById("pilsa-panel__text").innerHTML =
    verses.map(v => `<div>${v.chapter}:${v.verse} ${v.text}</div>`).join("");

  openAssignment.verses = verses;
  if (!openAssignment.done){
    document.getElementById("typing-area").hidden = false;
    document.getElementById("btn-submit").disabled = false;
  }
}

document.getElementById("btn-cancel").addEventListener("click", () => {
  // 입력하던 내용은 draft로 남아있어서, 닫아도 같은 날짜를 다시 열면 이어서 쓸 수 있다
  document.getElementById("pilsa-panel").hidden = true;
});

// 모바일에서는 새로고침/이탈 경고창(beforeunload)이 거의 안 뜨기 때문에(특히 iOS Safari는
// 아예 지원 안 함), 실수로 새로고침하거나 나가도 입력 중이던 내용을 잃지 않도록 타이핑하는
// 동안 계속 localStorage에 임시 저장해두고, 같은 날짜를 다시 열면 자동으로 복원한다.
// 제출에 성공하면 그때만 지운다 (닫기/다른 화면 이동 시에는 나중에 이어 쓸 수 있게 남겨둠).
function draftKey(dayIndex){
  const me = getCurrentUser();
  return `pilsa_draft_${me ? me.name : "anon"}_${dayIndex}`;
}
function saveDraft(dayIndex, text){
  if (text) localStorage.setItem(draftKey(dayIndex), text);
  else localStorage.removeItem(draftKey(dayIndex));
}
function loadDraft(dayIndex){
  return localStorage.getItem(draftKey(dayIndex)) || "";
}
function clearDraft(dayIndex){
  localStorage.removeItem(draftKey(dayIndex));
}
document.getElementById("typing-textarea").addEventListener("input", e => {
  if (openAssignment) saveDraft(openAssignment.dayIndex, e.target.value);
});

function buildTypingArea(){
  if (openAssignment && openAssignment.done) return;
  const textarea = document.getElementById("typing-textarea");
  textarea.value = openAssignment ? loadDraft(openAssignment.dayIndex) : "";
  textarea.focus();
}

// 복사·붙여넣기 금지 (한 번만 등록하면 됨 — textarea는 매번 새로 만들지 않고 값만 비움)
// paste/drop 이벤트만으로는 모바일(키보드 위 "붙여넣기" 추천 칩 등)에서 안 막히는 경우가 있어서,
// 실제로 삽입되는 내용의 종류를 알려주는 beforeinput의 inputType으로 한 번 더 확실히 막는다
(function preventPasteOnTypingTextarea(){
  const textarea = document.getElementById("typing-textarea");
  ["paste", "drop"].forEach(evt => textarea.addEventListener(evt, e => e.preventDefault()));
  textarea.addEventListener("beforeinput", e => {
    const blocked = ["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertReplacementText"];
    if (blocked.includes(e.inputType)) { e.preventDefault(); return; }
    // 일부 모바일 키보드(삼성 키보드 클립보드 패널 등)는 붙여넣기를 일반 입력처럼 보고해서
    // 위 분류로 안 걸러지는 경우가 있음 — 한 번에 여러 글자가 통째로 들어오면(정상 타이핑은
    // 보통 한 글자~한 음절씩 들어옴) 붙여넣기로 간주하고 막는다
    if (typeof e.data === "string" && e.data.length > 10) e.preventDefault();
  });
})();

// 원문처럼 한 줄에 "절번호 내용"을 이어서 입력한 텍스트를 [{ verse, content }] 배열로 변환
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
  const rows = parseTypedRows(document.getElementById("typing-textarea").value);
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
   관리자
   =========================================================== */
document.querySelectorAll(".tabs__btn[data-admin-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs__btn[data-admin-tab]").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    ["pending","members","assign","content"].forEach(t =>
      document.getElementById(`admin-${t}`).hidden = t !== btn.dataset.adminTab);
  });
});

async function renderAdmin(){
  const pendingEl = document.getElementById("admin-pending");
  pendingEl.innerHTML = `<p class="form-note">불러오는 중…</p>`;

  let data;
  try { data = await api("/admin"); }
  catch (err){ pendingEl.innerHTML = `<p class="form-error">${err.message}</p>`; return; }

  renderAdminPending(data.users);
  renderAdminMembers(data.users);
  document.getElementById("assign-start-date").value = data.startDate || "";
  renderAssignPreview(data.startDate);
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
  const members = users.filter(u => u.status === "approved");
  const el = document.getElementById("admin-members");
  el.innerHTML = members.map(u => `
    <div class="admin-row">
      <span>${u.name}</span>
      <input type="text" value="${u.nickname}" data-editnick="${u.name}">
      <button class="btn btn--ghost" data-remove="${u.name}">삭제</button>
    </div>`).join("");

  el.querySelectorAll("[data-editnick]").forEach(inp => inp.addEventListener("change", async () => {
    try {
      await api("/admin", { method: "POST", body: { action: "setNickname", name: inp.dataset.editnick, nickname: inp.value } });
    } catch (err) { alert(err.message); }
  }));
  el.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm(`${btn.dataset.remove} 님을 삭제할까요?`)) return;
    try {
      await api("/admin", { method: "POST", body: { action: "remove", name: btn.dataset.remove } });
      renderAdmin();
    } catch (err) { alert(err.message); }
  }));
}

document.getElementById("btn-assign-save").addEventListener("click", async () => {
  const val = document.getElementById("assign-start-date").value;
  if (!val) return alert("시작일을 선택해주세요.");
  try {
    await api("/admin", { method: "POST", body: { action: "setStartDate", startDate: val } });
    renderAssignPreview(val);
  } catch (err) { alert(err.message); }
});

function renderAssignPreview(startDate){
  const el = document.getElementById("assign-preview");
  if (!startDate){ el.innerHTML = ""; return; }
  const rows = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(startDate, i);
    const label = formatAssignmentLabel(getAssignmentForDayIndex(i));
    return `<tr><td>${date}</td><td>${label}</td></tr>`;
  }).join("");
  el.innerHTML = `
    <table class="week-table" style="margin-top:14px;">
      <tr><th>날짜</th><th>배정 장</th></tr>${rows}
    </table>
    <p class="form-note">최초 2주 미리보기입니다. 총 ${CHAPTER_SEQUENCE.length}장 배정 완료.</p>`;
}

/* ---------- 관리자: 본문 입력 ---------- */
(function initContentPicker(){
  const bookSel = document.getElementById("content-book");
  bookSel.innerHTML = EPISTLES.map(e => `<option value="${e.book}">${e.book} (총 ${e.chapters}장)</option>`).join("");
  bookSel.addEventListener("change", () => {
    const meta = EPISTLES.find(e => e.book === bookSel.value);
    const chapterInput = document.getElementById("content-chapter");
    chapterInput.max = meta.chapters;
    if (Number(chapterInput.value) > meta.chapters) chapterInput.value = 1;
    loadChapterContent();
  });
})();

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
