/* ===========================================================
   뽑기 — 관리자가 준 기회가 있으면 이름 옆에 뽑기 아이콘이 뜨고,
   누르면 캡슐 기계 창이 열려 기회 하나에 한 번씩 뽑는다.
   무엇이 나올지는 서버(/gacha draw)가 정하고, 기계는 그 공을 꺼내는 모습만 보여준다.
   app.js의 api / getCurrentUser / showAlertModal / showConfirmModal 을 쓴다.
   밖에서 부르는 것: refreshGachaChip() (app.js showView), loadAdminGacha() (관리자 뽑기 탭)
   =========================================================== */
(() => {
const $ = id => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const CONFETTI_COLORS = ["#ff6fae","#3fa9f5","#ffc53d","#a77bf3","#45cc85","#ff9a3c","#2ec9c1","#ff6b6b","#7b8cff","#c3e04a"];
const wait = ms => new Promise(r => setTimeout(r, ms));
// 속성 값에도 넣으므로 따옴표까지 바꾼다
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};

/* ---------- 이름 옆 뽑기 아이콘 ---------- */
let sets = [];     // 뽑기 종류 [{ id, name, items, tokens }]
let curSet = null; // 지금 기계에 들어 있는 뽑기 번호
let tokens = 0;    // 그 뽑기의 남은 기회
let items = [];    // 기계 안의 항목 [{ type, text }]
const curSetObj = () => sets.find(x => x.id === curSet);

// 아이콘 숫자 = 모든 뽑기의 남은 기회를 더한 것
function renderGachaState(){
  const total = sets.reduce((n, x) => n + x.tokens, 0);
  $("gacha-chip-count").textContent = total;
  $("btn-gacha").hidden = total < 1 && $("gacha").hidden;
  const s = curSetObj();
  tokens = s ? s.tokens : 0;
  $("gacha-left").textContent = tokens;
  $("gacha-set-name").textContent = s ? ` - ${s.name}` : "";
  // 기회가 있는 뽑기가 둘 이상이면 고르는 단추를 보여준다
  const choices = sets.filter(x => x.tokens > 0 || x.id === curSet);
  const box = $("gacha-sets");
  box.hidden = choices.length < 2;
  box.innerHTML = choices.map(x => `<button type="button" class="gacha__set-btn${x.id === curSet ? " is-active" : ""}" data-set="${esc(x.id)}">${esc(x.name)} <b>${x.tokens}</b></button>`).join("");
}
// 기계에 넣을 뽑기를 정한다 — 주어진 번호가 없으면 기회가 남은 첫 뽑기
function useSet(id){
  const s = sets.find(x => x.id === id) || sets.find(x => x.tokens > 0) || sets[0];
  curSet = s ? s.id : null;
  const next = s ? s.items : [];
  if (JSON.stringify(next) !== JSON.stringify(items)){ items = next; balls = []; } // 다른 뽑기면 공을 새로 채운다
  renderGachaState();
}
async function refreshGachaChip(){
  if (!getCurrentUser()){ sets = []; useSet(null); return; }
  try {
    sets = (await api("/gacha")).sets;
    // 창이 열려 있으면 보던 뽑기를 그대로, 닫혀 있으면 기회가 남은 뽑기로
    const keep = !$("gacha").hidden && (busy || (curSetObj() && sets.some(x => x.id === curSet && x.tokens > 0)));
    useSet(keep ? curSet : null);
  } catch { /* 아이콘만 못 띄우는 것이라 조용히 넘어간다 */ }
}
$("gacha-sets").addEventListener("click", e => {
  const b = e.target.closest("[data-set]");
  if (!b || busy) return;
  useSet(b.dataset.set);
  syncMachine();
});
window.refreshGachaChip = refreshGachaChip;

/* ---------- 뽑기 창 열고 닫기 ---------- */
const overlay = $("gacha");
let running = false; // 기계 그리기 반복 중인지 (창이 닫혀 있으면 멈춘다)
async function openGacha(){
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  resize();
  syncMachine();
  if (!running){ running = true; last = performance.now(); requestAnimationFrame(frame); }
  await refreshGachaChip();  // 그사이 관리자가 항목이나 기회를 바꿨을 수 있다
  syncMachine();
}
function closeGacha(){
  if (busy) return;
  overlay.hidden = true;
  document.body.style.overflow = "";
  running = false;
  renderGachaState(); // 기회를 다 썼으면 아이콘을 숨긴다
}
$("btn-gacha").addEventListener("click", openGacha);
$("gacha-close").addEventListener("click", closeGacha);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || overlay.hidden) return;
  if (!rv.hidden){ if (rv.classList.contains("done")) closeReveal(); return; }
  closeGacha();
});

// 기계 상태를 남은 기회/항목에 맞춘다
function syncMachine(){
  const btn = $("gacha-pull");
  const ok = tokens > 0 && items.length > 0;
  btn.disabled = busy || !ok;
  btn.classList.toggle("ready", ok && !busy);
  if (!busy){
    $("gacha-msg").textContent = !items.length ? "아직 뽑기 항목이 없어요."
      : tokens > 0 ? "" : "뽑기 기회를 다 썼어요.";
    if (!S) resize();
    buildBalls(!balls.length);
  }
}

