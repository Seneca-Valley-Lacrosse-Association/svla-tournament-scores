import { esc, store, applyEdits, fetchSchedule, fetchState, gameCard, timeAgo, standings, FIELD_COLORS } from './shared.js';

const $ = (s) => document.querySelector(s);
const PASS_KEY = 'pc26-pass';
const ui = { view: 'scores', div: 'All', field: Number(store.get('pc26-sfield') || 0), hideFinal: false, teamsOpen: false, linksOpen: false };
let base;
let sched;
let state = { scores: {}, edits: {}, updatedAt: null };
let pass = '';
let editing = null;
let poll;
let reports = [];
let reportsErr = '';

const ss = {
  get() { try { return sessionStorage.getItem(PASS_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? sessionStorage.setItem(PASS_KEY, v) : sessionStorage.removeItem(PASS_KEY); } catch { /* ignore */ } },
};

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-passcode': pass },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || 'Request failed'); e.status = r.status; throw e; }
  return data;
}

function setState(s) {
  state = { scores: s.scores || {}, edits: s.edits || {}, updatedAt: s.updatedAt || null };
  sched = applyEdits(base, state.edits);
}

const anyDialogOpen = () => ['#editor', '#gdlg', '#tdlg'].some((id) => $(id).open);

/* ---------- sign-in ---------- */
async function signIn(candidate) {
  pass = candidate;
  await api('/api/login');
  ss.set(pass);
  $('#gate').hidden = true;
  $('#board').hidden = false;
  base = base || await fetchSchedule();
  sched = sched || applyEdits(base, {});
  await refresh();
  render();
  clearInterval(poll);
  poll = setInterval(() => { if (!document.hidden && !anyDialogOpen()) refresh().then(render); }, 20000);
}

function signOut() {
  ss.set('');
  pass = '';
  clearInterval(poll);
  $('#board').hidden = true;
  $('#gate').hidden = false;
  $('#pass').value = '';
}

function sessionExpired() {
  ['#editor', '#gdlg', '#tdlg'].forEach((id) => { if ($(id).open) $(id).close(); });
  signOut();
  $('#gate-err').textContent = 'Your session expired. Please sign in again.';
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#gate-err').textContent = '';
  try { await signIn($('#pass').value.trim()); }
  catch (err) { $('#gate-err').textContent = err.message; }
});
$('#signout').addEventListener('click', signOut);

/* ---------- lists ---------- */
async function refresh() {
  try { setState(await fetchState(true)); } catch { toast('Could not refresh — check your connection.', true); }
  await refreshReports();
}

async function refreshReports() {
  try {
    reports = (await api('/api/reports', { action: 'list' })).reports || [];
    reportsErr = '';
  } catch (err) {
    if (err.status === 401) return;
    reportsErr = err.message;
  }
  const held = reports.filter((r) => r.status === 'held').length;
  const badge = $('#rep-badge');
  badge.textContent = held;
  badge.hidden = !held;
}

const FLAG_TEXT = {
  'wrong-field': 'Reported from a different field than scheduled',
  'already-final': 'Game already has a final score',
  'conflict': 'Another report has a different score',
  'tie': 'Tied final score (no tie allowed)',
  'high-score': 'Unusually high score',
  'too-early': 'Game has not reached its start time yet',
  'publish-failed': 'Could not post to the scoreboard',
};

