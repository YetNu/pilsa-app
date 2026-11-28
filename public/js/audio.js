/* ===========================================================
   계시록 암기 — 절 음성 듣기
   - 음성 파일: /audio/<음성 id>/<장>/<절>.mp3
   - 어떤 음성이 있는지는 /audio/voices.json 에 적는다 → { "voices": [{ "id": "male1", "name": "남성 1" }] }
     (여기에 적힌 음성만 고르는 메뉴에 나온다. 아직 하나도 없으면 "준비 중" 안내만 보인다)
   - [듣기] 옆 톱니(설정) 버튼을 누르면 작은 상자가 열리고 음성·배속·반복을 고른다
   - 한 절 화면: 그 절을 N번(직접 적기) 또는 무한 반복
   - 장 전체 본문 창: 1절부터 차례로, 절마다 N번 읽고 다음 절로. "무한"(범위 옆)을 켜면 범위가 끝나면 처음부터 다시
     설정에서 "범위"(몇 절 ~ 몇 절)를 고르면 그 절들만 읽는다 — 기본은 장 전체, 창을 새로 열면 다시 장 전체
   - 고른 음성·배속·반복은 이 기기에 저장한다
   =========================================================== */
const MemoAudio = (() => {
  const STORE_KEY = "pilsa_memo_audio";
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const MAX_REPEAT = 99;
  const GAP_MS = 700; // 같은 절을 다시 읽거나 다음 절로 넘어갈 때 잠깐 쉬는 시간

  // verseRepeat/chapterRepeat: 직접 적은 횟수 · verseLoop: 한 절 무한 반복 · chapterLoop: 장 전체 무한 반복
  const defaults = { voice: "", rate: 1, verseRepeat: 1, verseLoop: false, chapterRepeat: 1, chapterLoop: false };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { /* 기본값 */ }
  if (settings.verseRepeat === 0){ settings.verseRepeat = 1; settings.verseLoop = true; } // 예전 저장값(0 = 무한)
  const clampRepeat = n => Math.min(MAX_REPEAT, Math.max(1, Math.round(Number(n)) || 1));
  settings.verseRepeat = clampRepeat(settings.verseRepeat);
  settings.chapterRepeat = clampRepeat(settings.chapterRepeat);
  function save(){
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 저장 안 되는 브라우저면 이번 방문에만 */ }
  }

  let voices = null;        // [{ id, name }] — 처음 한 번 불러온다
  let voicesLoading = null;
  function loadVoices(){
    if (voices) return Promise.resolve(voices);
    if (!voicesLoading){
      voicesLoading = fetch("/audio/voices.json", { cache: "no-cache" })
        .then(r => r.ok ? r.json() : { voices: [] })
        .then(d => (Array.isArray(d.voices) ? d.voices : []).filter(v => v && v.id && v.name))
        .catch(() => [])
        .then(list => {
          voices = list;
          if (!voices.some(v => v.id === settings.voice)) settings.voice = voices.length ? voices[0].id : "";
          return voices;
        });
    }
    return voicesLoading;
  }
  const fileUrl = (voice, chapter, verse) => `/audio/${encodeURIComponent(voice)}/${chapter}/${verse}.mp3`;

  /* ---------- 재생 ---------- */
  const audio = new Audio();
  audio.preload = "auto";
  // session: { kind: "verse"|"chapter", chapter, verses: [절…], idx, done(이번 절을 읽은 횟수), ctrl(그리는 쪽) }
  let session = null;
  let gapTimer = null;

  function stop(){
    clearTimeout(gapTimer);
    const s = session;
    session = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (s) s.ctrl.update(null);
  }

  function repeatTarget(s){
    if (s.kind === "verse") return settings.verseLoop ? 0 : settings.verseRepeat; // 0 = 무한
    return settings.chapterRepeat;
  }

  function playCurrent(){
    const s = session;
    const verse = s.verses[s.idx];
    s.ctrl.update(verse);
    audio.src = fileUrl(settings.voice, s.chapter, verse);
    audio.playbackRate = settings.rate;
    audio.play().catch(err => {
      if (session !== s) return;
      if (err && err.name === "NotAllowedError"){ stop(); return; } // 브라우저가 소리 재생을 막음 — 다시 누르면 된다
      // 파일이 없는 경우는 아래 error 이벤트에서 처리
    });
  }

  function next(){
    const s = session;
    if (!s) return;
    s.done++;
    const target = repeatTarget(s);
    if (target === 0 || s.done < target){ gapTimer = setTimeout(() => session === s && playCurrent(), GAP_MS); return; }
    advance(s);
  }
  function advance(s){
    s.done = 0;
    s.idx++;
    if (s.idx >= s.verses.length){
      if (s.kind === "chapter" && settings.chapterLoop && s.played){ s.idx = 0; s.missing = 0; }
      else { stop(); return; }
    }
    gapTimer = setTimeout(() => session === s && playCurrent(), GAP_MS);
  }

  audio.addEventListener("playing", () => { if (session) session.played = true; });
  audio.addEventListener("ended", next);
  audio.addEventListener("error", () => {
    const s = session;
    if (!s || !audio.getAttribute("src")) return;
    // 이 절의 음성 파일이 아직 없음 — 한 절 화면이면 알려주고 멈추고, 장 전체면 건너뛴다
    if (s.kind === "verse"){ stop(); s.ctrl.notice("이 절의 음성이 아직 준비되지 않았어요."); return; }
    s.missing = (s.missing || 0) + 1;
    if (s.missing >= s.verses.length){ stop(); s.ctrl.notice("이 장의 음성이 아직 준비되지 않았어요."); return; }
    advance(s);
  });

  function start(kind, chapter, verses, ctrl, fromIdx = 0){
    stop();
    if (!settings.voice || !verses.length) return;
    session = { kind, chapter, verses, idx: fromIdx, done: 0, ctrl, missing: 0, played: false };
    playCurrent();
  }

  /* ---------- [듣기] 버튼 + [설정] 버튼 ----------
     el: 안내 문구("준비 중" 등)를 띄울 자리
     kind: "verse" | "chapter" · getTarget(): { chapter, verses } — 누를 때마다 지금 보고 있는 장·절을 물어본다
     onVerse(verse|null): 지금 읽는 절이 바뀔 때 (장 전체 창에서 줄 강조용)
     buttonSlot: 두 버튼을 넣을 자리 (없으면 el 안)
     popDown: 설정 상자를 버튼 아래로 연다 (기본은 위로)
     pickRange(chapter, range|null, done(from, to)): 장 전체 창에서 범위 단추를 누르면 절 고르는 상자를 띄운다 */
  function mount(el, kind, getTarget, onVerse, buttonSlot, popDown, pickRange){
    const repeatKey = kind === "verse" ? "verseRepeat" : "chapterRepeat";
    const loopKey = kind === "verse" ? "verseLoop" : "chapterLoop";
    el.classList.add("memo-audio");
    el.innerHTML = `<p class="memo-audio__note" hidden></p>`;

    const group = document.createElement("span");
    group.className = "memo-audio__group";
    group.innerHTML = `
      <button type="button" class="btn btn--primary memo-audio__play" aria-label="듣기">
        <span class="memo-audio__icon" aria-hidden="true">▶</span><span class="memo-audio__label">듣기</span>
      </button>
      <button type="button" class="btn btn--primary memo-audio__gear" aria-label="듣기 설정" title="듣기 설정" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <div class="memo-audio__pop${popDown ? " memo-audio__pop--down" : ""}" role="dialog" aria-label="듣기 설정" hidden>
        <label class="memo-audio__row memo-audio__voice-row" hidden>
          <span class="memo-audio__name">음성</span>
          <select class="memo-audio__voice"></select>
        </label>
        ${kind === "chapter" ? `<div class="memo-audio__row memo-audio__range-row">
          <span class="memo-audio__name">범위</span>
          <button type="button" class="memo-audio__range-btn"></button>
          <label class="memo-audio__loop" title="범위 끝까지 읽으면 처음부터 다시"><input type="checkbox" class="memo-audio__loop-input"> 무한</label>
        </div>` : ""}
        <label class="memo-audio__row">
          <span class="memo-audio__name">배속</span>
          <select class="memo-audio__rate">${RATES.map(r => `<option value="${r}">${r}배</option>`).join("")}</select>
        </label>
        <div class="memo-audio__row">
          <span class="memo-audio__name">반복</span>
          <span class="memo-audio__repeat">${kind === "chapter" ? "절마다 " : ""}<input type="number" class="memo-audio__count"
            min="1" max="${MAX_REPEAT}" step="1" inputmode="numeric" aria-label="반복 횟수">번</span>
          ${kind === "chapter" ? "" : `<label class="memo-audio__loop"><input type="checkbox" class="memo-audio__loop-input"> 무한</label>`}
        </div>
      </div>`;
    if (buttonSlot) buttonSlot.appendChild(group); else el.prepend(group); // 안내 문구는 버튼 아래에

    const playBtn = group.querySelector(".memo-audio__play");
    const gearBtn = group.querySelector(".memo-audio__gear");
    const pop = group.querySelector(".memo-audio__pop");
    const voiceRow = group.querySelector(".memo-audio__voice-row");
    const voiceSel = group.querySelector(".memo-audio__voice");
    const rateSel = group.querySelector(".memo-audio__rate");
    const countInput = group.querySelector(".memo-audio__count");
    const loopCb = group.querySelector(".memo-audio__loop-input");
    const noteEl = el.querySelector(".memo-audio__note");
    const rangeBtn = group.querySelector(".memo-audio__range-btn");

    // 장 전체 창의 듣기 범위 — null 이면 장 전체 (창을 새로 열 때마다 장 전체로 돌아간다)
    let range = null;
    const inRange = v => !range || (v >= range.from && v <= range.to);
    // 범위 단추: "3~5절" — 누르면 시험 범위 고르기와 같은 절 상자(pickRange)가 뜨고, 시작 절·끝 절을 차례로 누른다
    function fillRange(){
      if (!rangeBtn) return;
      const t = getTarget();
      const list = t ? t.verses : [];
      group.querySelector(".memo-audio__range-row").hidden = !list.length;
      if (!list.length) return;
      const from = range ? range.from : list[0], to = range ? range.to : list[list.length - 1];
      rangeBtn.textContent = from === to ? `${from}절` : `${from}~${to}절`;
      rangeBtn.classList.toggle("is-all", !range);
    }
    if (rangeBtn) rangeBtn.addEventListener("click", () => {
      const t = getTarget();
      if (!t || !t.verses.length || !pickRange) return;
      closePop();
      pickRange(t.chapter, range, (from, to) => {
        const all = t.verses;
        range = from <= all[0] && to >= all[all.length - 1] ? null : { from, to };
        openPop(); // 고른 범위를 바로 보여준다
      });
    });

    const ctrl = {
      update(verse){
        const on = verse != null;
        group.classList.toggle("is-playing", on);
        playBtn.querySelector(".memo-audio__icon").textContent = on ? "■" : "▶";
        playBtn.querySelector(".memo-audio__label").textContent = on ? "멈춤" : "듣기";
        playBtn.setAttribute("aria-label", on ? "멈춤" : "듣기");
        if (onVerse) onVerse(on ? verse : null);
      },
      notice(text){ noteEl.textContent = text; noteEl.hidden = !text; },
    };

    function syncInputs(){
      rateSel.value = String(settings.rate);
      countInput.value = String(settings[repeatKey]);
      loopCb.checked = settings[loopKey];
      // 한 절 화면은 무한이면 횟수가 소용없다 (장 전체는 무한이어도 절마다 횟수는 쓴다)
      countInput.disabled = kind === "verse" && settings.verseLoop;
    }

    // 다른 화면에서 바꾼 음성·배속도 다시 보일 때 맞춰 둔다
    function refresh(){
      range = null;
      ctrl.notice("");
      closePop();
      syncInputs();
      return loadVoices().then(list => {
        voiceSel.innerHTML = list.map(v =>
          `<option value="${escapeAttr(v.id)}"${v.id === settings.voice ? " selected" : ""}>${escapeAttr(v.name)}</option>`).join("");
        voiceRow.hidden = list.length < 2; // 음성이 하나뿐이면 고를 게 없다
        playBtn.disabled = !list.length;
        if (!list.length) ctrl.notice("음성은 아직 준비 중이에요.");
      });
    }

    function openPop(){
      syncInputs();
      fillRange();
      pop.hidden = false;
      gearBtn.setAttribute("aria-expanded", "true");
      group.classList.add("is-open");
    }
    function closePop(){
      if (pop.hidden) return;
      commitCount();
      pop.hidden = true;
      gearBtn.setAttribute("aria-expanded", "false");
      group.classList.remove("is-open");
    }
    gearBtn.addEventListener("click", () => pop.hidden ? openPop() : closePop());
    // 상자 밖을 누르거나 Esc 를 누르면 닫는다 (Esc 는 상자만 닫고, 장 전체 창까지 닫지는 않게)
    document.addEventListener("pointerdown", e => { if (!pop.hidden && !group.contains(e.target)) closePop(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !pop.hidden){ e.stopPropagation(); closePop(); gearBtn.focus(); }
    }, true);

    playBtn.addEventListener("click", () => {
      closePop();
      if (session && session.ctrl === ctrl){ stop(); return; }
      ctrl.notice("");
      const t = getTarget();
      if (t) start(kind, t.chapter, t.verses.filter(inRange), ctrl, 0);
    });
    voiceSel.addEventListener("change", () => {
      settings.voice = voiceSel.value; save();
      if (session && session.ctrl === ctrl) playCurrent(); // 듣는 중이면 같은 절을 새 음성으로 처음부터
    });
    rateSel.addEventListener("change", () => {
      settings.rate = Number(rateSel.value); save();
      audio.playbackRate = settings.rate; // 듣는 중이면 바로 적용
    });
    // 횟수는 적는 대로 반영하고, 칸을 벗어나거나 상자를 닫을 때 1~99 로 맞춰 다시 보여준다
    function commitCount(){
      settings[repeatKey] = clampRepeat(countInput.value); save();
      countInput.value = String(settings[repeatKey]);
    }
    countInput.addEventListener("input", () => {
      if (countInput.value !== ""){ settings[repeatKey] = clampRepeat(countInput.value); save(); }
    });
    countInput.addEventListener("change", commitCount);
    countInput.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); commitCount(); countInput.blur(); } });
    loopCb.addEventListener("change", () => { settings[loopKey] = loopCb.checked; save(); syncInputs(); });

    refresh();
    return {
      refresh,
      stop(){ closePop(); if (session && session.ctrl === ctrl) stop(); },
      isPlaying(){ return !!(session && session.ctrl === ctrl); },
      // 장 전체 창에서 절을 누르면 그 절부터 읽기 — 고른 범위 안의 절이면 범위 끝까지, 밖이면 장 끝까지
      playFrom(chapter, verses, fromIdx){
        ctrl.notice("");
        const verse = verses[fromIdx];
        const list = inRange(verse) ? verses.filter(inRange) : verses;
        start(kind, chapter, list, ctrl, Math.max(0, list.indexOf(verse)));
      },
    };
  }

  function escapeAttr(s){
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { mount, stopAll: stop };
})();