/* ---------- 공 물리 ---------- */
const glass = $("gacha-glass"), cv = $("gacha-balls"), ctx = cv.getContext("2d");
let S = 0, R = 0, cx = 0, cy = 0, H = 0, floorY = 0, balls = [], fan = 0, fanTarget = 0, t = 0, scale = 1;
function resize(){
  const s = glass.clientWidth, dpr = Math.min(2, devicePixelRatio || 1);
  if (!s) return;
  const ratio = S ? s / S : 1;
  S = s; cx = cy = S / 2; R = S / 2 - 5; scale = S / 340; H = S * 0.86; floorY = H - 4;
  cv.width = S * dpr; cv.height = S * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const oc = S / ratio / 2;
  balls.forEach(b => { b.x = cx + (b.x - oc) * ratio; b.y = cy + (b.y - oc) * ratio; b.r *= ratio; });
}
new ResizeObserver(() => { if (!overlay.hidden && Math.abs(glass.clientWidth - S) > 1) resize(); }).observe(glass);

// 항목마다 공 색을 하나씩 — 바로 앞의 몇 개와 색상이 겹치지 않게
const colorMap = new Map();
function colorFor(key){
  if (!colorMap.has(key)){
    let h, tries = 0; const used = [...colorMap.values()].slice(-4).map(c => c.h);
    do { h = Math.floor(Math.random() * 360); tries++; } while (tries < 20 && used.some(u => Math.min(Math.abs(u - h), 360 - Math.abs(u - h)) < 35));
    const sat = 72 + Math.floor(Math.random() * 18), lit = 70 + Math.floor(Math.random() * 8);
    colorMap.set(key, { h, css: `hsl(${h} ${sat}% ${lit}%)` });
  }
  return colorMap.get(key).css;
}
const keyOf = (it, i) => `${i}|${it.type}|${it.text}`;
function ballRadius(n){ return R * Math.min(0.17, Math.max(0.05, Math.sqrt(0.24 / Math.max(1, n)))); }
function makeBall(key, it, r, top){
  const a = Math.random() * Math.PI * 2, d = Math.random() * (R - r) * 0.5;
  return { key, text: it.text, type: it.type, color: colorFor(key), r,
    x: top ? cx + (Math.random() < .5 ? -1 : 1) * R * (0.25 + Math.random() * 0.3) : cx + Math.cos(a) * d,
    y: top ? cy - R * 0.35 : cy + Math.abs(Math.sin(a)) * d * 0.5,
    vx: (Math.random() - .5) * 60, vy: 0, ang: Math.random() * 6.28, av: 0, ph: Math.random() * 100 };
}
function buildBalls(initial){
  if (!S) return;
  const r = ballRadius(items.length), pool = balls.slice(), next = [];
  items.forEach((it, i) => {
    const key = keyOf(it, i);
    const k = pool.findIndex(b => b.key === key);
    if (k >= 0){ const b = pool.splice(k, 1)[0]; b.r = r; next.push(b); }
    else next.push(makeBall(key, it, r, !initial));
  });
  balls = next;
  if (initial){ for (let k = 0; k < 420; k++) step(1 / 60); balls.forEach(b => { b.vx = b.vy = b.av = 0; }); }
  else wake(2200);
}
// 공은 뽑는 동안이나, 새 공이 자리 잡는 잠깐 동안만 움직인다
let awakeUntil = 0;
function wake(ms){ awakeUntil = Math.max(awakeUntil, performance.now() + ms); }
const holeHalf = () => (balls[0] ? balls[0].r : R * .1) * 1.25;
function step(dt){
  fan += (fanTarget - fan) * Math.min(1, dt * 3.5);
  const g = 1500 * scale;
  for (const b of balls){
    if (b.out) continue;
    b.vy += g * dt * (b.sink ? 1.6 : 1);
    if (fan > 0.02){
      // 아래에서 밀어 올리는 바람 + 옆으로 도는 소용돌이 + 불규칙한 돌풍
      const dx = (b.x - cx) / R, dy = (b.y - cy) / R;
      const n1 = Math.sin(t * 3.1 + b.ph) + Math.sin(t * 5.3 + b.ph * 1.7);
      const lift = (2600 + 1300 * n1) * scale * (0.6 + Math.max(0, dy) * 1.1);
      const swirl = 1700 * scale;
      b.vx += (-dy * swirl + n1 * 700 * scale + (Math.random() - .5) * 1800 * scale) * fan * dt;
      b.vy += (-lift + dx * swirl * 0.6 + (Math.random() - .5) * 1400 * scale) * fan * dt;
    }
    if (b.fall || b.sink){ // 뽑힌 공은 바닥 가운데 출구 쪽으로 모인다
      const pull = Math.min(1, Math.max(0, (b.y - (floorY - R * 0.5)) / (R * 0.4)));
      b.vx += (cx - b.x) * 500 * pull * dt; b.vx *= 1 - 0.12 * pull;
    }
    const damp = fan > 0.05 ? 0.995 : (busy ? 0.985 : 0.96);
    b.vx *= damp; b.vy *= damp;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  for (let it = 0; it < 3; it++){
    for (let i = 0; i < balls.length; i++){ const a = balls[i]; if (a.out || a.gone) continue;
      for (let j = i + 1; j < balls.length; j++){ const b = balls[j]; if (b.out || b.gone) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.0001){
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, o = (min - d) / 2;
          // 뽑힌 공은 위에 있는 공들에게 밀려 올라가지 않는다
          const wa = (a.fall || a.sink) ? 0.15 : 1, wb = (b.fall || b.sink) ? 0.15 : 1, ws = wa + wb;
          a.x -= nx * o * 2 * wa / ws; a.y -= ny * o * 2 * wa / ws; b.x += nx * o * 2 * wb / ws; b.y += ny * o * 2 * wb / ws;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0){ const e = fan > 0.1 ? 0.85 : 0.35, jimp = -(1 + e) * rv / 2;
            a.vx -= jimp * nx * 2 * wa / ws; a.vy -= jimp * ny * 2 * wa / ws; b.vx += jimp * nx * 2 * wb / ws; b.vy += jimp * ny * 2 * wb / ws;
            a.av += (b.vy - a.vy) * 0.002; b.av -= (b.vy - a.vy) * 0.002; }
        }
      }
      const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy), max = R - a.r;
      const e = fan > 0.1 ? 0.9 : 0.3;
      if (d > max){ const nx = dx / d, ny = dy / d; a.x = cx + nx * max; a.y = cy + ny * max;
        const vn = a.vx * nx + a.vy * ny; if (vn > 0){ a.vx -= (1 + e) * vn * nx; a.vy -= (1 + e) * vn * ny; }
        a.av += (a.vx * -ny + a.vy * nx) / a.r * 0.02; }
      const inHole = a.fall && Math.abs(a.x - cx) < holeHalf();
      if (!inHole && !a.gone && a.y > floorY - a.r){ a.y = floorY - a.r; if (a.vy > 0) a.vy *= -e; a.vx *= 0.98; }
    }
  }
  for (const b of balls){
    if (b.fall && b.y > floorY - b.r * 0.2) b.gone = true;   // 출구로 들어간 공은 다른 공과 부딪히지 않는다
    if (b.fall && b.y > floorY + b.r * 1.1) b.out = true;
    if (b.gone) b.vx *= 0.5;
    b.av = b.av * 0.96 + (b.vx / b.r) * 0.04; b.ang += b.av * dt;
  }
}
function drawHole(){
  const hh = holeHalf();
  ctx.save();
  ctx.fillStyle = "rgba(245,215,185,.55)"; ctx.fillRect(0, floorY, S, S - floorY);
  ctx.fillStyle = "rgba(190,110,40,.75)";
  ctx.beginPath(); ctx.ellipse(cx, floorY, hh, hh * 0.22, 0, 0, 6.283); ctx.fill(); ctx.restore();
}
function drawBall(b){
  ctx.save(); ctx.translate(b.x, b.y);
  if (b.chosen){ const p = 0.5 + 0.5 * Math.sin(t * 14); ctx.beginPath(); ctx.arc(0, 0, b.r + 5 + p * 4, 0, 6.283);
    ctx.fillStyle = "rgba(255,240,170," + (0.45 + p * 0.35) + ")"; ctx.fill(); }
  ctx.rotate(b.ang);
  ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 6.283); ctx.save(); ctx.clip();
  ctx.fillStyle = "rgba(255,252,253,.88)"; ctx.fillRect(-b.r, -b.r, b.r * 2, b.r * 2);
  ctx.fillStyle = b.color; ctx.globalAlpha = 0.82; ctx.fillRect(-b.r, -b.r, b.r * 2, b.r * 1.03);
  ctx.globalAlpha = 0.35; ctx.fillRect(-b.r, b.r * 0.03, b.r * 2, b.r);   // 아래 반쪽은 옅게 비치는 색
  ctx.globalAlpha = 1; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(-b.r, -1, b.r * 2, 2);
  ctx.restore(); ctx.restore();
  ctx.save(); ctx.translate(b.x, b.y);
  const g = ctx.createRadialGradient(-b.r * .35, -b.r * .42, b.r * .05, 0, 0, b.r);
  g.addColorStop(0, "rgba(255,255,255,.85)"); g.addColorStop(.3, "rgba(255,255,255,.12)"); g.addColorStop(.85, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(140,80,100,.18)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 6.283); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}