function renderReports() {
  const name = (code) => sched.teams[code] || code;
  const clock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  };
  const shownScore = (r) => [r.approved_a ?? r.score_a, r.approved_b ?? r.score_b];
  const STATUS = { held: 'Waiting for you', published: 'Posted', approved: 'Approved', rejected: 'Rejected', undone: 'Undone', superseded: 'Replaced' };

  // One row per report, newest first inside its game.
  const row = (r, g, newest, multi) => {
    const [a, b] = shownScore(r);
    const edited = r.approved_a != null && (r.approved_a !== r.score_a || r.approved_b !== r.score_b);
    const flags = r.status === 'held' ? (r.flags || []).map((f) => `<span class="flag">${esc(FLAG_TEXT[f] || f)}</span>`).join('') : '';
    let actions = '';
    if (r.status === 'held') {
      const tie = r.score_a === r.score_b;
      actions = `${tie ? '' : `<button class="btn small" data-rapprove="${r.id}">${multi ? 'Use this score' : 'Approve'}</button>`}
        <button class="btn alt small" data-rpedit="${r.id}">Edit score</button>
        <button class="btn danger small" data-rpreject="${r.id}">Reject</button>`;
    } else if (r.status === 'published' || r.status === 'approved') {
      actions = `<button class="btn danger small" data-rpundo="${r.id}">Undo</button>`;
    }
    return `<div class="rep-row${newest && multi ? ' newest' : ''}">
      <div class="rep-top"><strong class="rep-score">${esc(name(g.a))} ${a} – ${b} ${esc(name(g.b))}</strong>
        ${newest && multi ? '<span class="tag-new">Newest</span>' : ''}<span class="pill-st st-${r.status}">${r.status === 'approved' && /^Edited by admin/.test(r.review_note || '') ? 'Admin edit' : STATUS[r.status] || esc(r.status)}</span></div>
      <div class="sub">Sent ${esc(clock(r.created_at))} (${esc(timeAgo(r.created_at) || '')})${edited ? ` · you changed it from ${r.score_a}–${r.score_b}` : ''}${r.review_note ? ` · ${esc(r.review_note)}` : ''}</div>
      ${flags ? `<div>${flags}</div>` : ''}
      ${actions ? `<div class="rep-actions">${actions}</div>` : ''}</div>`;
  };

  const gameCardHtml = (gameId, list) => {
    const g = sched.games.find((x) => x.id === gameId);
    if (!g) return '';
    const sorted = [...list].sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
    const multi = sorted.length > 1;
    const live = state.scores[gameId];
    const onBoard = live?.status === 'final' ? `On the board now: <strong>${live.a}–${live.b}</strong>` : 'Nothing on the board yet';
    return `<div class="report-card" style="--fc:${FIELD_COLORS[g.field]}">
      <div class="rep-head"><span class="fieldtag"><i></i>Field ${g.field}</span> <span class="sub">${esc(g.div)} · ${esc(sched.slots[g.slot])}</span>
        <button class="btn alt small rep-edit" data-rgame="${gameId}">Edit score</button></div>
      <div class="rep-game">${esc(name(g.a))} vs ${esc(name(g.b))}</div>
      <div class="sub">${onBoard}${multi ? ` · ${sorted.length} reports for this game` : ''}</div>
      ${sorted.map((r, i) => row(r, g, i === 0, multi)).join('')}</div>`;
  };

  // Group reports by game, then sort cards by their newest report.
  const byGame = new Map();
  for (const r of reports) (byGame.get(r.game_id) || byGame.set(r.game_id, []).get(r.game_id)).push(r);
  const newestAt = (list) => list.reduce((m, r) => ((r.created_at || '') > m ? r.created_at : m), '');
  const groups = [...byGame.entries()].sort((x, y) => newestAt(y[1]).localeCompare(newestAt(x[1])));
  const needs = groups.filter(([, l]) => l.some((r) => r.status === 'held'));
  const posted = groups.filter(([, l]) => !l.some((r) => r.status === 'held') && l.some((r) => r.status === 'published' || r.status === 'approved'));
  const closed = groups.filter(([, l]) => !l.some((r) => ['held', 'published', 'approved'].includes(r.status)));
  const heldCount = reports.filter((r) => r.status === 'held').length;

  // Cheat sheet: one tap copies a scoring table's report link, ready to paste into a text message.
  const linkFor = (f) => `${location.origin}/report${f ? `?field=${f}` : ''}`;
  const linkRow = (label, f, color) => `<div class="link-row" style="--fc:${color}">
      <div class="link-info"><strong>${esc(label)}</strong><span class="link-url">${esc(linkFor(f).replace(/^https?:\/\//, ''))}</span></div>
      <button class="btn small" type="button" data-copylink="${linkFor(f)}" data-copylabel="${esc(label)}">Copy link</button></div>`;
  let html = `<details class="card link-card" id="links-card"${ui.linksOpen ? ' open' : ''}>
    <summary>Scoring table links</summary>
    <p class="note">Need a score fixed or reported? Tap <strong>Copy link</strong>, then paste it into a text message. The link opens that field's score reporting page. No sign-in needed.</p>
    ${Object.keys(sched.fields).map((n) => linkRow(`Field ${n}`, n, FIELD_COLORS[n])).join('')}
    ${linkRow('Any field (picker)', 0, 'var(--line)')}</details>`;
  html += `<p class="note">Clean scores from the scoring tables post automatically. Anything unusual waits here for you. Held reports are <strong>not</strong> shown to parents until approved. When a game has more than one report, the newest is listed first.</p>`;
  html += `<div class="legend rep-legend">${Object.entries(sched.fields).map(([n, nm]) => `<div style="--fc:${FIELD_COLORS[n]}"><i></i><span><strong>Field ${n}</strong></span></div>`).join('')}</div>`;
  if (reportsErr) html += `<p class="err">${esc(reportsErr)}</p>`;
  html += `<h2 class="rep-h">Needs review (${heldCount})</h2>${needs.length ? needs.map(([id, l]) => gameCardHtml(id, l)).join('') : '<p class="empty">Nothing waiting. 🎃</p>'}`;
  html += `<h2 class="rep-h">Posted from tables (${posted.length})</h2>${posted.length ? posted.map(([id, l]) => gameCardHtml(id, l)).join('') : '<p class="empty">No table reports yet.</p>'}`;
  if (closed.length) html += `<h2 class="rep-h">Rejected and undone (${closed.length})</h2>${closed.map(([id, l]) => gameCardHtml(id, l)).join('')}`;
  html += `<div class="danger-zone"><h2 class="rep-h">Reset everything</h2>
    <p class="note">Sets every game back to not started and deletes all table report history. The schedule and teams are not changed. This cannot be undone.</p>
    <button class="btn danger" type="button" data-resetscores>Reset all scores and reports</button></div>`;
  return html;
}

