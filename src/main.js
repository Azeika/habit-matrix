import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { initLife, lifeRoute, setUser as lifeSetUser, LIFE_VIEWS, exportData as lifeExport, importData as lifeImport } from './life.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, deleteField, writeBatch } from 'firebase/firestore';

const LS = 'habit-matrix-v1';
const DEFAULTS = ['Wake up at 06:00','Meditation','Gym','Cold shower','Deep work','Read 10 pages','Learn a skill','Sleep before 23:00'];
const ACCENTS = [
  {id:'red', name:'Nothing red', c:'#d71921', ink:'#fff'},
  {id:'orange', name:'CMF orange', c:'#ff5b1f', ink:'#fff'},
  {id:'green', name:'Light green', c:'#b8e986', ink:'#0b0b0b'},
  {id:'white', name:'Mono', c:'#f5f5f5', ink:'#0b0b0b'}
];
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const key = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => 'h'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const isDesk = () => matchMedia('(min-width:900px)').matches;

function normalize(d){
  const habits = Array.isArray(d && d.habits) ? d.habits.filter(h=>h&&h.id).map(h=>({id:String(h.id), name:String(h.name||'Habit')})) : DEFAULTS.map((n,i)=>({id:'d'+i,name:n}));
  const log = {};
  if (d && d.log && typeof d.log==='object') for (const k in d.log) { const v = d.log[k]; if (v && typeof v==='object') { const o={}; for (const h in v) if (v[h]) o[h]=1; if (Object.keys(o).length) log[k]=o; } }
  const accent = ACCENTS.some(a=>a.id===(d&&d.accent)) ? d.accent : 'red';
  const journal = {};
  if (d && d.journal && typeof d.journal==='object') for (const k in d.journal) { const j = d.journal[k]; if (j && typeof j==='object') journal[k] = {plan:String(j.plan||''), review:String(j.review||''), done:Array.isArray(j.done)?j.done.map(String):[]}; }
  return {habits, log, accent, journal};
}
let state;
try { state = normalize(JSON.parse(localStorage.getItem(LS))); } catch(e) { state = normalize(null); }
const saveLocal = () => { try { localStorage.setItem(LS, JSON.stringify(state)); } catch(e) {} };

let now = new Date();
let view = new Date(now.getFullYear(), now.getMonth(), 1);
let lastDeleted = null, toastT = null, trendData = [], toastUndo = null;
function showToast(msg, undo){
  toastUndo = undo || null;
  $('toastMsg').textContent = msg; $('undo').hidden = !undo; $('toast').hidden = false;
  clearTimeout(toastT); toastT = setTimeout(()=>{ $('toast').hidden = true; toastUndo = null; lastDeleted = null; }, undo ? 6000 : 2500);
}

/* ---------- Cloud layer (Firebase) ---------- */
let fs = null, auth = null, user = null, userRef = null, unsubs = [], pendingWrites = false;
const cloudOn = () => !!(fs && user);

function writeDay(k, h, on){
  if (!cloudOn()) return;
  setDoc(doc(userRef, 'days', k), {[h]: on ? true : deleteField()}, {merge:true}).catch(err => console.warn(err));
}
function writeMeta(){
  if (!cloudOn()) return;
  setDoc(userRef, {habits: state.habits, accent: state.accent, updatedAt: Date.now()}, {merge:true}).catch(err => console.warn(err));
}
async function uploadLocal(includeMeta){
  const ops = [];
  if (includeMeta) ops.push(b => b.set(userRef, {habits: state.habits, accent: state.accent, updatedAt: Date.now()}, {merge:true}));
  for (const k in state.log) { const o = {}; for (const h in state.log[k]) o[h] = true; ops.push(b => b.set(doc(userRef,'days',k), o, {merge:true})); }
  for (const k in state.journal) ops.push(b => b.set(doc(userRef,'journal',k), state.journal[k], {merge:true}));
  for (let i = 0; i < ops.length; i += 450) { const b = writeBatch(fs); ops.slice(i, i+450).forEach(f => f(b)); b.commit().catch(err => console.warn(err)); }
}

