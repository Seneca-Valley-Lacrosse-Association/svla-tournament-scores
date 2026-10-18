import { esc, store, applyEdits, fetchSchedule, fetchState, trackVisit, slotClock, standings, gameCard, timeAgo, reportHeight, FIELD_COLORS } from './shared.js';

const $ = (s) => document.querySelector(s);
const ui = {
  tab: 'schedule',
  div: store.get('pc26-div') || 'All',
  team: store.get('pc26-team') || '',
  field: 0,
};
let base;
let sched;
let state = { scores: {}, edits: {}, updatedAt: null };
let stale = false;

function setStatus() {
  const changed = timeAgo(state.updatedAt);
  $('#status').innerHTML = `
    <span><span class="live-dot"></span>${changed ? `Last score update ${esc(changed)}` : 'No scores posted yet'}</span>
    ${stale ? '<span class="err">Connection issue — showing the last scores we have.</span>' : ''}`;
}

function renderFilters() {
  const teams = [...new Set(Object.values(sched.teams))].sort((a, b) => a.localeCompare(b));
  const divs = ['All', 'Varsity', 'JV'];
  $('#filters').innerHTML = `
    ${divs.map((d) => `<button class="chip" data-div="${d}" aria-pressed="${ui.div === d}">${d === 'All' ? 'All divisions' : d}</button>`).join('')}
    <label class="filter-label" for="team">Team</label>
    <select class="select" id="team"><option value="">All teams</option>${teams.map((t) => `<option ${t === ui.team ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    ${ui.tab === 'schedule' ? `
      <span class="filter-label" style="width:100%">Field</span>
      <button class="chip" data-field="0" aria-pressed="${ui.field === 0}">All</button>
      ${[1, 2, 3, 4].map((f) => `<button class="chip" data-field="${f}" aria-pressed="${ui.field === f}"><span class="dot" style="background:${FIELD_COLORS[f]}"></span>${f}</button>`).join('')}` : ''}`;
}

function renderSchedule() {
  const clock = slotClock(sched.slots);
  const games = sched.games.filter((g) =>
    (ui.div === 'All' || g.div === ui.div) &&
    (!ui.field || g.field === ui.field) &&
    (!ui.team || sched.teams[g.a] === ui.team || sched.teams[g.b] === ui.team));
  if (!games.length) return '<p class="empty">No games match these filters.</p>';
  let html = '';
  sched.slots.forEach((label, i) => {
    const inSlot = games.filter((g) => g.slot === i);
    if (!inSlot.length) return;
    const badge = clock.now === i ? '<span class="slot-badge">Now</span>' : clock.next === i ? '<span class="slot-badge next">Up next</span>' : '';
    html += `<section class="slot"><div class="slot-head"><h2>${esc(label)}</h2>${badge}</div>${inSlot.map((g) => gameCard(g, sched, state.scores, { team: ui.team })).join('')}</section>`;
  });
  html += `<section class="card"><h2>Fields</h2><div class="legend">${Object.entries(sched.fields).map(([n, name]) => `<div style="--fc:${FIELD_COLORS[n]}"><i></i><span><strong>Field ${n}</strong> · ${esc(name)}</span></div>`).join('')}</div></section>`;
  return html;
}

function renderStandings() {
  const table = standings(sched, state.scores);
  const active = sched.games.filter((g) => !g.cancelled);
  const played = active.filter((g) => state.scores[g.id]?.status === 'final').length;
  const divs = ui.div === 'All' ? ['Varsity', 'JV'] : [ui.div];
  let html = '';
  for (const d of divs) {
    const rows = table[d].filter((r) => !ui.team || r.name === ui.team);
    if (!rows.length) continue;
    html += `<section class="card"><h2>${d === 'JV' ? 'Junior Varsity' : 'Varsity'}</h2><table>
      <thead><tr><th>#</th><th>Team</th><th>GP</th><th>W-L-T</th><th>GF</th><th>GA</th><th>+/−</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.name === ui.team ? 'mine' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.gp}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td></tr>`).join('')}
      </tbody></table></section>`;
  }
  if (!html) html = '<p class="empty">No teams match these filters.</p>';
  return html + `<p class="note">${played ? `${played} of ${active.length} games final.` : 'Standings appear as games finish.'} Showcase games, so this table is informational: teams are listed by wins, then goal differential, then goals for. Only final scores count.</p>`;
}

function render() {
  renderFilters();
  setStatus();
  $('#app').innerHTML = ui.tab === 'schedule' ? renderSchedule() : renderStandings();
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === ui.tab)));
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  const div = e.target.closest('[data-div]');
  const field = e.target.closest('[data-field]');
  if (tab) ui.tab = tab.dataset.tab;
  else if (div) { ui.div = div.dataset.div; store.set('pc26-div', ui.div); }
  else if (field) ui.field = Number(field.dataset.field);
  else return;
  render();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'team') { ui.team = e.target.value; store.set('pc26-team', ui.team); render(); }
});

async function refresh() {
  try {
    state = await fetchState();
    sched = applyEdits(base, state.edits);
    stale = false;
  } catch { stale = true; }
  if (sched) render();
}

(async function init() {
  try {
    base = await fetchSchedule();
    sched = applyEdits(base, {});
  } catch {
    $('#app').innerHTML = '<p class="empty err">The schedule could not be loaded. Please check your connection and reload.</p>';
    return;
  }
  trackVisit('scores');
  await refresh();
  render();
  reportHeight();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