const teamNo = (code) => parseInt(code.slice(2), 10) || 0;

function teamsCard() {
  const block = (pre, label) => {
    const rows = Object.entries(sched.teams).filter(([c]) => c.startsWith(pre)).sort((x, y) => teamNo(x[0]) - teamNo(y[0]));
    return `<div class="trow-head"><span>${label}</span><button class="btn alt small" type="button" data-tadd="${pre}">+ Add team</button></div>
      ${rows.map(([c, n]) => {
        const games = sched.games.filter((g) => g.a === c || g.b === c);
        const out = games.length > 0 && games.every((g) => g.cancelled);
        return `<div class="trow"><span>${esc(n)} <small>${c}</small>${out ? '<em>All games cancelled</em>' : ''}</span><button class="btn alt small" type="button" data-tedit="${c}">Edit</button></div>`;
      }).join('')}`;
  };
  return `<details class="card" id="teams-card"${ui.teamsOpen ? ' open' : ''}>
    <summary>Teams — rename, replace, withdraw or add</summary>
    ${block('VA', 'Varsity')}${block('JV', 'Junior Varsity')}
  </details>`;
}

function renderStandings() {
  const table = standings(sched, state.scores);
  const active = sched.games.filter((g) => !g.cancelled);
  const played = active.filter((g) => state.scores[g.id]?.status === 'final').length;
  const divs = ui.div === 'All' ? ['Varsity', 'JV'] : [ui.div];
  let html = '';
  for (const d of divs) {
    const rows = table[d];
    if (!rows.length) continue;
    html += `<section class="card"><h2>${d === 'JV' ? 'Junior Varsity' : 'Varsity'}</h2><table>
      <thead><tr><th>#</th><th>Team</th><th>GP</th><th>W-L-T</th><th>GF</th><th>GA</th><th>+/\u2212</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.gp}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td></tr>`).join('')}
      </tbody></table></section>`;
  }
  return html + `<p class="note">${played ? `${played} of ${active.length} games final.` : 'Standings appear as games finish.'} Teams are listed by wins, then goal differential, then goals for. Only final scores count.</p>`;
}

function render() {
  const editView = ui.view === 'edit';
  const standView = ui.view === 'standings';
  const repView = ui.view === 'reports';
  document.querySelectorAll('[data-view]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === ui.view)));

  const divs = ['All', 'Varsity', 'JV'];
  $('#filters').innerHTML = repView ? '' : `
    ${divs.map((d) => `<button class="chip" data-div="${d}" aria-pressed="${ui.div === d}">${d === 'All' ? 'All divisions' : d}</button>`).join('')}
    ${standView || repView ? '' : `<span class="filter-label" style="width:100%">${editView ? 'Field' : 'My field'}</span>
    <button class="chip" data-field="0" aria-pressed="${ui.field === 0}">All</button>
    ${[1, 2, 3, 4].map((f) => `<button class="chip" data-field="${f}" aria-pressed="${ui.field === f}"><span class="dot" style="background:${FIELD_COLORS[f]}"></span>${f}</button>`).join('')}
    ${editView ? '' : `<button class="chip" data-hidefinal="1" aria-pressed="${ui.hideFinal}">Hide finished</button>`}`}`;

  const active = sched.games.filter((g) => !g.cancelled);
  const finals = active.filter((g) => state.scores[g.id]?.status === 'final').length;
  const live = active.filter((g) => state.scores[g.id]?.status === 'live').length;
  const cancelled = sched.games.length - active.length;
  $('#count').textContent = `${finals} final · ${live} in progress · ${active.length - finals - live} to go${cancelled ? ` · ${cancelled} cancelled` : ''}`;
  const changed = timeAgo(state.updatedAt);
  $('#status').innerHTML = `<span><span class="live-dot"></span>${changed ? `Last update ${esc(changed)}` : 'No scores entered yet'}</span><span>Auto-refreshes every 20 seconds</span>`;

  const games = sched.games.filter((g) =>
    (ui.div === 'All' || g.div === ui.div) && (!ui.field || g.field === ui.field) &&
    !(!editView && ui.hideFinal && state.scores[g.id]?.status === 'final'));

  if (standView) { $('#app').innerHTML = renderStandings(); return; }
  if (repView) { $('#app').innerHTML = renderReports(); return; }

  let html = editView
    ? `<p class="note">Changes show on the parent page right away. Edit a team to rename or replace it everywhere, or edit a single game to move it, swap a team, or cancel it.</p><p><button class="btn" type="button" data-gadd="1">+ Add a game</button></p>${teamsCard()}`
    : '';
  sched.slots.forEach((label, i) => {
    const inSlot = games.filter((g) => g.slot === i);
    if (!inSlot.length) return;
    html += `<section class="slot"><div class="slot-head"><h2>${esc(label)}</h2></div>${inSlot.map((g) => gameCard(g, sched, state.scores, editView ? { schedEdit: true } : { editable: true })).join('')}</section>`;
  });
  if (!games.length) html += '<p class="empty">No games match these filters.</p>';
  if (editView && (Object.keys(state.edits.games || {}).length || Object.keys(state.edits.teams || {}).length || Object.keys(state.edits.table || {}).length || Object.keys(state.edits.added || {}).length)) {
    html += '<p class="resetall"><button class="btn danger" type="button" data-resetall="1">Reset all schedule changes</button></p>';
  }
  $('#app').innerHTML = html;
}

// Copy a link to the clipboard. Falls back to a hidden textarea for browsers that block the Clipboard API.
async function copyLink(url, label) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    }
    toast(`${label} link copied`);
  } catch {
    window.prompt('Copy this link:', url);
  }
}

// Two-tap confirmation for destructive buttons (no browser pop-ups).
let armed = { key: null, t: 0 };
function confirmTap(btn, key, armedText) {
  const now = Date.now();
  if (armed.key === key && now - armed.t < 5000) { armed = { key: null, t: 0 }; return true; }
  armed = { key, t: now };
  btn.dataset.orig = btn.dataset.orig || btn.textContent;
  btn.textContent = armedText;
  setTimeout(() => {
    if (armed.key === key && btn.isConnected) { btn.textContent = btn.dataset.orig; armed = { key: null, t: 0 }; }
  }, 5000);
  return false;
}

document.addEventListener('click', async (e) => {
  const view = e.target.closest('[data-view]');
  const div = e.target.closest('[data-div]');
  const field = e.target.closest('[data-field]');
  const hf = e.target.closest('[data-hidefinal]');
  const edit = e.target.closest('[data-edit]');
  const gedit = e.target.closest('[data-gedit]');
  const tedit = e.target.closest('[data-tedit]');
  const tadd = e.target.closest('[data-tadd]');
  const resetAll = e.target.closest('[data-resetall]');
  const gadd = e.target.closest('[data-gadd]');
  const rapprove = e.target.closest('[data-rapprove]');
  const rreject = e.target.closest('[data-rpreject]');
  const rundo = e.target.closest('[data-rpundo]');
  const resetScores = e.target.closest('[data-resetscores]');
  const redit = e.target.closest('[data-rpedit]');
  const rgame = e.target.closest('[data-rgame]');
  const copyBtn = e.target.closest('[data-copylink]');
  if (copyBtn) return copyLink(copyBtn.dataset.copylink, copyBtn.dataset.copylabel);
  if (resetScores) return resetEverything();
  if (rapprove) return reportAction('approve', rapprove.dataset.rapprove);
  if (rreject) return reportAction('reject', rreject.dataset.rpreject, rreject, 'Tap again to reject');
  if (rundo) return reportAction('undo', rundo.dataset.rpundo, rundo, 'Tap again to undo');
  if (redit) return openReportEdit(redit.dataset.rpedit);
  if (rgame) return openGameScoreEdit(rgame.dataset.rgame);
  if (view) ui.view = view.dataset.view;
  else if (div) ui.div = div.dataset.div;
  else if (field) { ui.field = Number(field.dataset.field); store.set('pc26-sfield', String(ui.field)); }
  else if (hf) ui.hideFinal = !ui.hideFinal;
  else if (edit) return openEditor(edit.dataset.edit);
  else if (gedit) return openGame(gedit.dataset.gedit);
  else if (tedit) return openTeam('rename', tedit.dataset.tedit);
  else if (tadd) return openTeam('add', tadd.dataset.tadd);
  else if (gadd) return openGame(null);
  else if (resetAll) {
    if (!confirmTap(resetAll, 'resetall', 'Tap again to confirm')) return;
    try { setState(await api('/api/edit', { type: 'resetAll' })); render(); toast('Schedule reset to the original'); }
    catch (err) { if (err.status === 401) sessionExpired(); else toast(err.message, true); }
    return;
  } else return;
  render();
});
async function resetEverything() {
  if (!window.confirm('Are you sure?\n\nThis sets EVERY score to zero (not started) and deletes ALL table report history. Parents will see an empty scoreboard. This cannot be undone.')) return;
  if (!window.confirm('Last check: reset all scores and reports now?')) return;
  try {
    await api('/api/reports', { action: 'reset', confirm: 'RESET' });
    setState(await fetchState(true));
    await refreshReports();
    render();
    toast('Everything reset: all scores cleared, reports deleted');
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else toast(err.message, true);
  }
}
async function reportAction(action, id, btn, armText, extra = {}) {
  if (btn && !confirmTap(btn, `${action}:${id}`, armText)) return;
  try {
    await api('/api/reports', { action, id, ...extra });
    setState(await fetchState(true));
    await refreshReports();
    render();
    toast(action === 'undo' ? 'Score removed from the board' : action === 'reject' ? 'Report rejected' : 'Posted to the scoreboard');
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else toast(err.message, true);
  }
}

/* Edit a held report's score, then approve it. Reuses the score editor sheet. */
let reportEditing = null;
let gameScoreEditing = null; // game id when an admin edits a game's score from the Reports tab
function openGameScoreEdit(gameId) {
  const g = sched.games.find((x) => x.id === gameId);
  const live = state.scores[gameId]?.status === 'final' ? state.scores[gameId] : null;
  const latest = [...reports].filter((r) => r.game_id === gameId).sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''))[0];
  reportEditing = null;
  gameScoreEditing = gameId;
  editing = g;
  $('#ed-title').textContent = `${sched.teams[g.a]} vs ${sched.teams[g.b]}`;
  $('#ed-sub').textContent = 'Admin edit: sets the final score and is recorded in this game\u2019s history.';
  $('#ed-a').textContent = sched.teams[g.a];
  $('#ed-b').textContent = sched.teams[g.b];
  $('#ed-ain').value = live ? live.a : (latest ? (latest.approved_a ?? latest.score_a) : 0);
  $('#ed-bin').value = live ? live.b : (latest ? (latest.approved_b ?? latest.score_b) : 0);
  ed.querySelectorAll('input[name=status]').forEach((x) => { x.checked = x.value === 'final'; });
  $('#ed-err').textContent = '';
  ed.showModal();
}
function openReportEdit(id) {
  gameScoreEditing = null;
  const r = reports.find((x) => x.id === id);
  const g = sched.games.find((x) => x.id === r.game_id);
  reportEditing = r;
  editing = g;
  $('#ed-title').textContent = `${sched.teams[g.a]} vs ${sched.teams[g.b]}`;
  $('#ed-sub').textContent = 'Fix the final score, then Save to approve it.';
  $('#ed-a').textContent = sched.teams[g.a];
  $('#ed-b').textContent = sched.teams[g.b];
  $('#ed-ain').value = r.score_a;
  $('#ed-bin').value = r.score_b;
  ed.querySelectorAll('input[name=status]').forEach((x) => { x.checked = x.value === 'final'; });
  $('#ed-err').textContent = '';
  ed.showModal();
}

document.addEventListener('toggle', (e) => { if (e.target.id === 'teams-card') ui.teamsOpen = e.target.open; if (e.target.id === 'links-card') ui.linksOpen = e.target.open; }, true);

/* ---------- score editor ---------- */
const ed = $('#editor');
const clamp = (n) => Math.max(0, Math.min(99, n));
const num = (el) => { const n = parseInt(el.value, 10); return Number.isNaN(n) ? 0 : clamp(n); };

function openEditor(id) {
  reportEditing = null;
  gameScoreEditing = null;
  const g = sched.games.find((x) => x.id === id);
  const s = state.scores[id];
  editing = g;
  $('#ed-title').textContent = `${sched.teams[g.a]} vs ${sched.teams[g.b]}`;
  $('#ed-sub').textContent = `${g.div} · ${sched.slots[g.slot]} · Field ${g.field} · Table: ${sched.table[g.field]?.[g.slot] || '—'}`;
  $('#ed-a').textContent = sched.teams[g.a];
  $('#ed-b').textContent = sched.teams[g.b];
  $('#ed-ain').value = s ? s.a : 0;
  $('#ed-bin').value = s ? s.b : 0;
  const status = s ? s.status : 'live';
  ed.querySelectorAll('input[name=status]').forEach((r) => { r.checked = r.value === status; });
  $('#ed-err').textContent = '';
  ed.showModal();
}

ed.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (!step) return;
  const [side, d] = step.dataset.step.split(':');
  const input = $(side === 'a' ? '#ed-ain' : '#ed-bin');
  input.value = clamp(num(input) + Number(d));
  // Entering a score on a not-started game means it is under way.
  const chosen = ed.querySelector('input[name=status]:checked');
  if (chosen?.value === 'scheduled') ed.querySelector('input[value=live]').checked = true;
});
$('#ed-cancel').addEventListener('click', () => { reportEditing = null; gameScoreEditing = null; ed.close(); });

$('#ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = ed.querySelector('input[name=status]:checked')?.value;
  const btn = $('#ed-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('#ed-err').textContent = '';
  try {
    if (gameScoreEditing) {
      await api('/api/reports', { action: 'edit', gameId: gameScoreEditing, a: num($('#ed-ain')), b: num($('#ed-bin')) });
      gameScoreEditing = null;
      setState(await fetchState(true));
      await refreshReports();
      ed.close();
      render();
      toast('Score updated and recorded as an admin edit');
      return;
    }
    if (reportEditing) {
      // Keep reportEditing until the save succeeds, so a retry after an error still approves this report.
      await api('/api/reports', { action: 'approve', id: reportEditing.id, a: num($('#ed-ain')), b: num($('#ed-bin')) });
      reportEditing = null;
      setState(await fetchState(true));
      await refreshReports();
      ed.close();
      render();
      toast('Posted to the scoreboard');
      return;
    }
    const res = await api('/api/score', { gameId: editing.id, status, a: num($('#ed-ain')), b: num($('#ed-bin')) });
    setState(res);
    ed.close();
    render();
    toast(status === 'scheduled' ? 'Score cleared' : 'Saved');
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else $('#ed-err').textContent = `${err.message} Your entry is still here — tap Save to retry.`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

/* ---------- schedule editing: shared submit ---------- */
async function submitEdit(body, dlg, errEl, btn) {
  btn.disabled = true;
  errEl.textContent = '';
  try {
    setState(await api('/api/edit', body));
    dlg.close();
    render();
    toast('Saved — parents can see it now');
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- game editor ---------- */
const gd = $('#gdlg');
let tableTouched = false;

function teamOptions(div, selected) {
  const pre = div === 'Varsity' ? 'VA' : 'JV';
  return Object.entries(sched.teams)
    .filter(([c]) => c.startsWith(pre))
    .sort((x, y) => x[1].localeCompare(y[1]))
    .map(([c, n]) => `<option value="${c}"${c === selected ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function syncTable() {
  if (tableTouched) return;
  $('#g-table').value = sched.table[$('#g-field').value]?.[$('#g-slot').value] || '';
}

function fillTeams(div, a, b) {
  $('#g-a').innerHTML = teamOptions(div, a);
  $('#g-b').innerHTML = teamOptions(div, b);
}

// id = an existing game, or null to add a new one.
function openGame(id) {
  const g = id ? sched.games.find((x) => x.id === id) : null;
  editing = g;
  tableTouched = false;
  const first = g || { div: 'Varsity', slot: 0, field: 1 };
  $('#g-divrow').hidden = !!g;
  $('#g-div').value = first.div;
  $('#g-cancelrow').hidden = !g;
  $('#g-title').textContent = g ? `${g.div} game${g.added ? ' (added)' : ''}` : 'Add a game';
  $('#g-sub').textContent = g
    ? `Currently ${sched.slots[g.slot]} \u00b7 Field ${g.field}`
    : 'Added games show on the parent page, can be scored like any other game, and appear in standings.';
  if (g) fillTeams(g.div, g.a, g.b);
  else {
    fillTeams('Varsity');
    $('#g-b').selectedIndex = Math.min(1, $('#g-b').options.length - 1);
  }
  $('#g-slot').innerHTML = sched.slots.map((l, i) => `<option value="${i}"${i === first.slot ? ' selected' : ''}>${esc(l)}</option>`).join('');
  $('#g-field').innerHTML = Object.entries(sched.fields).map(([n, name]) => `<option value="${n}"${Number(n) === first.field ? ' selected' : ''}>Field ${n} \u00b7 ${esc(name)}</option>`).join('');
  $('#g-table').value = sched.table[first.field]?.[first.slot] || '';
  $('#g-cancel').checked = g ? g.cancelled : false;
  $('#g-note').value = g ? g.note || '' : '';
  $('#g-err').textContent = '';
  const reset = $('#g-reset');
  reset.hidden = !(g && g.changed);
  reset.textContent = g?.added ? 'Delete this game' : 'Reset this game to the original schedule';
  delete reset.dataset.orig;
  gd.showModal();
}

$('#g-div').addEventListener('change', () => fillTeams($('#g-div').value));
$('#g-slot').addEventListener('change', syncTable);
$('#g-field').addEventListener('change', syncTable);
$('#g-table').addEventListener('input', () => { tableTouched = true; });
$('#g-close').addEventListener('click', () => gd.close());

$('#g-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fields = {
    a: $('#g-a').value,
    b: $('#g-b').value,
    slot: Number($('#g-slot').value),
    field: Number($('#g-field').value),
    note: $('#g-note').value,
    table: $('#g-table').value,
  };
  const body = editing
    ? { type: 'game', id: editing.id, cancelled: $('#g-cancel').checked, ...fields }
    : { type: 'addGame', div: $('#g-div').value, ...fields };
  submitEdit(body, gd, $('#g-err'), $('#g-save'));
});