function startCloud(){
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) { setAcct('none'); return; }
  try {
    const app = initializeApp(cfg);
    fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    auth = getAuth(app);
  } catch (e) { console.warn(e); setAcct('error'); return; }
  getRedirectResult(auth).catch(()=>{});
  onAuthStateChanged(auth, u => {
    unsubs.forEach(f => f()); unsubs = [];
    user = u;
    if (!u) { userRef = null; lifeSetUser(null); setAcct('signedOut'); updateSync(); return; }
    setAcct('signedIn');
    userRef = doc(fs, 'users', u.uid);
    lifeSetUser(userRef);
    const flag = 'habit-matrix-merged-' + u.uid;
    let firstMeta = true;
    unsubs.push(onSnapshot(userRef, {includeMetadataChanges:true}, snap => {
      if (firstMeta) {
        firstMeta = false;
        const merged = localStorage.getItem(flag);
        if (!snap.exists()) { uploadLocal(true); try { localStorage.setItem(flag,'1'); } catch(e) {} return; }
        if (!merged) { uploadLocal(false); try { localStorage.setItem(flag,'1'); } catch(e) {} }
      }
      if (!snap.exists()) return;
      const d = snap.data();
      const next = normalize({habits: d.habits, accent: d.accent, log: state.log, journal: state.journal});
      if (JSON.stringify(next.habits) !== JSON.stringify(state.habits) || next.accent !== state.accent) { state = next; saveLocal(); render(); }
      pendingWrites = snap.metadata.hasPendingWrites; updateSync();
    }, err => { console.warn(err); updateSync(); }));
    unsubs.push(onSnapshot(collection(userRef, 'days'), {includeMetadataChanges:true}, qs => {
      const log = {};
      qs.forEach(ds => { const o = {}; const v = ds.data(); for (const h in v) if (v[h]) o[h] = 1; if (Object.keys(o).length) log[ds.id] = o; });
      if (JSON.stringify(log) !== JSON.stringify(state.log)) { state = Object.assign({}, state, {log}); saveLocal(); render(); }
      pendingWrites = qs.metadata.hasPendingWrites; updateSync();
    }, err => { console.warn(err); updateSync(); }));
    unsubs.push(onSnapshot(collection(userRef, 'journal'), {includeMetadataChanges:true}, qs => {
      const journal = {};
      qs.forEach(ds => { journal[ds.id] = ds.data(); });
      const nj = normalize({journal}).journal;
      for (const k in jTimers) if (state.journal[k]) nj[k] = state.journal[k];
      if (JSON.stringify(nj) !== JSON.stringify(state.journal)) { state = Object.assign({}, state, {journal: nj}); saveLocal(); renderDiary(); }
      pendingWrites = qs.metadata.hasPendingWrites; updateSync();
    }, err => { console.warn(err); updateSync(); }));
  });
}

function setAcct(mode){
  const m = $('acctMsg');
  $('signIn').hidden = mode !== 'signedOut';
  $('signOut').hidden = mode !== 'signedIn';
  if (mode === 'none') m.textContent = 'Sync isn’t set up yet, so your data stays on this device. Add your Firebase config to firebase-config.js to sync your phone and PC.';
  else if (mode === 'error') m.textContent = 'The Firebase config couldn’t be loaded. Check firebase-config.js. Your data is still saved on this device.';
  else if (mode === 'signedOut') m.textContent = 'Sign in with the same Google account on your phone and PC to keep them in sync.';
  else if (mode === 'signedIn') m.textContent = `Signed in as ${user.email || user.displayName || 'you'}. Changes sync automatically, and anything you do offline syncs when you reconnect.`;
  updateSync();
}
function updateSync(){
  const el = $('sync'), t = $('syncTxt');
  if (!cloudOn()) { el.className = 'sync'; t.textContent = 'This device'; return; }
  if (!navigator.onLine) { el.className = 'sync busy'; t.textContent = pendingWrites ? 'Offline · will sync' : 'Offline'; return; }
  if (pendingWrites) { el.className = 'sync busy'; t.textContent = 'Syncing…'; return; }
  el.className = 'sync ok'; t.textContent = 'Synced';
}
addEventListener('online', updateSync); addEventListener('offline', updateSync);


