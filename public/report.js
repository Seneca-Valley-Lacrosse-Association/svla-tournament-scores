// Table score report page: opened from the QR code taped to each scoring table (/report?field=3).
// No login. The worker taps a game, enters the final score, confirms, and sends.

import { esc, store, applyEdits, fetchSchedule, fetchState, FIELD_COLORS } from './shared.js';

const $ = (s) => document.querySelector(s);
const SENT_KEY = 'pc26-reported';
const SHOW_FINISHED_MS = 60 * 60 * 1000; // how long a finished game stays under "Recently reported"
const params = new URLSearchParams(location.search);
const field = Number(params.get('field'));

let base;
let sched;
let state = { scores: {}, edits: {} };
let sent = {}; // gameId -> { a, b, outcome } for reports sent from this phone
let current = null; // game being reported
let clientId = null; // one id per attempt, so a retry can never create a duplicate
let step = 'enter';
let busy = false;
let fixing = false; // true while correcting a score that was already reported

try { sent = JSON.parse(store.get(SENT_KEY) || '{}'); } catch { sent = {}; }
const saveSent = () => store.set(SENT_KEY, JSON.stringify(sent));
// A report sent from this phone shows as sent for a short while, until the shared scoreboard catches up.
// Held reports (waiting for staff) show for the full hour. Staff can undo or fix a score, so the server wins after that.
const recent = (m) => m && Date.now() - (m.at || 0) < (m.outcome === 'held' ? SHOW_FINISHED_MS : 2 * 60 * 1000);
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`);

function fieldPicker() {
  $('#field-title').textContent = 'Report a score';
  $('#app').innerHTML = `<section class="card"><h2>Which field?</h2>
    <p class="note">Pick the field you are scoring.</p>
    <div class="field-grid">${[1, 2, 3, 4].map((f) => `<a class="btn field-btn" style="--fc:${FIELD_COLORS[f]}" href="/report?field=${f}">Field ${f}</a>`).join('')}</div></section>`;
}

function card(g, reported) {
  const A = esc(sched.teams[g.a]);
  const B = esc(sched.teams[g.b]);
  const s = state.scores[g.id];
  const mine = recent(sent[g.id]) ? sent[g.id] : null;
  const shown = mine || (s?.status === 'final' ? s : null);
  const done = !!shown;
  const note = mine?.outcome === 'held'
    ? '<span class="sub note">Received. A staff member will confirm it.</span>'
    : done ? '<span class="sub">Final score sent</span>' : '';
  return `<article class="game${done ? ' sent' : ''}" style="--fc:${FIELD_COLORS[g.field]}">
    <div>
      <div class="team"><span class="tname">${A}</span><span class="pts">${done ? shown.a : '–'}</span></div>
      <div class="team"><span class="tname">${B}</span><span class="pts">${done ? shown.b : '–'}</span></div>
    </div>
    <div class="meta">
      <span class="pill ${done ? 'final' : 'up'}">${done ? 'Final' : esc(sched.slots[g.slot])}</span>
      <span class="sub">${done ? `${esc(sched.slots[g.slot])} \u00b7 ` : ''}${g.div}</span>
      ${note}
      ${reported ? `<button class="btn alt edit-btn" data-fix="${g.id}">Edit score</button>` : done ? '' : `<button class="btn edit-btn" data-report="${g.id}">Report final score</button>`}
    </div>
  </article>`;
}

function render() {
  if (!sched) return;
  $('#field-title').textContent = `Field ${field}`;
  const games = sched.games.filter((g) => g.field === field && !g.cancelled).sort((x, y) => x.slot - y.slot);
  const isDone = (g) => recent(sent[g.id]) || state.scores[g.id]?.status === 'final';
  const todo = games.filter((g) => !isDone(g)).slice(0, 3);
  // Finished games stay listed for an hour after their score was posted, newest first, then drop off.
  const postedAt = (g) => {
    const mine = recent(sent[g.id]) ? sent[g.id].at : 0;
    const board = Date.parse(state.scores[g.id]?.updatedAt || '') || 0;
    return Math.max(mine, board);
  };
  const finished = games
    .filter((g) => isDone(g) && Date.now() - postedAt(g) <= SHOW_FINISHED_MS)
    .sort((x, y) => postedAt(y) - postedAt(x))
    .slice(0, 3);
  let html = '';
  if (todo.length) {
    html += `<section class="slot"><div class="slot-head"><h2>Next games</h2></div>${todo.map((g) => card(g, false)).join('')}</section>`;
  } else {
    html += '<p class="empty">No more games to report on this field. Thank you!</p>';
  }
  if (finished.length) {
    html += `<section class="slot"><div class="slot-head"><h2>Recently reported <span class="sub">(last hour)</span></h2></div>${finished.map((g) => card(g, true)).join('')}
      <p class="note">Shows the last 3 games reported on this field. Entered the wrong score? Tap <strong>Edit score</strong> and send the right one. It replaces the old score right away. Need more help? Call Stretch at 614-522-9419.</p></section>`;
  }
  $('#app').innerHTML = html;
}

async function load() {
  try {
    base = base || await fetchSchedule();
    state = await fetchState(false);
    sched = applyEdits(base, state.edits);
  } catch {
    if (!sched) { $('#app').innerHTML = '<p class="err">Could not load the games. Check your signal and reload, or call 614-522-9419.</p>'; return; }
  }
  render();
}

/* ---------- report sheet ---------- */
const dlg = $('#rdlg');
const clamp = (n) => Math.max(0, Math.min(99, n));
const num = (el) => { const n = parseInt(el.value, 10); return Number.isNaN(n) ? 0 : clamp(n); };

function setStep(next) {
  step = next;
  $('#r-enter').hidden = next !== 'enter';
  $('#r-confirm').hidden = next === 'enter';
  $('#r-back').textContent = next === 'enter' ? 'Cancel' : 'Back';
  $('#r-next').textContent = next === 'enter' ? 'Next' : 'Send final score';
  $('#r-err').textContent = '';
}

function openReport(id, fix = false) {
  current = sched.games.find((g) => g.id === id);
  fixing = fix;
  clientId = newId();
  $('#r-title').textContent = `${sched.teams[current.a]} vs ${sched.teams[current.b]}`;
  $('#r-sub').textContent = `${current.div} · ${sched.slots[current.slot]} · Field ${current.field}`;
  $('#r-a').textContent = sched.teams[current.a];
  $('#r-b').textContent = sched.teams[current.b];
  // Fixing starts from the score that is showing now, so only the wrong number needs changing.
  const known = fix ? (recent(sent[id]) ? sent[id] : (state.scores[id]?.status === 'final' ? state.scores[id] : null)) : null;
  $('#r-ain').value = known ? known.a : 0;
  $('#r-bin').value = known ? known.b : 0;
  $('#r-hint').innerHTML = fix
    ? 'This <strong>replaces</strong> the score that was sent before. Check it, then send.'
    : 'This is the <strong>final</strong> score for the game. Check it, then send.';
  $('#r-sub').textContent = `${fix ? 'Edit score \u00b7 ' : ''}${current.div} \u00b7 ${sched.slots[current.slot]} \u00b7 Field ${current.field}`;
  setStep('enter');
  dlg.showModal();
}

dlg.addEventListener('click', (e) => {
  const st = e.target.closest('[data-step]');
  if (!st || step !== 'enter') return;
  const [side, d] = st.dataset.step.split(':');
  const input = $(side === 'a' ? '#r-ain' : '#r-bin');
  input.value = clamp(num(input) + Number(d));
});

$('#r-back').addEventListener('click', () => { if (step === 'confirm' && !busy) setStep('enter'); else if (!busy) dlg.close(); });

$('#r-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const a = num($('#r-ain'));
  const b = num($('#r-bin'));
  if (step === 'enter') {
    $('#r-line').innerHTML = `<span>${esc(sched.teams[current.a])}</span> <strong>${a}</strong><br><span>${esc(sched.teams[current.b])}</span> <strong>${b}</strong>`;
    setStep('confirm');
    return;
  }
  busy = true;
  const btn = $('#r-next');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  $('#r-err').textContent = '';
  try {
    const r = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: current.id, field, a, b, clientId, correction: fixing }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const er = new Error(data.error || 'Could not send.'); er.code = data.code; throw er; }
    sent[current.id] = { a, b, outcome: data.outcome === 'held' ? 'held' : 'published', at: Date.now() };
    saveSent();
    dlg.close();
    render();
    toast(data.outcome === 'held' ? 'Received. Staff will confirm it.' : fixing ? 'Score updated. Thank you!' : 'Sent. Thank you!');
  } catch (err) {
    if (err.code === 'limit') {
      // Trying again will not help; point them to the phone number instead.
      $('#r-err').innerHTML = `${esc(err.message).replace('the number on the sheet', '<a href="tel:6145229419">614-522-9419</a>')}`;
    } else if (err.code === 'tie') {
      setStep('enter');
      $('#r-err').innerHTML = `${esc(err.message).replace('614-522-9419', '<a href="tel:6145229419">614-522-9419</a>')}`;
    } else {
      $('#r-err').textContent = `${err.message || 'Could not send.'} Your score is still here. Tap Send to try again.`;
    }
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = step === 'enter' ? 'Next' : 'Send final score';
  }
});

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.setAttribute('role', 'status');
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-report]');
  if (b) { openReport(b.dataset.report); return; }
  const f = e.target.closest('[data-fix]');
  if (f) openReport(f.dataset.fix, true);
});

/* ---------- start ---------- */
if (![1, 2, 3, 4].includes(field)) fieldPicker();
else {
  load();
  setInterval(() => { if (!document.hidden && !dlg.open) load(); }, 30000);
}