function drawWind(){
  if (fan < 0.05) return;
  ctx.save(); ctx.lineCap = "round";
  for (let k = 0; k < 6; k++){
    const rr = R * (0.25 + k * 0.1), a0 = t * (3 + k * 0.4) * (k % 2 ? -1 : 1) + k * 1.3, oy = cy + R * 0.08;
    ctx.strokeStyle = "rgba(120,190,255," + (0.4 * fan) + ")"; ctx.lineWidth = (3 + k * 0.4) * scale;
    ctx.beginPath(); ctx.arc(cx, oy, rr, a0, a0 + 1.1); ctx.stroke();
    const ax = cx + Math.cos(a0 + 1.1) * rr, ay = oy + Math.sin(a0 + 1.1) * rr, dir = (k % 2 ? -1 : 1);
    const ta = a0 + 1.1 + dir * Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(ax + Math.cos(ta - 2.5) * 10 * scale, ay + Math.sin(ta - 2.5) * 10 * scale); ctx.lineTo(ax, ay);
    ctx.lineTo(ax + Math.cos(ta + 2.5) * 10 * scale, ay + Math.sin(ta + 2.5) * 10 * scale); ctx.stroke();
  }
  ctx.restore();
}
let last = performance.now();
function frame(now){
  if (!running) return;
  const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
  if (!rv.hidden && rv.classList.contains("show")){ requestAnimationFrame(frame); return; } // 결과 창에 가려져 있을 때는 쉰다
  if (busy || now < awakeUntil){ step(dt / 2); step(dt / 2); }
  else balls.forEach(b => { b.vx = b.vy = b.av = 0; });
  ctx.clearRect(0, 0, S, S);
  drawHole();
  balls.filter(b => !b.out && !b.chosen).concat(balls.filter(b => b.chosen && !b.out)).forEach(drawBall);
  drawWind();
  requestAnimationFrame(frame);
}