/* ---------- Alarms for habits with a time ---------- */
const isAndroid = /Android/i.test(navigator.userAgent);
function habitTime(name){
  const m = String(name).match(/\b(\d{1,2})[:.h](\d{2})\b/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return (h < 24 && mi < 60) ? {h, m: mi} : null;
}
function alarmHref(name, t){
  const label = name.replace(/\s*(at|@|before|by)?\s*\d{1,2}[:.h]\d{2}\s*/i, ' ').trim() || name;
  if (isAndroid) {
    return 'intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=' + t.h +
      ';i.android.intent.extra.alarm.MINUTES=' + t.m + ';S.android.intent.extra.alarm.MESSAGE=' + encodeURIComponent(label) + ';end';
  }
  const d = new Date(); d.setHours(t.h, t.m, 0, 0);
  const e = new Date(d.getTime() + 15*60000);
  const f = x => x.getFullYear()+pad(x.getMonth()+1)+pad(x.getDate())+'T'+pad(x.getHours())+pad(x.getMinutes())+'00';
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(err) {}
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(label) + '&dates=' + f(d) + '/' + f(e) +
    '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY') + (tz ? '&ctz=' + encodeURIComponent(tz) : '') + '&details=' + encodeURIComponent('Daily reminder from Habit Matrix');
}
const bellSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
let atT = null, atName = '';
function alarmHrefCal(name, t){
  const d = new Date(); d.setHours(t.h, t.m, 0, 0); const e = new Date(d.getTime() + 15*60000);
  const f = x => x.getFullYear()+pad(x.getMonth()+1)+pad(x.getDate())+'T'+pad(x.getHours())+pad(x.getMinutes())+'00';
  const label = name.replace(/\s*(at|@|before|by)?\s*\d{1,2}[:.h]\d{2}\s*/i, ' ').trim() || name;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(label) + '&dates=' + f(d) + '/' + f(e) + '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY');
}
function openAlarm(name){
  const t = habitTime(name); if (!t) return;
  if (!isAndroid) { window.open(alarmHref(name, t), '_blank', 'noopener'); return; }
  let left = false; const onHide = () => { if (document.visibilityState === 'hidden') left = true; };
  document.addEventListener('visibilitychange', onHide);
  location.href = alarmHref(name, t);
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (left) { $('atoast').hidden = true; return; }
    $('atMsg').textContent = 'This browser couldn’t open your Clock app. Ask Claude to set the alarm, or add a daily calendar reminder instead.';
    $('atLink').href = alarmHrefCal(name, t); $('atLink').textContent = 'Calendar'; $('atLink').target = '_blank'; $('atLink').dataset.mode = 'cal';
    $('atoast').hidden = false; clearTimeout(atT); atT = setTimeout(()=>{ $('atoast').hidden = true; }, 15000);
  }, 1500);
}
function offerAlarm(name){
  const t = habitTime(name); if (!t) return;
  $('atMsg').textContent = `${pad(t.h)}:${pad(t.m)} · ${isAndroid ? 'set the alarm on your phone?' : 'add a daily reminder?'}`;
  atName = name; $('atLink').dataset.mode = 'alarm'; $('atLink').removeAttribute('target');
  $('atLink').href = '#';
  $('atLink').textContent = isAndroid ? 'Set alarm' : 'Add reminder';
  $('atoast').hidden = false;
  clearTimeout(atT); atT = setTimeout(()=>{ $('atoast').hidden = true; }, 12000);
}

/* ---------- State changes ---------- */
const isDone = (k,h) => !!(state.log[k] && state.log[k][h]);
const todayKey = () => key(now);
function toggle(k,h){
  const on = !isDone(k,h);
  const day = Object.assign({}, state.log[k] || {});
  if (on) day[h] = 1; else delete day[h];
  const log = Object.assign({}, state.log);
  if (Object.keys(day).length) log[k] = day; else delete log[k];
  state = Object.assign({}, state, {log});
  saveLocal(); render(); writeDay(k, h, on);
}
function setMeta(patch){ state = Object.assign({}, state, patch); saveLocal(); render(); writeMeta(); }

