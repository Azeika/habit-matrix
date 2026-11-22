// Life sections: Workouts, Cooking, Economy, Sleep & recovery, plus customizable navigation.
import { doc, collection, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const money0 = n => { try { return new Intl.NumberFormat(undefined, {style:'currency', currency:'EUR', maximumFractionDigits: 0}).format(Math.round(n)); } catch (e) { return '€' + Math.round(n); } };
const money = n => { try { return new Intl.NumberFormat(undefined, {style:'currency', currency:'EUR', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2}).format(n); } catch (e) { return '€' + n.toFixed(2); } };
const isDesk = () => matchMedia('(min-width:900px)').matches;

/* ---------- Screens & icons ---------- */
const ICON = {
  today: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  month: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  diary: '<path d="M6 3h11a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z"/><path d="M5 19a2 2 0 0 1 2-2h12M9 8h6M9 12h4"/>',
  stats: '<path d="M3 17l5-5 4 3 8-9"/><path d="M3 21h18"/>',
  habits: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  life: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  workouts: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  cooking: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M9 3c-1 1.5 1 2.5 0 4M14 3c-1 1.5 1 2.5 0 4"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'
};
const SCREENS = {
  today: 'Today', month: 'Month', diary: 'Diary', stats: 'Stats', habits: 'Habits',
  life: 'Life', workouts: 'Workouts', cooking: 'Cooking', money: 'Economy', sleep: 'Sleep'
};
const SECTIONS = ['workouts', 'cooking', 'money', 'sleep'];
const SECTION_TITLE = {workouts: 'Workouts', cooking: 'Cooking', money: 'Economy', sleep: 'Sleep & recovery'};
export const LIFE_VIEWS = ['life', ...SECTIONS];
const MAX_TABS = 6;
const DEFAULT_SETTINGS = {
  nav: ['today', 'month', 'diary', 'life', 'habits'],
  sections: SECTIONS.map(id => ({id, on: true})),
  budget: 0, plan: {}, shop: []
};
const WORKOUT_TYPES = ['Run', 'Gym', 'Cycling', 'Swim', 'Walk', 'Football', 'Yoga', 'Other'];
const CATS_OUT = ['Groceries', 'Eating out', 'Rent', 'Transport', 'Fun', 'Shopping', 'Health', 'Subscriptions', 'Savings', 'Other'];
const CATS_IN = ['Salary', 'Gift', 'Sale', 'Other income'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ---------- Data ---------- */
const LS = 'habit-matrix-life-v1';
const COLS = ['workouts', 'sleep', 'money', 'recipes'];
let data = load();
function load(){
  let d = null; try { d = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
  d = d && typeof d === 'object' ? d : {};
  const out = {settings: normSettings(d.settings)};
  for (const c of COLS) out[c] = (d[c] && typeof d[c] === 'object') ? d[c] : {};
  return out;
}
function normSettings(s){
  s = s && typeof s === 'object' ? s : {};
  const valid = Object.keys(SCREENS);
  let nav = Array.isArray(s.nav) ? s.nav.filter(v => valid.includes(v)) : DEFAULT_SETTINGS.nav.slice();
  nav = [...new Set(nav)].slice(0, MAX_TABS);
  if (!nav.includes('life')) nav = [...nav.slice(0, MAX_TABS - 1), 'life'];
  let sections = Array.isArray(s.sections) ? s.sections.filter(x => x && SECTIONS.includes(x.id)).map(x => ({id: x.id, on: x.on !== false})) : [];
  for (const id of SECTIONS) if (!sections.some(x => x.id === id)) sections.push({id, on: true});
  return {
    nav, sections,
    budget: Number(s.budget) > 0 ? Number(s.budget) : 0,
    plan: s.plan && typeof s.plan === 'object' ? s.plan : {},
    shop: Array.isArray(s.shop) ? s.shop.filter(x => x && x.id).map(x => ({id: String(x.id), text: String(x.text || ''), done: !!x.done})) : []
  };
}
const saveLocal = () => { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) {} };

let userRef = null, unsubs = [], settingsTimer = null, ctx = null;
export function setUser(ref){
  unsubs.forEach(f => f()); unsubs = [];
  userRef = ref;
  if (!ref) return;
  const sref = doc(ref, 'life', 'settings');
  let first = true;
  unsubs.push(onSnapshot(sref, snap => {
    if (first) {
      first = false;
      if (!snap.exists()) { setDoc(sref, data.settings).catch(console.warn); uploadAll(); return; }
    }
    if (!snap.exists() || settingsTimer) return;
    const s = normSettings(snap.data());
    if (JSON.stringify(s) !== JSON.stringify(data.settings)) { data.settings = s; saveLocal(); refresh(); }
  }, console.warn));
  for (const c of COLS) {
    unsubs.push(onSnapshot(collection(ref, c), qs => {
      const m = {}; qs.forEach(ds => { m[ds.id] = ds.data(); });
      if (JSON.stringify(m) !== JSON.stringify(data[c])) { data[c] = m; saveLocal(); refresh(); }
    }, console.warn));
  }
}
function uploadAll(){
  if (!userRef) return;
  for (const c of COLS) for (const id in data[c]) setDoc(doc(userRef, c, id), data[c][id]).catch(console.warn);
}
function putItem(c, id, obj){
  data[c] = Object.assign({}, data[c], {[id]: obj}); saveLocal(); refresh();
  if (userRef) setDoc(doc(userRef, c, id), obj).catch(console.warn);
}
function delItem(c, id){
  const m = Object.assign({}, data[c]); delete m[id]; data[c] = m; saveLocal(); refresh();
  if (userRef) deleteDoc(doc(userRef, c, id)).catch(console.warn);
}
function setSettings(patch){
  data.settings = normSettings(Object.assign({}, data.settings, patch)); saveLocal(); refresh();
  if (!userRef) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => { settingsTimer = null; setDoc(doc(userRef, 'life', 'settings'), data.settings).catch(console.warn); }, 500);
}
export function exportData(){ return JSON.parse(JSON.stringify(data)); }
export function importData(d){
  if (!d || typeof d !== 'object') return;
  for (const c of COLS) if (d[c] && typeof d[c] === 'object') for (const id in d[c]) putItem(c, id, d[c][id]);
  if (d.settings) setSettings(Object.assign({}, data.settings, {budget: d.settings.budget || data.settings.budget, plan: Object.assign({}, d.settings.plan, data.settings.plan), shop: data.settings.shop.length ? data.settings.shop : (d.settings.shop || [])}));
}

/* ---------- Navigation ---------- */
let current = 'today';
export function renderNav(v){
  current = v || current;
  const tabs = document.querySelector('.tabs');
  const parent = LIFE_VIEWS.includes(current) && !data.settings.nav.includes(current) ? 'life' : current;
  tabs.innerHTML = data.settings.nav.map(n => `<a href="#${n}" data-v="${n}"${n === parent ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24">${ICON[n]}</svg><span>${SCREENS[n]}</span></a>`).join('');
  const top = $('topnav');
  if (top) {
    const items = [['today', 'Habits'], ...data.settings.sections.filter(s => s.on).map(s => [s.id, SECTION_TITLE[s.id]]), ['life', 'Customize']];
    const deskCur = LIFE_VIEWS.includes(current) ? current : 'today';
    top.innerHTML = items.map(([id, label]) => `<a href="#${id}"${id === deskCur ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  }
}

/* ---------- Charts ---------- */
const charts = [];
function chart(id, draw){ charts.push({id, draw}); }
function drawCharts(){ for (const c of charts) { const el = $(c.id); if (el && el.offsetParent) c.draw(el); } }
addEventListener('resize', () => requestAnimationFrame(drawCharts));
function barsSvg(el, items, {fmt = v => v, hi = () => false, line = null} = {}){
  const W = el.clientWidth, H = el.clientHeight; if (!W) return;
  const svg = el.querySelector('svg');
  const l = 40, r = 8, t = 12, b = 26;
  const max = Math.max(1, line || 0, ...items.map(i => i.v)) * 1.1;
  const step = (W - l - r) / Math.max(1, items.length), bw = Math.max(4, Math.min(34, step * .62));
  const y = v => t + (1 - v / max) * (H - t - b);
  let s = '';
  for (const g of [0, .5, 1]) { const v = max / 1.1 * g; s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="2"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute)">${esc(fmt(v))}</text>`; }
  const every = Math.ceil(items.length / Math.max(1, Math.floor((W - l) / 38)));
  items.forEach((it, i) => {
    const x = l + step * i + (step - bw) / 2, h = Math.max(it.v ? 2 : 0, y(0) - y(it.v));
    s += `<rect x="${x}" y="${y(0) - h}" width="${bw}" height="${h}" rx="${Math.min(5, bw / 3)}" fill="${hi(it, i) ? 'var(--acc)' : 'var(--ink)'}" opacity="${hi(it, i) ? 1 : .85}"><title>${esc(it.label)}: ${esc(fmt(it.v))}</title></rect>`;
    if (i % every === 0 || i === items.length - 1) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--mute)">${esc(it.short || it.label)}</text>`;
  });
  if (line) s += `<line x1="${l}" x2="${W - r}" y1="${y(line)}" y2="${y(line)}" stroke="var(--acc)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W - r}" y="${y(line) - 6}" text-anchor="end" font-size="11" fill="var(--acc)">${esc(fmt(line))}</text>`;
  svg.innerHTML = s;
}
function lineSvg(el, pts, {fmt = v => v, ref = null, labels = []} = {}){
  const W = el.clientWidth, H = el.clientHeight; if (!W) return;
  const svg = el.querySelector('svg');
  const l = 48, r = 10, t = 12, b = 26;
  const vals = pts.filter(p => p != null);
  const max = Math.max(1, ref || 0, ...vals) * 1.08;
  const n = Math.max(2, pts.length);
  const x = i => l + i / (n - 1) * (W - l - r), y = v => t + (1 - v / max) * (H - t - b);
  let s = '';
  for (const g of [0, .5, 1]) { const v = max / 1.08 * g; s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="2"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute)">${esc(fmt(v))}</text>`; }
  if (ref) s += `<line x1="${l}" x2="${W - r}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--acc)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W - r}" y="${y(ref) - 6}" text-anchor="end" font-size="11" fill="var(--acc)">Budget ${esc(fmt(ref))}</text>`;
  const seg = pts.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean);
  if (seg.length > 1) s += `<polyline points="${seg.join(' ')}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
  pts.forEach((v, i) => { if (v != null && (i === pts.length - 1 || pts[i + 1] == null)) s += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--acc)"/>`; });
  labels.forEach(([i, txt]) => { s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--mute)">${esc(txt)}</text>`; });
  svg.innerHTML = s;
}
const fig = (id, h = 180) => `<div class="fig" id="${id}" style="height:${h}px"><svg></svg></div>`;
const rows = items => items.length ? `<ul class="rank">${items.map(x => `<li><div class="row"><span>${esc(x.label)}</span><span>${esc(x.val)}</span></div><div class="bar"><i style="width:${Math.max(2, x.pct)}%"></i></div></li>`).join('')}</ul>` : '<p class="empty">Nothing logged yet.</p>';
const kpi = (v, label) => `<div class="card kpi"><b class="dm">${v}</b><span>${esc(label)}</span></div>`;