$('#g-reset').addEventListener('click', (e) => {
  const del = editing.added;
  if (!confirmTap(e.currentTarget, 'g-reset', del ? 'Tap again to delete this game' : 'Tap again to confirm reset')) return;
  submitEdit({ type: del ? 'deleteGame' : 'resetGame', id: editing.id }, gd, $('#g-err'), $('#g-save'));
});

/* ---------- team editor ---------- */
const td = $('#tdlg');
let teamMode = null; // { mode: 'rename'|'add', code|pre }

function openTeam(mode, key) {
  teamMode = { mode, key };
  const withdraw = $('#t-withdraw');
  $('#t-err').textContent = '';
  withdraw.textContent = 'Team withdrew – cancel all their games';
  delete withdraw.dataset.orig;
  const del = $('#t-delete');
  del.hidden = true;
  del.textContent = 'Delete this team';
  delete del.dataset.orig;
  if (mode === 'rename') {
    del.hidden = !!base.teams[key]; // only teams added here can be deleted
    $('#t-title').textContent = 'Edit team';
    $('#t-sub').textContent = `${sched.teams[key]} (${key})`;
    $('#t-name').value = sched.teams[key];
    $('#t-hint').textContent = 'Type a new name to rename the team or replace it with a different school. Every game it is in updates, and so does the score-table list.';
    withdraw.hidden = false;
  } else {
    $('#t-title').textContent = `Add a ${key === 'VA' ? 'Varsity' : 'JV'} team`;
    $('#t-sub').textContent = 'The new team appears in filters and standings. Then use Edit game to put it in a game.';
    $('#t-name').value = '';
    $('#t-hint').textContent = '';
    withdraw.hidden = true;
  }
  td.showModal();
}

$('#t-close').addEventListener('click', () => td.close());
$('#t-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#t-name').value;
  const body = teamMode.mode === 'rename'
    ? { type: 'team', code: teamMode.key, name }
    : { type: 'addTeam', div: teamMode.key, name };
  submitEdit(body, td, $('#t-err'), $('#t-save'));
});
$('#t-delete').addEventListener('click', (e) => {
  if (!confirmTap(e.currentTarget, 't-delete', 'Tap again to delete this team')) return;
  submitEdit({ type: 'deleteTeam', code: teamMode.key }, td, $('#t-err'), $('#t-save'));
});
$('#t-withdraw').addEventListener('click', (e) => {
  if (!confirmTap(e.currentTarget, 't-withdraw', 'Tap again to cancel their games')) return;
  submitEdit({ type: 'cancelTeam', code: teamMode.key }, td, $('#t-err'), $('#t-save'));
});

/* ---------- start ---------- */
(async () => {
  const saved = ss.get();
  if (saved) { try { await signIn(saved); } catch { signOut(); } }
})();