function streak(h){
  const d = new Date(now); let s = 0;
  if (!isDone(key(d),h)) d.setDate(d.getDate()-1);
  while (isDone(key(d),h)) { s++; d.setDate(d.getDate()-1); }
  return s;
}
function monthDays(){
  const y = view.getFullYear(), m = view.getMonth(), n = new Date(y,m+1,0).getDate();
  return Array.from({length:n},(_,i)=>new Date(y,m,i+1));
}
const dotRow = (n, on, cls='on') => Array.from({length:n},(_,i)=>`<i class="${i<on?cls:''}"></i>`).join('');

/* ---------- Render ---------- */
function applyAccent(){
  const a = ACCENTS.find(x=>x.id===state.accent) || ACCENTS[0];
  document.documentElement.style.setProperty('--acc', a.c);
  document.documentElement.style.setProperty('--accInk', a.ink);
}
let render = function(){
  applyAccent();
  const H = state.habits, tk = todayKey();
  const days = monthDays(), past = days.filter(d => key(d) <= tk);
  const monthName = view.toLocaleDateString(undefined,{month:'long',year:'numeric'});

  $('date').textContent = now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
  const done = H.filter(h=>isDone(tk,h.id)).length;
  const p = H.length ? Math.round(done/H.length*100) : 0;
  $('pct').innerHTML = `${p}<small>%</small>`;
  $('heroDots').innerHTML = dotRow(20, Math.round(p/5), p===100 ? 'ac' : 'on');
  const left = H.length - done;
  $('heroMsg').textContent = !H.length ? 'Add your first habit to begin.' : left===0 ? `All ${H.length} done. Well kept.` : `${done} of ${H.length} done · ${left} to go`;
  $('tiles').innerHTML = H.map(h => {
    const on = isDone(tk,h.id), s = streak(h.id);
    return `<li><button class="tile${on?' on':''}" data-t="${esc(h.id)}" aria-pressed="${on}"><span class="tn">${esc(h.name)}</span><span class="tb"><span><b class="sk dm">${pad(s)}</b><span class="sl">day streak</span></span><span class="ck"></span></span></button></li>`;
  }).join('');
  $('todayEmpty').hidden = H.length > 0;

  $('month').textContent = monthName;
  $('next').disabled = view.getFullYear()===now.getFullYear() && view.getMonth()===now.getMonth();
  const g = $('grid');
  g.style.gridTemplateColumns = isDesk() ? `150px repeat(${days.length}, minmax(0,1fr))` : `auto repeat(${days.length}, var(--c))`;
  let html = `<div class="hn" style="color:var(--mute);font-size:12px"><span>Habit</span></div>` +
    days.map((d,i) => `<div class="dh${key(d)===tk?' td':''}${d.getDay()===1&&i?' wk':''}${d.getDay()%6===0?' we':''}">${d.toLocaleDateString(undefined,{weekday:'narrow'})}<b>${d.getDate()}</b></div>`).join('');
  for (const h of H) {
    html += `<div class="hn" title="${esc(h.name)}"><span>${esc(h.name)}</span></div>`;
    for (const d of days) {
      const k = key(d), on = isDone(k,h.id), fut = k > tk;
      html += `<button class="cell${on?' on':''}${k===tk?' td':''}${d.getDay()===1&&d.getDate()>1?' wk':''}" data-d="${k}" data-h="${esc(h.id)}" ${fut?'disabled':''} aria-label="${esc(h.name)}, ${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})}: ${on?'done':'not done'}" aria-pressed="${on}"></button>`;
    }
  }
  g.innerHTML = html;

  $('statsMonth').textContent = monthName;
  const per = H.map(h => ({h, n: past.filter(d=>isDone(key(d),h.id)).length}));
  const total = per.reduce((a,x)=>a+x.n,0), possible = H.length*past.length;
  $('kMonth').textContent = (possible ? Math.round(total/possible*100) : 0) + '%';
  $('kStreak').textContent = H.length ? Math.max(...H.map(h=>streak(h.id))) : 0;
  $('kTicks').textContent = total;
  const ranked = per.map(x => ({...x, pct: past.length ? x.n/past.length*100 : 0})).sort((a,b)=>b.pct-a.pct);
  $('rank').innerHTML = ranked.length ? ranked.map(x => `<li><div class="row"><span>${esc(x.h.name)}</span><span>${x.n}/${past.length} · ${Math.round(x.pct)}%</span></div><div class="dots">${dotRow(20, Math.round(x.pct/5))}</div></li>`).join('') : '<li class="empty">No habits yet.</li>';
  trendData = past.map(d => H.length ? H.filter(h=>isDone(key(d),h.id)).length/H.length*100 : 0);
  $('trendEmpty').hidden = total > 0;
  drawTrend();

  const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.r : null;
  if (!active) $('edit').innerHTML = H.map(h => `<li><input type="text" value="${esc(h.name)}" data-r="${esc(h.id)}" maxlength="40" aria-label="Rename ${esc(h.name)}">${habitTime(h.name) ? `<button class="btn alm" data-al="${esc(h.id)}" aria-label="${isAndroid?'Set alarm for':'Add reminder for'} ${esc(h.name)}" title="${isAndroid?'Set alarm':'Add daily reminder'}">${bellSvg}</button>` : ''}<button class="btn" data-x="${esc(h.id)}" aria-label="Delete ${esc(h.name)}">Delete</button></li>`).join('');
  $('swatches').innerHTML = ACCENTS.map(a => `<button class="sw" data-a="${a.id}" aria-pressed="${a.id===state.accent}" aria-label="${a.name}" title="${a.name}"><i style="background:${a.c}"></i></button>`).join('');
};