/* ---------- Workouts ---------- */
function weekStart(d){ const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
function renderWorkouts(){
  const all = Object.entries(data.workouts).map(([id, w]) => ({id, ...w})).filter(w => w.date).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  const now = new Date(), ws = key(weekStart(now)), ms = key(new Date(now.getFullYear(), now.getMonth(), 1));
  const week = all.filter(w => w.date >= ws), month = all.filter(w => w.date >= ms);
  const mins = a => a.reduce((s, w) => s + (+w.min || 0), 0);
  const km = month.reduce((s, w) => s + (+w.km || 0), 0);
  const types = {}; for (const w of month) types[w.type] = (types[w.type] || 0) + (+w.min || 0);
  const tmax = Math.max(1, ...Object.values(types));
  $('v-workouts').innerHTML = `
    ${head('Workouts')}
    <div class="kpis">${kpi(week.length, 'sessions this week')}${kpi(Math.round(mins(week)), 'minutes this week')}${kpi(km ? km.toFixed(1) : 0, 'km this month')}</div>
    <div class="lgrid">
      <div class="card"><h2>Training minutes · last 8 weeks</h2>${fig('chWk')}</div>
      <div class="card"><h2>This month by type</h2>${rows(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, m]) => ({label: t, val: m + ' min', pct: m / tmax * 100})))}</div>
      <form class="card form" id="fWorkout">
        <h2>Log a workout</h2>
        <div class="fgrid">
          <label>Type<select name="type">${WORKOUT_TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label>Date<input type="date" name="date" value="${key(now)}" required></label>
          <label>Minutes<input type="number" name="min" min="1" max="600" inputmode="numeric" placeholder="45" required></label>
          <label>Distance (km)<input type="number" name="km" min="0" step="0.1" inputmode="decimal" placeholder="optional"></label>
          <label class="wide2"><span>Effort <output name="eo">6</output>/10</span><input type="range" name="effort" min="1" max="10" value="6" oninput="this.form.eo.value=this.value"></label>
          <label class="wide2">Note<input type="text" name="note" maxlength="80" placeholder="optional, e.g. legs + core"></label>
        </div>
        <button class="btn pri" type="submit">Save workout</button>
      </form>
      <div class="card"><h2>Recent</h2>${all.length ? `<ul class="list">${all.slice(0, 20).map(w => `<li><div><b>${esc(w.type)}</b> · ${esc(w.min)} min${w.km ? ' · ' + esc(w.km) + ' km' : ''}${w.effort ? ' · effort ' + esc(w.effort) : ''}<span class="sub2">${parseDate(w.date).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'})}${w.note ? ' · ' + esc(w.note) : ''}</span></div><button class="x" data-del="workouts:${esc(w.id)}" aria-label="Delete workout">&#10005;</button></li>`).join('')}</ul>` : '<p class="empty">No workouts yet. Log your first one above.</p>'}</div>
    </div>`;
  $('fWorkout').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    putItem('workouts', uid(), {type: f.get('type'), date: f.get('date'), min: +f.get('min'), km: f.get('km') ? +f.get('km') : 0, effort: +f.get('effort'), note: String(f.get('note') || ''), at: Date.now()});
    ctx.toast('Workout saved');
  };
  const weeks = []; let w0 = weekStart(now);
  for (let i = 7; i >= 0; i--) { const s = new Date(w0); s.setDate(s.getDate() - i * 7); const e = new Date(s); e.setDate(e.getDate() + 7); weeks.push({s: key(s), e: key(e), short: s.getDate() + '/' + (s.getMonth() + 1)}); }
  const wk = weeks.map(x => ({label: 'Week of ' + x.short, short: x.short, v: mins(all.filter(w => w.date >= x.s && w.date < x.e))}));
  charts.length = 0;
  chart('chWk', el => barsSvg(el, wk, {fmt: v => Math.round(v), hi: (it, i) => i === wk.length - 1}));
}