/* ---------- 소리 ---------- */
let ac = null, muted = store.get("gacha.muted") === "1";
function updMute(){ $("gacha-mute").textContent = muted ? "🔇 소리 꺼짐" : "🔊 소리 켜짐"; $("gacha-mute").setAttribute("aria-pressed", muted); }
updMute();
$("gacha-mute").addEventListener("click", () => { muted = !muted; store.set("gacha.muted", muted ? "1" : "0"); updMute(); });
function audio(){ if (muted) return null; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); return ac; } catch { return null; } }
function wind(dur){
  const a = audio(); if (!a) return;
  const len = a.sampleRate * dur, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.8;
  f.frequency.setValueAtTime(300, a.currentTime); f.frequency.linearRampToValueAtTime(900, a.currentTime + dur * 0.4); f.frequency.linearRampToValueAtTime(250, a.currentTime + dur);
  const g = a.createGain(); g.gain.setValueAtTime(0, a.currentTime); g.gain.linearRampToValueAtTime(0.28, a.currentTime + 0.4);
  g.gain.setValueAtTime(0.28, a.currentTime + dur - 0.6); g.gain.linearRampToValueAtTime(0, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination); src.start();
  for (let i = 0; i < Math.floor(dur * 14); i++) tick(Math.random() * (dur - 0.5) + 0.2, 0.05); // 공 부딪히는 소리
}
function tick(at, vol){
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + at;
  o.type = "triangle"; o.frequency.value = 1800 + Math.random() * 1600;
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.06);
}
function clunk(){
  const a = audio(); if (!a) return; const t0 = a.currentTime;
  [0, 0.18, 0.3].forEach((dl, i) => { const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(220 - i * 30, t0 + dl); o.frequency.exponentialRampToValueAtTime(80, t0 + dl + 0.12);
    g.gain.setValueAtTime(0.35 / (i + 1), t0 + dl); g.gain.exponentialRampToValueAtTime(0.001, t0 + dl + 0.15);
    o.connect(g).connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + 0.16); });
}
function popSnd(){
  const a = audio(); if (!a) return; const t0 = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(400, t0); o.frequency.exponentialRampToValueAtTime(1200, t0 + 0.08);
  g.gain.setValueAtTime(0.3, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.13);
}
function thunder(){
  const a = audio(); if (!a) return; const t0 = a.currentTime, dur = 2.4;
  const len = a.sampleRate * dur, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++){ const k = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 1.6) * (k < 0.02 ? k / 0.02 : 1); }
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(2500, t0); f.frequency.exponentialRampToValueAtTime(180, t0 + 0.6);
  const g = a.createGain(); g.gain.value = 0.7;
  src.connect(f).connect(g).connect(a.destination); src.start(t0);
}
function doomHits(){   // "둥! 둥! 둥~"
  const a = audio(); if (!a) return; const t0 = a.currentTime + 0.05;
  [[110, 0, .22], [104, .28, .22], [82, .56, .9]].forEach(([f, dl, dur]) => {
    [1, 1.5, 2].forEach((m, j) => { const o = a.createOscillator(), g = a.createGain(); o.type = j ? "sawtooth" : "square";
      o.frequency.setValueAtTime(f * m, t0 + dl); o.frequency.exponentialRampToValueAtTime(f * m * 0.94, t0 + dl + dur);
      const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const v = j ? 0.05 : 0.12; g.gain.setValueAtTime(0, t0 + dl); g.gain.linearRampToValueAtTime(v, t0 + dl + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t0 + dl + dur);
      o.connect(lp).connect(g).connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + dur + 0.02); });
  });
}
function sadTrombone(){
  const a = audio(); if (!a) return; const t0 = a.currentTime;
  [[392, 0, .32], [370, .34, .32], [349, .68, .32], [330, 1.02, .9]].forEach(([f, dl, dur], i) => {
    const o = a.createOscillator(), g = a.createGain(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, t0 + dl);
    if (i === 3){ const l = a.createOscillator(), lg = a.createGain(); l.frequency.value = 6; lg.gain.value = 8; l.connect(lg).connect(o.frequency); l.start(t0 + dl); l.stop(t0 + dl + dur); }
    const flt = a.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 1200;
    g.gain.setValueAtTime(0, t0 + dl); g.gain.linearRampToValueAtTime(0.09, t0 + dl + 0.03); g.gain.setValueAtTime(0.09, t0 + dl + dur - 0.08); g.gain.linearRampToValueAtTime(0, t0 + dl + dur);
    o.connect(flt).connect(g).connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + dur + 0.02); });
}
function fanfare(){
  const a = audio(); if (!a) return; const t0 = a.currentTime;
  const notes = [[523.25, 0], [659.25, .1], [783.99, .2], [1046.5, .32], [783.99, .5], [1046.5, .6]];
  notes.forEach(([f, dl], i) => { const o = a.createOscillator(), g = a.createGain(); o.type = i % 2 ? "triangle" : "square";
    o.frequency.value = f; const dur = i === notes.length - 1 ? 0.7 : 0.16;
    g.gain.setValueAtTime(0, t0 + dl); g.gain.linearRampToValueAtTime(0.12, t0 + dl + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dl + dur);
    o.connect(g).connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + dur + 0.02); });
}