const fig = $('trend'), svg = fig.querySelector('svg');
function drawTrend(){
  const W = fig.clientWidth, H = fig.clientHeight;
  if (!W) return;
  const n = monthDays().length, l = 44, r = 10, t = 10, b = 24;
  const x = i => l + (n>1 ? i/(n-1) : 0)*(W-l-r), y = v => t + (1-v/100)*(H-t-b);
  let s = '';
  for (const v of [0,50,100]) s += `<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="2"/><text x="${l-8}" y="${y(v)+4}" text-anchor="end" font-size="12" fill="var(--mute)">${v}%</text>`;
  const ticks = W < 520 ? [1, n] : [1,8,15,22,n];
  for (const d of ticks) s += `<text x="${x(d-1)}" y="${H-6}" text-anchor="middle" font-size="12" fill="var(--mute)">${d}</text>`;
  if (trendData.length) {
    s += `<polyline points="${trendData.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="var(--mute)" stroke-width="1" opacity=".5"/>`;
    s += trendData.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="${i===trendData.length-1?5:3.5}" fill="${i===trendData.length-1?'var(--acc)':'var(--ink)'}"/>`).join('');
  }
  svg.innerHTML = s;
}
const ro = new ResizeObserver(drawTrend); ro.observe(fig);

function scrollToToday(){
  const mx = $('mx'), td = $('grid').querySelector('.cell.td');
  if (td) mx.scrollLeft = Math.max(0, td.offsetLeft + 40 - mx.clientWidth); else mx.scrollLeft = mx.scrollWidth;
}

const VIEWS = ['today','month','diary','stats','habits'];
function route(){
  const h = location.hash.slice(1);
  const v = VIEWS.includes(h) || LIFE_VIEWS.includes(h) ? h : 'today';
  if (lifeRoute(v)) return;
  for (const n of VIEWS) $('v-'+n).classList.toggle('act', n===v);
  for (const a of document.querySelectorAll('.tabs a')) { if (a.dataset.v===v) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); }
  if (!isDesk()) window.scrollTo(0,0);
  if (v==='month' || isDesk()) scrollToToday();
  drawTrend();
}
addEventListener('hashchange', route);
matchMedia('(min-width:900px)').addEventListener('change', () => { render(); scrollToToday(); });

/* ---------- Events ---------- */
$('tiles').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) toggle(todayKey(), b.dataset.t); });
$('grid').addEventListener('click', e => {
  const b = e.target.closest('.cell'); if (!b || b.disabled) return;
  const sl = $('mx').scrollLeft; toggle(b.dataset.d, b.dataset.h); $('mx').scrollLeft = sl;
});
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth()-1, 1); render(); $('mx').scrollLeft = 0; };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth()+1, 1); render(); scrollToToday(); };
$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('newHabit').value.trim(); if (!v) return;
  $('newHabit').value = '';
  setMeta({habits:[...state.habits, {id:uid(), name:v}]});
  offerAlarm(v);
});
$('edit').addEventListener('change', e => {
  const i = e.target.closest('[data-r]'); if (!i) return;
  const v = i.value.trim(), h = state.habits.find(x=>x.id===i.dataset.r);
  i.blur();
  if (h && v && v !== h.name) {
    const before = habitTime(h.name), after = habitTime(v);
    setMeta({habits: state.habits.map(x => x.id===h.id ? {...x, name:v} : x)});
    if (after && (!before || before.h !== after.h || before.m !== after.m)) offerAlarm(v);
  }
  else if (h) { i.value = h.name; render(); }
});
$('edit').addEventListener('click', e => {
  const b = e.target.closest('[data-x]'); if (!b) return;
  const idx = state.habits.findIndex(x=>x.id===b.dataset.x); if (idx<0) return;
  lastDeleted = {h: state.habits[idx], idx};
  setMeta({habits: state.habits.filter((_,i)=>i!==idx)});
  const del = lastDeleted;
  showToast(`Deleted “${del.h.name}”`, () => { const a = [...state.habits]; a.splice(del.idx, 0, del.h); setMeta({habits:a}); });
});
$('atClose').onclick = () => { $('atoast').hidden = true; };
$('atLink').addEventListener('click', e => {
  if ($('atLink').dataset.mode === 'cal') { setTimeout(()=>{ $('atoast').hidden = true; }, 300); return; }
  e.preventDefault(); openAlarm(atName);
});
$('edit').addEventListener('click', e => { const b = e.target.closest('[data-al]'); if (!b) return; const h = state.habits.find(x=>x.id===b.dataset.al); if (h) openAlarm(h.name); });
$('undo').onclick = () => { const f = toastUndo; toastUndo = null; $('toast').hidden = true; if (f) f(); };
$('swatches').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.dataset.a===state.accent) return;
  setMeta({accent:b.dataset.a});
});
$('signIn').onclick = async () => {
  const p = new GoogleAuthProvider();
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) signInWithRedirect(auth, p);
    else if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') $('acctMsg').textContent = 'Sign-in didn’t work: ' + (e.code || e.message) + '. Check that this site’s address is in Firebase’s authorised domains.';
  }
};
$('signOut').onclick = () => signOut(auth);

// Backup
$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(Object.assign({}, state, {life: lifeExport()}), null, 1)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `habit-matrix-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
};
$('importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    const d = normalize(raw);
    if (raw && raw.life) lifeImport(raw.life);
    const log = Object.assign({}, state.log);
    for (const k in d.log) log[k] = Object.assign({}, log[k] || {}, d.log[k]);
    const ids = new Set(state.habits.map(h=>h.id));
    state = {habits: [...state.habits, ...d.habits.filter(h=>!ids.has(h.id))], accent: state.accent, log, journal: Object.assign({}, d.journal, state.journal)};
    saveLocal(); render();
    if (cloudOn()) uploadLocal(true);
    showToast('Backup imported');
  } catch (err) { alert('That file isn’t a Habit Matrix backup.'); }
  e.target.value = '';
};