/* ---------- Sleep ---------- */
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const dur = (bed, wake) => { const b = toMin(bed), w = toMin(wake); if (b == null || w == null) return null; let d = w - b; if (d <= 0) d += 1440; return d; };
const hm = m => m == null ? '–' : Math.floor(m / 60) + 'h' + pad(Math.round(m % 60));
const bedNorm = t => { const m = toMin(t); return m == null ? null : (m < 720 ? m + 1440 : m); };
const clock = m => { m = Math.round(m) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
function renderSleep(){
  const all = Object.entries(data.sleep).map(([date, s]) => ({date, ...s})).sort((a, b) => b.date.localeCompare(a.date));
  const last7 = all.slice(0, 7);
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const d7 = avg(last7.map(s => dur(s.bed, s.wake)).filter(v => v != null));
  const b7 = avg(last7.map(s => bedNorm(s.bed)).filter(v => v != null));
  const q7 = avg(last7.map(s => +s.quality).filter(Boolean));
  const now = new Date();
  $('v-sleep').innerHTML = `
    ${head('Sleep & recovery')}
    <div class="kpis">${kpi(hm(d7), 'avg sleep · 7 nights')}${kpi(b7 == null ? '–' : clock(b7), 'avg bedtime')}${kpi(q7 == null ? '–' : q7.toFixed(1) + '/5', 'avg quality')}</div>
    <div class="lgrid">
      <div class="card"><h2>Hours slept · last 14 nights</h2>${fig('chSl')}<p class="note2">Red bars are 7 hours or more.</p></div>
      <div class="card"><h2>Bedtime · last 14 nights</h2>${fig('chBed')}</div>
      <form class="card form" id="fSleep">
        <h2>Log last night</h2>
        <div class="fgrid">
          <label>Morning of<input type="date" name="date" value="${key(now)}" required></label>
          <label>Bedtime<input type="time" name="bed" value="23:30" required></label>
          <label>Woke up<input type="time" name="wake" value="07:30" required></label>
          <label><span>Quality <output name="qo">3</output>/5</span><input type="range" name="quality" min="1" max="5" value="3" oninput="this.form.qo.value=this.value"></label>
          <label class="wide2"><span>Energy today <output name="eo">3</output>/5</span><input type="range" name="energy" min="1" max="5" value="3" oninput="this.form.eo.value=this.value"></label>
        </div>
        <button class="btn pri" type="submit">Save night</button>
      </form>
      <div class="card"><h2>Recent nights</h2>${all.length ? `<ul class="list">${all.slice(0, 14).map(s => `<li><div><b>${hm(dur(s.bed, s.wake))}</b> · ${esc(s.bed)} → ${esc(s.wake)}<span class="sub2">${parseDate(s.date).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'})} · quality ${esc(s.quality)}/5 · energy ${esc(s.energy)}/5</span></div><button class="x" data-del="sleep:${esc(s.date)}" aria-label="Delete night">&#10005;</button></li>`).join('')}</ul>` : '<p class="empty">No nights logged yet.</p>'}</div>
    </div>`;
  $('fSleep').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    putItem('sleep', f.get('date'), {bed: f.get('bed'), wake: f.get('wake'), quality: +f.get('quality'), energy: +f.get('energy'), at: Date.now()});
    ctx.toast('Night saved'); ctx.sleepLogged && ctx.sleepLogged(f.get('date'), f.get('bed'), f.get('wake'));
  };
  const nights = []; for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const k = key(d); const s = data.sleep[k]; nights.push({k, d, s}); }
  charts.length = 0;
  chart('chSl', el => barsSvg(el, nights.map(n => ({label: n.d.toLocaleDateString(undefined, {day: 'numeric', month: 'short'}), short: String(n.d.getDate()), v: n.s ? (dur(n.s.bed, n.s.wake) || 0) / 60 : 0})), {fmt: v => v.toFixed(v < 10 && v % 1 ? 1 : 0) + 'h', hi: it => it.v >= 7}));
  chart('chBed', el => {
    const pts = nights.map(n => n.s ? bedNorm(n.s.bed) : null);
    const vals = pts.filter(v => v != null);
    if (!vals.length) { el.querySelector('svg').innerHTML = `<text x="50%" y="50%" text-anchor="middle" font-size="13" fill="var(--mute)">No bedtimes yet</text>`; return; }
    const lo = Math.min(...vals) - 30, hi2 = Math.max(...vals) + 30;
    const W = el.clientWidth, H = el.clientHeight, l = 48, r = 10, t = 12, b = 26;
    const x = i => l + i / 13 * (W - l - r), y = v => t + (v - lo) / (hi2 - lo) * (H - t - b);
    let s = '';
    for (const g of [0, .5, 1]) { const v = lo + (hi2 - lo) * g; s += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="1 5" stroke-linecap="round" stroke-width="2"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--mute)">${clock(v)}</text>`; }
    pts.forEach((v, i) => { if (v != null) s += `<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${i === 13 ? 'var(--acc)' : 'var(--ink)'}"><title>${clock(v)}</title></circle>`; });
    [[0, nights[0].d.getDate()], [13, nights[13].d.getDate()]].forEach(([i, txt]) => { s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--mute)">${txt}</text>`; });
    el.querySelector('svg').innerHTML = s;
  });
}

