import { esc, store, applyEdits, fetchSchedule, fetchState, gameCard, timeAgo, standings, FIELD_COLORS } from './shared.js';

const $ = (s) => document.querySelector(s);
const PASS_KEY = 'pc26-pass';
const ui = { view: 'scores', div: 'All', field: Number(store.get('pc26-sfield') || 0), hideFinal: false, teamsOpen: false };
let base;
let sched;
let state = { scores: {}, edits: {}, updatedAt: null };
let pass = '';
let editing = null;
let poll;

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
  document.querySelectorAll('[data-view]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === ui.view)));

  const divs = ['All', 'Varsity', 'JV'];
  $('#filters').innerHTML = `
    ${divs.map((d) => `<button class="chip" data-div="${d}" aria-pressed="${ui.div === d}">${d === 'All' ? 'All divisions' : d}</button>`).join('')}
    ${standView ? '' : `<span class="filter-label" style="width:100%">${editView ? 'Field' : 'My field'}</span>
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
document.addEventListener('toggle', (e) => { if (e.target.id === 'teams-card') ui.teamsOpen = e.target.open; }, true);

/* ---------- score editor ---------- */
const ed = $('#editor');
const clamp = (n) => Math.max(0, Math.min(99, n));
const num = (el) => { const n = parseInt(el.value, 10); return Number.isNaN(n) ? 0 : clamp(n); };

function openEditor(id) {
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
$('#ed-cancel').addEventListener('click', () => ed.close());

$('#ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = ed.querySelector('input[name=status]:checked')?.value;
  const btn = $('#ed-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('#ed-err').textContent = '';
  try {
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