/* ---------- 뽑기 ---------- */
let busy = false;
// 공 섞기 — 기회를 쓰지 않고 바람만 잠깐 불어 공을 섞는다
let mixing = false;
async function mixBalls(){
  if (busy || mixing || !balls.length) return;
  mixing = true; $("gacha-mix").disabled = true;
  const ms = reduce ? 900 : 1600;
  $("gacha-vent").classList.add("on");
  fanTarget = 1; wake(ms + 3000); wind(ms / 1000 + 0.3);
  await wait(ms);
  fanTarget = 0; $("gacha-vent").classList.remove("on");
  await wait(600);
  mixing = false; $("gacha-mix").disabled = false;
}
$("gacha-mix").addEventListener("click", mixBalls);

async function pull(){
  if (busy || mixing || tokens < 1 || !items.length) return;
  const btn = $("gacha-pull");
  busy = true; btn.disabled = true; btn.classList.remove("ready"); $("gacha-mix").disabled = true;
  btn.classList.add("press"); setTimeout(() => btn.classList.remove("press"), 150);

  // 기회를 먼저 쓰고 결과를 받는다 — 창을 닫거나 새로고침해도 다시 뽑을 수 없게
  let res;
  try { res = await api("/gacha", { method: "POST", body: { action: "draw", set: curSet } }); }
  catch (err){ busy = false; $("gacha-mix").disabled = false; showAlertModal(err.message); await refreshGachaChip(); syncMachine(); return; }
  const s = curSetObj();
  if (s){ s.tokens = res.tokens; s.items = res.items; }
  renderGachaState();
  if (JSON.stringify(res.items) !== JSON.stringify(items)){ items = res.items; buildBalls(!balls.length); }
  const key = keyOf(res.item, res.index);
  let ball = balls.find(b => b.key === key);
  if (!ball){ items = res.items; resize(); buildBalls(true); ball = balls.find(b => b.key === key); }
  if (!ball){ // 기계를 그릴 수 없는 상태여도 이미 쓴 기회의 결과는 꼭 보여준다
    openReveal({ key, text: res.item.text, type: res.item.type, color: colorFor(key), detached: true });
    return;
  }

  $("gacha-mini").className = "gc-mini";
  const mixMs = reduce ? 1300 : 2800;
  $("gacha-msg").textContent = "바람이 공을 섞는 중…";
  $("gacha-vent").classList.add("on");
  fanTarget = 1; wind(mixMs / 1000 + 0.4);
  await wait(mixMs);
  fanTarget = 0; $("gacha-vent").classList.remove("on");
  ball.sink = true; // 바람이 멈추면 뽑힌 공이 출구 위로 내려앉는다
  $("gacha-msg").textContent = "공이 내려앉는 중…";
  await wait(1600);

  $("gacha-msg").textContent = "출구가 열렸어요…";
  btn.classList.add("press"); tick(0, 0.25); tick(0.12, 0.25);
  setTimeout(() => btn.classList.remove("press"), 250);
  ball.sink = false; ball.fall = true; ball.chosen = true;
  const t0 = performance.now();
  while (!ball.out && performance.now() - t0 < 3000) await wait(40);
  ball.out = true; // 3초 안에 못 빠져나왔어도 나온 것으로
  balls = balls.filter(b => b !== ball);
  const mini = $("gacha-mini"); mini.style.setProperty("--c", ball.color); void mini.offsetWidth; mini.className = "gc-mini drop";
  clunk(); $("gacha-msg").textContent = "공이 나왔어요!";
  await wait(800);
  openReveal(ball);
}
$("gacha-pull").addEventListener("click", pull);

/* ---------- 결과 공개 ---------- */
const rv = $("gacha-reveal"), cap = $("gacha-bigcap"), paper = $("gacha-paper"), ptext = $("gacha-ptext"), stamp = $("gacha-stamp");
let current = null;
async function openReveal(ball){
  current = ball;
  const pen = ball.type === "pen";
  cap.style.setProperty("--c", ball.color); cap.className = "gc-bigcap";
  paper.className = "gc-paper" + (pen ? " pen" : ""); ptext.className = "gc-ptext"; stamp.className = "gc-stamp"; stamp.textContent = pen ? "벌칙" : "당첨";
  ptext.textContent = ball.text;
  $("gacha-again").hidden = tokens < 1;
  // 종이가 펼쳐지기 전까지는 당첨인지 벌칙인지 알 수 없게
  rv.className = "gc-reveal gc-scope"; rv.hidden = false; void rv.offsetWidth; rv.classList.add("show");
  await wait(420); cap.classList.add("wiggle"); tick(0, 0.2); tick(0.15, 0.2);
  await wait(560);
  cap.classList.add("split"); const fl = $("gacha-flash"); fl.className = "gc-flash"; void fl.offsetWidth; fl.className = "gc-flash go"; popSnd();
  await wait(120); paper.classList.add("unroll");
  fitResultText(ball.text);
  await wait(720);
  if (pen) rv.classList.add("pen");
  rv.classList.add("rays-on");
  ptext.classList.add("pop");
  if (pen){
    stamp.classList.add("slam");
    thunder(); doomHits(); rv.classList.add("thunder"); penaltyBurst();
    setTimeout(() => paper.classList.add("shake"), 250);
    setTimeout(sadTrombone, 1150);
  } else { stamp.classList.add("hit"); fanfare(); confetti(); }
  await wait(250); rv.classList.add("done");
  ($("gacha-again").hidden ? $("gacha-reveal-close") : $("gacha-again")).focus();
}
// 결과지 글자 크기 — 종이 폭에 맞춰 정한다 (폰처럼 좁으면 작게).
// 줄은 띄어쓰기에서만 바뀌고(낱말 중간에서 끊지 않음), 가장 긴 낱말도 한 줄에 들어가고 종이 높이를 넘지 않을 때까지 줄인다
function fitResultText(text){
  const w = paper.clientWidth - 60, maxH = paper.parentElement.clientHeight - 200;
  const len = [...text].length;
  const byLength = len <= 4 ? 3.2 : len <= 8 ? 4.5 : len <= 14 ? 6 : len <= 24 ? 7.5 : 9; // 글이 길수록 작게
  const cap = len <= 4 ? 112 : len <= 8 ? 88 : len <= 14 ? 68 : len <= 24 ? 52 : 40;    // 넓은 화면에서도 이보다 크지 않게
  let fsz = Math.round(Math.min(cap, w / byLength));
  ptext.style.fontSize = fsz + "px";
  while (fsz > 18 && (ptext.scrollWidth > ptext.clientWidth + 1 || ptext.scrollHeight > maxH)){ fsz -= 2; ptext.style.fontSize = fsz + "px"; }
}
function closeReveal(){
  rv.classList.remove("show", "done", "rays-on", "thunder", "pen");
  setTimeout(() => { rv.hidden = true; stopConfetti(); }, 250);
  if (current && !current.detached){ // 뽑힌 공은 위에서 다시 기계 안으로 들어간다
    Object.assign(current, { fall: false, sink: false, gone: false, out: false, chosen: false,
      x: cx + (Math.random() - .5) * R * 0.4, y: cy - R * 0.6, vx: (Math.random() - .5) * 80, vy: 0 });
    balls.push(current); wake(2200);
  }
  busy = false; current = null; $("gacha-mix").disabled = false;
  $("gacha-mini").className = "gc-mini";
  syncMachine();
}
$("gacha-reveal-close").addEventListener("click", () => { closeReveal(); $("gacha-pull").focus(); });
$("gacha-again").addEventListener("click", () => { closeReveal(); setTimeout(() => { if (!$("gacha-pull").disabled) pull(); }, 350); });