/* ---------- Economy ---------- */
let mView = new Date(); mView = new Date(mView.getFullYear(), mView.getMonth(), 1);
function renderMoney(){
  const ym = mView.getFullYear() + '-' + pad(mView.getMonth() + 1);
  const all = Object.entries(data.money).map(([id, t]) => ({id, ...t})).filter(t => t.date && t.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  const inc = all.filter(t => t.kind === 'in').reduce((s, t) => s + +t.amount, 0);
  const out = all.filter(t => t.kind !== 'in').reduce((s, t) => s + +t.amount, 0);
  const budget = data.settings.budget;
  const cats = {}; for (const t of all) if (t.kind !== 'in') cats[t.cat] = (cats[t.cat] || 0) + +t.amount;
  const cmax = Math.max(1, ...Object.values(cats));
  const isCur = ym === key(new Date()).slice(0, 7);
  const label = mView.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
  $('v-money').innerHTML = `
    <div class="vh"><h1>Economy</h1><div class="nav"><button id="mPrev" aria-label="Previous month">&#8249;</button><b>${esc(label)}</b><button id="mNext" aria-label="Next month" ${isCur ? 'disabled' : ''}>&#8250;</button></div></div>
    <a class="back" href="#life">‹ Life</a>
    <div class="kpis">${kpi(money0(out), 'spent')}${kpi(money0(inc), 'income')}${kpi(budget ? money0(budget - out) : money0(inc - out), budget ? (budget - out < 0 ? 'over budget' : 'left of budget') : 'net this month')}</div>
    <div class="lgrid">
      <div class="card"><h2>Spending through the month</h2>${fig('chMo')}</div>
      <div class="card"><h2>Spending by category</h2>${rows(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({label: c, val: money(v), pct: v / cmax * 100})))}</div>
      <form class="card form" id="fMoney">
        <h2>Add a transaction</h2>
        <div class="seg" role="radiogroup" aria-label="Type"><label><input type="radio" name="kind" value="out" checked><span>Expense</span></label><label><input type="radio" name="kind" value="in"><span>Income</span></label></div>
        <div class="fgrid">
          <label>Amount (€)<input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="12.50" required></label>
          <label>Category<select name="cat" id="mCat">${CATS_OUT.map(c => `<option>${c}</option>`).join('')}</select></label>
          <label>Date<input type="date" name="date" value="${key(new Date())}" required></label>
          <label>Note<input type="text" name="note" maxlength="60" placeholder="optional"></label>
        </div>
        <button class="btn pri" type="submit">Add</button>
      </form>
      <div class="card"><h2>Monthly budget</h2><form class="add" id="fBudget"><input type="number" name="budget" min="0" step="10" inputmode="decimal" placeholder="e.g. 800" value="${budget || ''}" aria-label="Monthly spending budget in euros"><button class="btn" type="submit">Save</button></form><p class="note2">${budget ? 'Shown as a dashed line on the chart.' : 'Optional. Set one to see how much is left each month.'}</p></div>
      <div class="card span2"><h2>Transactions</h2>${all.length ? `<ul class="list">${all.map(t => `<li><div><b class="${t.kind === 'in' ? 'pos' : ''}">${t.kind === 'in' ? '+' : '−'}${money(+t.amount)}</b> · ${esc(t.cat)}<span class="sub2">${parseDate(t.date).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})}${t.note ? ' · ' + esc(t.note) : ''}</span></div><button class="x" data-del="money:${esc(t.id)}" aria-label="Delete transaction">&#10005;</button></li>`).join('')}</ul>` : '<p class="empty">No transactions this month.</p>'}</div>
    </div>`;
  $('mPrev').onclick = () => { mView = new Date(mView.getFullYear(), mView.getMonth() - 1, 1); renderMoney(); drawCharts(); };
  $('mNext').onclick = () => { mView = new Date(mView.getFullYear(), mView.getMonth() + 1, 1); renderMoney(); drawCharts(); };
  const form = $('fMoney');
  form.querySelectorAll('[name=kind]').forEach(r => r.onchange = () => { $('mCat').innerHTML = (form.kind.value === 'in' ? CATS_IN : CATS_OUT).map(c => `<option>${c}</option>`).join(''); });
  form.onsubmit = e => {
    e.preventDefault(); const f = new FormData(form);
    putItem('money', uid(), {kind: f.get('kind'), amount: Math.round(+f.get('amount') * 100) / 100, cat: f.get('cat'), date: f.get('date'), note: String(f.get('note') || ''), at: Date.now()});
    ctx.toast('Transaction added');
  };
  $('fBudget').onsubmit = e => { e.preventDefault(); setSettings({budget: Math.max(0, +new FormData(e.target).get('budget') || 0)}); ctx.toast('Budget saved'); };
  const n = new Date(mView.getFullYear(), mView.getMonth() + 1, 0).getDate();
  const today = isCur ? new Date().getDate() : n;
  let run = 0; const pts = [];
  for (let d = 1; d <= n; d++) { const k = ym + '-' + pad(d); run += all.filter(t => t.kind !== 'in' && t.date === k).reduce((s, t) => s + +t.amount, 0); pts.push(d <= today ? run : null); }
  charts.length = 0;
  chart('chMo', el => lineSvg(el, pts, {fmt: v => money0(v), ref: budget || null, labels: [[0, '1'], [Math.floor(n / 2), String(Math.floor(n / 2) + 1)], [n - 1, String(n)]]}));
}

/* ---------- Cooking ---------- */
function renderCooking(){
  const recipes = Object.entries(data.recipes).map(([id, r]) => ({id, ...r})).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const plan = data.settings.plan, shop = data.settings.shop;
  const planned = Object.values(plan).filter(Boolean).length;
  const opt = sel => `<option value="">–</option>` + recipes.map(r => `<option value="${esc(r.id)}"${sel === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  $('v-cooking').innerHTML = `
    ${head('Cooking')}
    <div class="kpis">${kpi(recipes.length, 'recipes')}${kpi(planned + '/14', 'meals planned')}${kpi(shop.filter(s => !s.done).length, 'to buy')}</div>
    <div class="lgrid">
      <div class="card span2"><h2>This week’s meal plan</h2>
        <div class="plan">${DAYS.map((d, i) => `<div class="pday"><b>${d}</b><select data-plan="${i}-l" aria-label="${d} lunch">${opt(plan[i + '-l'])}</select><select data-plan="${i}-d" aria-label="${d} dinner">${opt(plan[i + '-d'])}</select></div>`).join('')}</div>
        <p class="note2">${recipes.length ? 'First choice is lunch, second is dinner.' : 'Add a recipe below to start planning.'}</p>
      </div>
      <div class="card"><h2>Shopping list</h2>
        <form class="add" id="fShop"><input type="text" name="t" maxlength="60" placeholder="Add an item" aria-label="Shopping item"><button class="btn" type="submit">Add</button></form>
        ${shop.length ? `<ul class="shop">${shop.map(s => `<li><button class="pchk${s.done ? ' on' : ''}" data-shop="${esc(s.id)}" aria-pressed="${s.done}" aria-label="Got ${esc(s.text)}"></button><span class="${s.done ? 'pt on' : 'pt'}">${esc(s.text)}</span></li>`).join('')}</ul>` : '<p class="empty">Your list is empty.</p>'}
        <div class="acct-row" style="margin-top:12px"><button class="btn" id="fromPlan" ${planned ? '' : 'disabled'}>Add ingredients from the plan</button><button class="btn" id="clearShop" ${shop.some(s => s.done) ? '' : 'disabled'}>Clear ticked</button></div>
      </div>
      <form class="card form" id="fRecipe">
        <h2>New recipe</h2>
        <div class="fgrid">
          <label class="wide2">Name<input type="text" name="name" maxlength="60" placeholder="e.g. Chicken curry" required></label>
          <label>Time (min)<input type="number" name="time" min="1" max="600" inputmode="numeric" placeholder="30"></label>
          <label>Serves<input type="number" name="serves" min="1" max="20" inputmode="numeric" placeholder="2"></label>
          <label class="wide2">Ingredients (one per line)<textarea name="ing" rows="4" placeholder="2 chicken breasts&#10;1 onion&#10;400 ml coconut milk"></textarea></label>
          <label class="wide2">Steps<textarea name="steps" rows="4" placeholder="1. Fry the onion…"></textarea></label>
        </div>
        <button class="btn pri" type="submit">Save recipe</button>
      </form>
      <div class="card span2"><h2>Recipes</h2>${recipes.length ? `<div class="recipes">${recipes.map(r => `<details class="recipe"><summary><b>${esc(r.name)}</b><span class="sub2">${[r.time ? r.time + ' min' : '', r.serves ? 'serves ' + r.serves : '', (r.ing || []).length + ' ingredients'].filter(Boolean).join(' · ')}</span></summary><div class="rbody">${(r.ing || []).length ? `<ul>${r.ing.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}${r.steps ? `<p>${esc(r.steps).replace(/\n/g, '<br>')}</p>` : ''}<button class="btn" data-del="recipes:${esc(r.id)}">Delete recipe</button></div></details>`).join('')}</div>` : '<p class="empty">No recipes yet.</p>'}</div>
    </div>`;
  $('v-cooking').querySelectorAll('[data-plan]').forEach(s => s.onchange = () => { setSettings({plan: Object.assign({}, data.settings.plan, {[s.dataset.plan]: s.value})}); });
  $('fShop').onsubmit = e => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; setSettings({shop: [...data.settings.shop, {id: uid(), text: t, done: false}]}); };
  $('v-cooking').querySelectorAll('[data-shop]').forEach(b => b.onclick = () => setSettings({shop: data.settings.shop.map(s => s.id === b.dataset.shop ? {...s, done: !s.done} : s)}));
  $('clearShop').onclick = () => setSettings({shop: data.settings.shop.filter(s => !s.done)});
  $('fromPlan').onclick = () => {
    const have = new Set(data.settings.shop.map(s => s.text.toLowerCase()));
    const add = [];
    for (const id of Object.values(data.settings.plan)) { const r = data.recipes[id]; if (!r) continue; for (const i of r.ing || []) { const k = i.toLowerCase(); if (!have.has(k)) { have.add(k); add.push({id: uid(), text: i, done: false}); } } }
    setSettings({shop: [...data.settings.shop, ...add]}); ctx.toast(add.length ? `${add.length} item${add.length > 1 ? 's' : ''} added` : 'Everything is already on the list');
  };
  $('fRecipe').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    putItem('recipes', uid(), {name: String(f.get('name')).trim(), time: +f.get('time') || 0, serves: +f.get('serves') || 0, ing: String(f.get('ing') || '').split('\n').map(s => s.trim()).filter(Boolean), steps: String(f.get('steps') || '').trim(), at: Date.now()});
    ctx.toast('Recipe saved');
  };
  charts.length = 0;
}