// Install prompt (Chrome/Edge on Android and Windows)
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('install').hidden = false; });
$('install').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('install').hidden = true; };
addEventListener('appinstalled', () => { $('install').hidden = true; });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const n = new Date(); if (key(n) !== key(now)) { now = n; view = new Date(n.getFullYear(), n.getMonth(), 1); render(); scrollToToday(); }
});

// Updates: the service worker fetches fresh files whenever online, so closing
// and reopening the app always shows the newest version. If a new version is
// published while the app is open, a pop-up offers to reload.
let swReg = null;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('updBar').hidden = false; });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => {
    swReg = r;
    setInterval(() => r.update().catch(()=>{}), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(()=>{}); });
  }).catch(err => console.warn('SW', err)));
}
$('updReload').onclick = () => { try { sessionStorage.setItem('hm-updated', '1'); } catch (e) {} location.reload(); };
$('updLater').onclick = () => { $('updBar').hidden = true; };
try { if (sessionStorage.getItem('hm-updated')) { sessionStorage.removeItem('hm-updated'); setTimeout(() => showToast('Updated to the latest version'), 600); } } catch (e) {}

/* ---------- Diary ---------- */
let jDay = new Date(now); const jTimers = {};
const getJ = k => state.journal[k] || {plan:'', review:'', done:[]};
function setJ(k, patch, immediate){
  const j = Object.assign({}, getJ(k), patch);
  state = Object.assign({}, state, {journal: Object.assign({}, state.journal, {[k]: j})});
  saveLocal();
  if (!cloudOn()) return;
  clearTimeout(jTimers[k]);
  const go = () => { delete jTimers[k]; setDoc(doc(userRef,'journal',k), Object.assign({}, getJ(k), {updatedAt: Date.now()}), {merge:true}).catch(e=>console.warn(e)); };
  if (immediate) go(); else jTimers[k] = setTimeout(go, 800);
}
function parsePlans(text){
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(\d{1,2})[:.h](\d{2})(?:\s*[-–]\s*(\d{1,2})[:.h](\d{2}))?\s+(.+)$/i);
    if (!m) return {line, text: line};
    return {line, text: m[5], sh:+m[1], sm:+m[2], eh: m[3]!=null ? +m[3] : null, em: m[4]!=null ? +m[4] : null};
  });
}
function calLink(p, k){
  const [y,mo,d] = k.split('-').map(Number);
  const start = new Date(y, mo-1, d, p.sh, p.sm);
  const end = p.eh!=null ? new Date(y, mo-1, d, p.eh, p.em) : new Date(start.getTime() + 3600000);
  const f = t => t.getFullYear()+pad(t.getMonth()+1)+pad(t.getDate())+'T'+pad(t.getHours())+pad(t.getMinutes())+'00';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(p.text) + '&dates=' + f(start) + '/' + f(end) + '&details=' + encodeURIComponent('From Habit Matrix');
}
const STOP = new Set('the a an and or to of in on at for with my me i we it is was be do did done get got go went have had this that today morning evening day some more less up out just about into from then than very really also not no before after until while during every each all bit lot'.split(' '));
const stem = w => w.replace(/(ings|ing|ed|es|s)$/,'');
const words = t => (t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
function mentions(target, bag){
  const kw = [...new Set(words(target))]; if (!kw.length) return false;
  const hit = kw.filter(w => bag.has(w)).length;
  return hit >= Math.max(1, Math.ceil(kw.length/2));
}
function renderDiary(){
  const k = key(jDay), j = getJ(k);
  $('dDate').textContent = k === todayKey() ? 'Today' : jDay.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
  $('dNext').disabled = k >= todayKey();
  if (document.activeElement !== $('planTxt')) $('planTxt').value = j.plan;
  if (document.activeElement !== $('reviewTxt')) $('reviewTxt').value = j.review;
  const plans = parsePlans(j.plan);
  $('plans').innerHTML = plans.map((p,i) => {
    const on = j.done.includes(p.line);
    const tm = p.sh!=null ? `<span class="tm">${pad(p.sh)}:${pad(p.sm)}</span>` : '';
    const cal = p.sh!=null ? `<a class="cal" href="${calLink(p,k)}" target="_blank" rel="noopener">+ Calendar</a>` : '';
    return `<li><button class="pchk${on?' on':''}" data-p="${i}" aria-pressed="${on}" aria-label="Mark “${esc(p.text)}” done"></button><span class="pt${on?' on':''}">${tm}${esc(p.text)}</span>${cal}</li>`;
  }).join('');
}
function checkDay(){
  const k = key(jDay), j = getJ(k), bag = new Set(words(j.review));
  const plans = parsePlans(j.plan);
  if (!j.review.trim()) { $('checkOut').innerHTML = '<p class="sum">Write a few lines about your day first.</p>'; return; }
  const done = new Set(j.done); let auto = 0;
  for (const p of plans) if (!done.has(p.line) && mentions(p.text, bag)) { done.add(p.line); auto++; }
  setJ(k, {done:[...done]}, true);
  const doneN = plans.filter(p => done.has(p.line)).length;
  const missed = plans.filter(p => !done.has(p.line));
  const sugg = state.habits.filter(h => !isDone(k,h.id) && mentions(h.name, bag));
  let out = plans.length ? `<p class="sum"><b class="dm" style="font-size:22px">${doneN}/${plans.length}</b> plans done${auto?` · ${auto} ticked from your notes`:''}.</p>` : '<p class="sum">No plans written this morning.</p>';
  if (missed.length) out += `<p class="empty" style="margin-top:0">Not mentioned: ${missed.map(p=>esc(p.text)).join(', ')}. Tick them above if you did them.</p>`;
  if (sugg.length) out += `<p class="sum">Sounds like you also did these habits:</p><div class="sugg">${sugg.map(h=>`<button data-sh="${esc(h.id)}">Tick ${esc(h.name)}</button>`).join('')}</div>`;
  $('checkOut').innerHTML = out; renderDiary();
}
$('planTxt').addEventListener('input', e => { setJ(key(jDay), {plan: e.target.value}); renderDiary(); });
$('reviewTxt').addEventListener('input', e => setJ(key(jDay), {review: e.target.value}));
$('plans').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  const k = key(jDay), j = getJ(k), p = parsePlans(j.plan)[+b.dataset.p]; if (!p) return;
  const done = new Set(j.done); done.has(p.line) ? done.delete(p.line) : done.add(p.line);
  setJ(k, {done:[...done]}, true); renderDiary();
});
$('checkDay').onclick = checkDay;
$('checkOut').addEventListener('click', e => {
  const b = e.target.closest('[data-sh]'); if (!b || b.classList.contains('on')) return;
  const k = key(jDay); if (!isDone(k, b.dataset.sh)) toggle(k, b.dataset.sh);
  b.classList.add('on'); b.textContent = '✓ ' + b.textContent.replace(/^Tick /,'');
});
$('dPrev').onclick = () => { jDay = new Date(jDay.getFullYear(), jDay.getMonth(), jDay.getDate()-1); $('checkOut').innerHTML=''; renderDiary(); };
$('dNext').onclick = () => { if (key(jDay) >= todayKey()) return; jDay = new Date(jDay.getFullYear(), jDay.getMonth(), jDay.getDate()+1); $('checkOut').innerHTML=''; renderDiary(); };