/* ---------- 꽃가루 (당첨) / 이모지 (벌칙) ---------- */
const cc = $("gacha-confetti"), cctx = cc.getContext("2d"); let parts = [], craf = 0, cend = 0;
function burstAll(make, n){
  const dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  cc.width = w * dpr; cc.height = h * dpr; cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  parts = [];
  const burst = (x, y, ang, spread, count, speed) => { for (let i = 0; i < count; i++){ const a = ang + (Math.random() - .5) * spread, s = speed * (0.5 + Math.random() * 0.7);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: Math.random() * 6, ...make() }); } };
  burst(w / 2, h * 0.42, -Math.PI / 2, Math.PI * 2, n * 0.5, 900);
  burst(0, h, -Math.PI / 3, 0.6, n * 0.25, 1300);
  burst(w, h, -Math.PI * 2 / 3, 0.6, n * 0.25, 1300);
  cend = performance.now() + 4200; cancelAnimationFrame(craf); let lt = performance.now();
  const loop = now => { const dt = Math.min(0.033, (now - lt) / 1000); lt = now; cctx.clearRect(0, 0, w, h);
    for (const p of parts){
      if (p.y > h + 60) continue; // 화면 밖으로 떨어진 조각은 그만 그린다
      p.vy += 1400 * dt; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.r);
      if (p.e){ cctx.drawImage(p.e, -p.s / 2, -p.s / 2, p.s, p.s); }
      else { cctx.fillStyle = p.c;
        if (p.round){ cctx.beginPath(); cctx.arc(0, 0, p.w / 2, 0, 6.283); cctx.fill(); }
        else { cctx.scale(1, Math.cos(p.r * 2)); cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); } }
      cctx.restore(); }
    if (now < cend) craf = requestAnimationFrame(loop); else cctx.clearRect(0, 0, w, h); };
  craf = requestAnimationFrame(loop);
}
function confetti(){
  burstAll(() => ({ w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, vr: (Math.random() - .5) * 14,
    c: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)], round: Math.random() < .3 }), reduce ? 40 : 170);
}
const EMOJI_SPRITES = [];
function emojiSprites(){
  if (EMOJI_SPRITES.length) return EMOJI_SPRITES;
  const px = 64 * Math.min(2, devicePixelRatio || 1);
  ["😫","😭","😱","😵","👻","🤡"].forEach(e => {
    const c = document.createElement("canvas"); c.width = c.height = px;
    const x = c.getContext("2d");
    x.font = `${px * 0.82}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(e, px / 2, px / 2 + px * 0.04);
    EMOJI_SPRITES.push(c);
  });
  return EMOJI_SPRITES;
}
function penaltyBurst(){
  const sprites = emojiSprites();
  burstAll(() => ({ vr: (Math.random() - .5) * 10, s: 28 + Math.random() * 20, e: sprites[Math.floor(Math.random() * sprites.length)] }), reduce ? 20 : 44);
}
function stopConfetti(){ cancelAnimationFrame(craf); cctx.clearRect(0, 0, cc.width, cc.height); }

/* ===========================================================
   관리자: 뽑기 탭
   =========================================================== */
let adminSets = [], adminSet = null, adminItems = [], adminUsers = [], adminTokens = {};
async function loadAdminGacha(){
  const tokensEl = $("gacha-tokens");
  tokensEl.innerHTML = `<p class="form-note">불러오는 중…</p>`;
  let d;
  try { d = await api("/gacha?admin=1"); }
  catch (err){ tokensEl.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  adminSets = d.sets; adminUsers = d.users; adminTokens = d.tokens;
  selectAdminSet(adminSets.some(x => x.id === adminSet) ? adminSet : adminSets[0].id);
  renderAdminLog(d.log);
}
window.loadAdminGacha = loadAdminGacha;

// 뽑기 종류 단추 + 고른 뽑기의 이름·항목·기회
function selectAdminSet(id){
  adminSet = id;
  const s = adminSets.find(x => x.id === id);
  adminItems = s.items;
  $("gacha-admin-sets").innerHTML = adminSets.map(x =>
    `<button type="button" role="tab" aria-selected="${x.id === id}" class="gacha-set-chip${x.id === id ? " is-active" : ""}" data-set="${esc(x.id)}"${x.id === id ? ` title="눌러서 이름 바꾸기"` : ""}>${esc(x.name)}</button>`).join("")
    + `<button type="button" class="gacha-set-chip gacha-set-chip--add" id="btn-gacha-set-add" aria-label="새 뽑기 만들기">＋</button>`;
  $("btn-gacha-set-delete").hidden = adminSets.length < 2;
  document.querySelectorAll(".gacha-cur-set").forEach(el => el.textContent = s.name);
  renderAdminItems();
  renderAdminTokens(adminUsers, adminTokens[id] || {});
}
// 뽑기 추가·이름 바꾸기·삭제·항목·기회 저장은 화면을 먼저 바꾸고, 서버에는 뒤에서 하나씩 차례로 보낸다
// (새 뽑기를 만들자마자 이름이나 항목을 넣어도, 만들기 요청이 끝난 뒤에 보내진다)
let setOps = Promise.resolve();
function queueSetOp(fn){
  const p = setOps.then(fn);
  setOps = p.catch(() => {});
  return p;
}
// 저장이 실패하면 서버에 있는 그대로 다시 불러온다
function setOpFailed(err){ showAlertModal(err.message); loadAdminGacha(); }

$("gacha-admin-sets").addEventListener("click", e => {
  if (e.target.closest("#btn-gacha-set-add")){
    const id = String(Math.max(0, ...adminSets.map(x => parseInt(x.id, 10) || 0)) + 1);
    const set = { id, name: `새 뽑기 ${adminSets.length + 1}`, items: [] };
    adminSets.push(set);
    selectAdminSet(id);
    startRenameAdminSet(); // 바로 이름을 바꿀 수 있게
    queueSetOp(() => api("/gacha", { method: "POST", body: { action: "addSet", id, name: set.name } })).catch(setOpFailed);
    return;
  }
  const b = e.target.closest("[data-set]");
  if (!b) return;
  if (b.dataset.set === adminSet) startRenameAdminSet(); // 고른 탭을 또 누르면 이름 고치기
  else selectAdminSet(b.dataset.set);
});
// 고른 탭이 그 자리에서 입력칸으로 바뀐다 — Enter나 다른 곳을 누르면 저장, Esc는 되돌리기
function startRenameAdminSet(){
  const tab = document.querySelector("#gacha-admin-sets .gacha-set-chip.is-active");
  const s = adminSets.find(x => x.id === adminSet);
  if (!tab || !s) return;
  const input = document.createElement("input");
  input.type = "text"; input.maxLength = 20; input.value = s.name;
  input.className = "gacha-set-chip gacha-set-chip--edit is-active";
  input.setAttribute("aria-label", "뽑기 이름");
  input.style.width = `${Math.max(4, [...s.name].length + 2)}em`;
  input.addEventListener("input", () => { input.style.width = `${Math.max(4, [...input.value].length + 2)}em`; });
  let cancelled = false;
  input.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); input.blur(); }
    if (e.key === "Escape"){ cancelled = true; input.blur(); }
  });
  input.addEventListener("blur", () => saveAdminSetName(cancelled ? s.name : input.value), { once: true });
  tab.replaceWith(input);
  input.focus(); input.select();
}
function saveAdminSetName(value){
  const s = adminSets.find(x => x.id === adminSet);
  const name = String(value || "").trim();
  if (!s || !name || name === s.name){ if (s) selectAdminSet(s.id); return; }
  s.name = name;
  selectAdminSet(adminSet);
  queueSetOp(() => api("/gacha", { method: "POST", body: { action: "renameSet", set: s.id, name } }))
    .then(() => flashSetStatus("이름 저장됨"), setOpFailed);
}
let setStatusTimer = 0;
function flashSetStatus(text){
  $("gacha-set-status").textContent = text;
  clearTimeout(setStatusTimer);
  setStatusTimer = setTimeout(() => { $("gacha-set-status").textContent = ""; }, 1500);
}
$("btn-gacha-set-delete").addEventListener("click", async () => {
  const s = adminSets.find(x => x.id === adminSet);
  if (!(await showConfirmModal(`"${s.name}" 뽑기를 삭제할까요?\n항목과 회원들의 남은 기회도 함께 지워져요.`, "삭제"))) return;
  adminSets = adminSets.filter(x => x !== s);
  delete adminTokens[s.id];
  selectAdminSet(adminSets[0].id);
  queueSetOp(() => api("/gacha", { method: "POST", body: { action: "deleteSet", set: s.id } }))
    .then(() => refreshGachaChip(), setOpFailed);
});

function renderAdminItems(){
  const el = $("gacha-items");
  el.innerHTML = adminItems.map((it, i) => `
    <li><span class="gacha-tag${it.type === "pen" ? " is-pen" : ""}">${it.type === "pen" ? "벌칙" : "당첨"}</span>${esc(it.text)}
      <button type="button" data-i="${i}" aria-label="${esc(it.text)} 지우기">×</button></li>`).join("");
  const win = adminItems.filter(it => it.type !== "pen").length;
  $("gacha-items-status").textContent = adminItems.length
    ? `모두 ${adminItems.length}개 (당첨 ${win} · 벌칙 ${adminItems.length - win})` : "아직 항목이 없어요. 항목이 있어야 뽑을 수 있어요.";
}
async function saveAdminItems(next){
  const prev = adminItems, set = adminSets.find(x => x.id === adminSet);
  adminItems = set.items = next; renderAdminItems();
  try {
    set.items = (await queueSetOp(() => api("/gacha", { method: "POST", body: { action: "setItems", set: set.id, items: next } }))).items;
    if (adminSet === set.id){ adminItems = set.items; renderAdminItems(); } // 그사이 다른 뽑기로 옮겼으면 화면은 그대로
  } catch (err){ set.items = prev; if (adminSet === set.id){ adminItems = prev; renderAdminItems(); } showAlertModal(err.message); }
}
$("gacha-add-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("gacha-new-item");
  const add = input.value.split(",").map(s => s.trim()).filter(Boolean);
  if (!add.length){ input.focus(); return; }
  const type = document.querySelector("input[name=gacha-kind]:checked").value;
  input.value = "";
  // 당첨은 당첨끼리, 벌칙은 벌칙끼리 이어서 — 늘 당첨 묶음 뒤에 벌칙 묶음
  const added = add.map(text => ({ type, text }));
  const wins = adminItems.filter(it => it.type !== "pen"), pens = adminItems.filter(it => it.type === "pen");
  saveAdminItems(type === "pen" ? [...wins, ...pens, ...added] : [...wins, ...added, ...pens]);
  input.focus();
});
$("gacha-items").addEventListener("click", e => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  saveAdminItems(adminItems.filter((_, i) => i !== Number(b.dataset.i)));
});

function renderAdminTokens(users, tokenMap){
  const el = $("gacha-tokens");
  el.innerHTML = users.map(u => {
    const n = tokenMap[u.name] || 0;
    return `
      <div class="gacha-token-row${n > 0 ? " has-tokens" : ""}" data-name="${esc(u.name)}">
        <span class="gacha-token-row__name">${esc(u.name)}${u.nickname ? ` <small>${esc(u.nickname)}</small>` : ""}</span>
        <button type="button" class="gacha-step" data-d="-1" aria-label="${esc(u.name)} 뽑기 기회 줄이기"${n < 1 ? " disabled" : ""}>−</button>
        <span class="gacha-token-row__count">${n}</span>
        <button type="button" class="gacha-step" data-d="1" aria-label="${esc(u.name)} 뽑기 기회 주기">＋</button>
      </div>`;
  }).join("") || `<p class="form-note">회원이 없어요.</p>`;
}
$("gacha-tokens").addEventListener("click", async e => {
  const b = e.target.closest(".gacha-step"); if (!b) return;
  const row = b.closest(".gacha-token-row"), countEl = row.querySelector(".gacha-token-row__count");
  const prev = Number(countEl.textContent), next = Math.max(0, Math.min(99, prev + Number(b.dataset.d)));
  if (next === prev) return;
  const set = adminSet, map = adminTokens[set] = adminTokens[set] || {};
  const setRow = n => { map[row.dataset.name] = n; countEl.textContent = n; row.querySelector('[data-d="-1"]').disabled = n < 1; row.classList.toggle("has-tokens", n > 0); };
  setRow(next);
  // 빠르게 여러 번 눌러도 요청이 앞뒤가 바뀌거나 겹치지 않게, 회원마다 하나씩 차례로 보낸다
  const send = () => setOps.then(() => api("/gacha", { method: "POST", body: { action: "setTokens", set, name: row.dataset.name, count: next } }));
  row._queue = (row._queue || Promise.resolve()).then(send, send);
  try {
    await row._queue;
    if (row.dataset.name === (getCurrentUser() || {}).name) refreshGachaChip(); // 관리자 본인에게 준 경우 바로 아이콘 표시
  } catch (err){ setRow(prev); showAlertModal(err.message); }
});

function renderAdminLog(log){
  const fmt = iso => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  $("gacha-log").innerHTML = log.map(l => `
    <li data-name="${esc(l.name)}" data-at="${esc(l.at)}"><time>${fmt(l.at)}</time><b>${esc(l.name)}</b><span class="gacha-log__item">${l.setName ? `<small class="gacha-log__set">${esc(l.setName)}</small> ` : ""}<span class="gacha-tag${l.type === "pen" ? " is-pen" : ""}">${l.type === "pen" ? "벌칙" : "당첨"}</span> ${esc(l.text)}</span>
      <button type="button" class="gacha-log__del" aria-label="이 기록 지우기">×</button></li>`).join("")
    || `<li class="form-note">아직 뽑은 기록이 없어요.</li>`;
}
$("gacha-log").addEventListener("click", async e => {
  const b = e.target.closest(".gacha-log__del"); if (!b) return;
  const li = b.closest("li");
  if (!(await showConfirmModal("이 기록을 지울까요?", "지우기"))) return;
  b.disabled = true;
  try {
    await api("/gacha", { method: "POST", body: { action: "deleteLog", name: li.dataset.name, at: li.dataset.at } });
    li.remove();
    if (!$("gacha-log").children.length) $("gacha-log").innerHTML = `<li class="form-note">아직 뽑은 기록이 없어요.</li>`;
  } catch (err){ b.disabled = false; showAlertModal(err.message); }
});

refreshGachaChip(); // 첫 화면 (app.js의 showView는 이 파일보다 먼저 실행됨)
})();