/* ---------- Life home & customize ---------- */
function head(title){ return `<div class="vh"><h1>${esc(title)}</h1></div><a class="back" href="#life">‹ Life</a>`; }
function summary(id){
  const now = new Date();
  if (id === 'workouts') { const ws = key(weekStart(now)); const w = Object.values(data.workouts).filter(x => x.date >= ws); return [w.length, 'sessions this week']; }
  if (id === 'sleep') { const s = Object.values(data.sleep).slice(-7).map(x => dur(x.bed, x.wake)).filter(v => v != null); return [s.length ? hm(s.reduce((a, b) => a + b, 0) / s.length) : '–', 'avg sleep']; }
  if (id === 'money') { const ym = key(now).slice(0, 7); const out = Object.values(data.money).filter(t => t.date && t.date.startsWith(ym) && t.kind !== 'in').reduce((s, t) => s + +t.amount, 0); return [money0(out), 'spent this month']; }
  if (id === 'cooking') { return [Object.values(data.settings.plan).filter(Boolean).length + '/14', 'meals planned']; }
}
function renderLife(){
  const S = data.settings;
  const nav = S.nav;
  $('v-life').innerHTML = `
    <div class="vh"><h1>Life</h1></div>
    <div class="lcards">${S.sections.filter(s => s.on).map(s => { const [v, l] = summary(s.id); return `<a class="lcard" href="#${s.id}"><svg viewBox="0 0 24 24">${ICON[s.id]}</svg><span class="ln">${SECTION_TITLE[s.id]}</span><b class="dm">${esc(v)}</b><span class="sub2">${esc(l)}</span></a>`; }).join('') || '<p class="empty">All sections are hidden. Turn one on below.</p>'}</div>
    <div class="lgrid">
      <div class="card"><h2>Sections</h2>
        <ul class="cust">${S.sections.map((s, i) => `<li><label class="sw2"><input type="checkbox" data-sec="${s.id}" ${s.on ? 'checked' : ''}><span></span></label><span class="cn">${SECTION_TITLE[s.id]}</span><button class="mv" data-secup="${i}" ${i ? '' : 'disabled'} aria-label="Move ${SECTION_TITLE[s.id]} up">↑</button><button class="mv" data-secdn="${i}" ${i < S.sections.length - 1 ? '' : 'disabled'} aria-label="Move ${SECTION_TITLE[s.id]} down">↓</button></li>`).join('')}</ul>
      </div>
      <div class="card"><h2>Bottom bar on your phone · ${nav.length}/${MAX_TABS}</h2>
        <ul class="cust">${nav.map((n, i) => `<li><svg viewBox="0 0 24 24" class="ci">${ICON[n]}</svg><span class="cn">${SCREENS[n]}</span><button class="mv" data-navup="${i}" ${i ? '' : 'disabled'} aria-label="Move ${SCREENS[n]} left">↑</button><button class="mv" data-navdn="${i}" ${i < nav.length - 1 ? '' : 'disabled'} aria-label="Move ${SCREENS[n]} right">↓</button>${n === 'life' ? '<span class="mv"></span>' : `<button class="mv" data-navrm="${n}" aria-label="Remove ${SCREENS[n]}">&#10005;</button>`}</li>`).join('')}</ul>
        <div class="chips">${Object.keys(SCREENS).filter(n => !nav.includes(n)).map(n => `<button class="chip" data-navadd="${n}" ${nav.length >= MAX_TABS ? 'disabled' : ''}>+ ${SCREENS[n]}</button>`).join('')}</div>
        <p class="note2">${nav.length >= MAX_TABS ? 'The bar is full. Remove one to add another.' : 'Tap + to pin a screen to the bar.'} Life always stays, so you can come back here. Anything not on the bar is reachable from here or from Today.</p>
      </div>
    </div>`;
  const v = $('v-life');
  v.querySelectorAll('[data-sec]').forEach(c => c.onchange = () => setSettings({sections: S.sections.map(s => s.id === c.dataset.sec ? {...s, on: c.checked} : s)}));
  const move = (arr, i, d) => { const a = arr.slice(); const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  v.querySelectorAll('[data-secup]').forEach(b => b.onclick = () => setSettings({sections: move(S.sections, +b.dataset.secup, -1)}));
  v.querySelectorAll('[data-secdn]').forEach(b => b.onclick = () => setSettings({sections: move(S.sections, +b.dataset.secdn, 1)}));
  v.querySelectorAll('[data-navup]').forEach(b => b.onclick = () => setSettings({nav: move(nav, +b.dataset.navup, -1)}));
  v.querySelectorAll('[data-navdn]').forEach(b => b.onclick = () => setSettings({nav: move(nav, +b.dataset.navdn, 1)}));
  v.querySelectorAll('[data-navrm]').forEach(b => b.onclick = () => setSettings({nav: nav.filter(n => n !== b.dataset.navrm)}));
  v.querySelectorAll('[data-navadd]').forEach(b => b.onclick = () => setSettings({nav: [...nav, b.dataset.navadd]}));
  charts.length = 0;
}
function renderQuick(){
  const el = $('lifeQuick'); if (!el) return;
  const S = data.settings, nav = S.nav;
  const extra = [...['month', 'diary', 'stats', 'habits'].filter(n => !nav.includes(n)), ...S.sections.filter(s => s.on && !nav.includes(s.id)).map(s => s.id)];
  el.innerHTML = extra.length ? extra.map(n => `<a class="chip" href="#${n}"><svg viewBox="0 0 24 24">${ICON[n]}</svg>${SCREENS[n] === 'Sleep' ? 'Sleep' : SCREENS[n]}</a>`).join('') : '';
  el.hidden = !extra.length;
}

/* ---------- Routing ---------- */
const RENDER = {life: renderLife, workouts: renderWorkouts, cooking: renderCooking, money: renderMoney, sleep: renderSleep};
function refresh(){
  renderNav(); renderQuick();
  if (LIFE_VIEWS.includes(current)) {
    const ae = document.activeElement, inForm = ae && ae.closest && ae.closest('form') && $('lifeApp').contains(ae);
    if (inForm && ae.type !== 'submit') return; // don't wipe a form while typing; it re-renders after submit
    RENDER[current](); requestAnimationFrame(drawCharts);
  }
}
export function lifeRoute(v){
  current = v;
  renderNav(v); renderQuick();
  const isLife = LIFE_VIEWS.includes(v);
  $('lifeApp').hidden = !isLife;
  document.querySelector('main.app').hidden = isLife;
  if (!isLife) return false;
  for (const n of LIFE_VIEWS) $('v-' + n).classList.toggle('act', n === v);
  RENDER[v]();
  window.scrollTo(0, 0);
  requestAnimationFrame(drawCharts);
  return true;
}
export function initLife(c){
  ctx = c;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b || !$('lifeApp').contains(b)) return;
    const [col, id] = b.dataset.del.split(':');
    const old = data[col][id]; if (!old) return;
    delItem(col, id);
    ctx.toast('Deleted', () => putItem(col, id, old));
  });
  renderNav(); renderQuick();
}