// Voice dictation (Chrome / Edge / Android)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recBtn = null;
function stopRec(){ if (rec) { try { rec.stop(); } catch(e) {} } }
document.querySelectorAll('[data-mic]').forEach(btn => {
  if (!SR) { btn.hidden = true; return; }
  btn.onclick = () => {
    if (rec && recBtn === btn) { stopRec(); return; }
    stopRec();
    if (!navigator.onLine) { $('micNote').hidden = false; $('micNote').textContent = 'Voice typing needs a connection. You can still type, or use your keyboard’s mic button, which may work offline.'; return; }
    const ta = $(btn.dataset.mic);
    rec = new SR(); recBtn = btn;
    rec.lang = navigator.language || 'en-GB'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) {
        const t = ev.results[i][0].transcript.trim(); if (!t) continue;
        const v = ta.value; ta.value = v + (v && !/\s$/.test(v) ? (ta.id==='planTxt' ? '\n' : ' ') : '') + t;
        ta.dispatchEvent(new Event('input'));
      }
    };
    rec.onerror = ev => { $('micNote').hidden = false; $('micNote').textContent = ev.error === 'not-allowed' ? 'Allow microphone access for this app to use voice typing.' : 'Voice typing stopped: ' + ev.error; };
    rec.onend = () => { btn.classList.remove('rec'); rec = null; recBtn = null; };
    btn.classList.add('rec'); $('micNote').hidden = true;
    try { rec.start(); } catch(e) { btn.classList.remove('rec'); }
  };
});

const _render = render;
render = function(){ _render(); renderDiary(); };
initLife({toast: showToast});
render(); route(); startCloud();
