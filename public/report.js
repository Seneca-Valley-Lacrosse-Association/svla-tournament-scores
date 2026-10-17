// Table score report page: opened from the QR code taped to each scoring table (/report?field=3).
// No login. The worker taps a game, enters the final score, confirms, and sends.

import { esc, store, applyEdits, fetchSchedule, fetchState, FIELD_COLORS, EVENT_DATE } from './shared.js';

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
// The scoreboard is the source of truth. This phone's own record only covers two gaps:
//  - bridged: a score sent a moment ago, before the shared board has caught up (2 minutes)
//  - waiting: a score sent that staff are still reviewing (30 minutes, note only; the game stays on the list)
const bridged = (g) => { const m = sent[g.id]; return !!m && m.outcome !== 'held' && Date.now() - (m.at || 0) < 2 * 60 * 1000; };
const waiting = (g) => { const m = sent[g.id]; return !!m && m.outcome === 'held' && Date.now() - (m.at || 0) < 30 * 60 * 1000 && state.scores[g.id]?.status !== 'final'; };
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`);

// A score can be fixed from a table for 20 minutes after it first went up, then it locks.
// The server enforces this (LOCK_MINUTES in lib/report-rules.js); the page just stops offering "Edit score".
const LOCK_MS = 20 * 60 * 1000;
const PHONE = '6145229419';
const locked = (g) => { const t = Date.parse(state.scores[g.id]?.firstAt || ''); return Number.isFinite(t) && Date.now() - t > LOCK_MS; };
const lockedHtml = () => `<strong>This score is locked.</strong> If you see a mistake, please <a href="tel:${PHONE}">call</a> or <a href="sms:${PHONE}">text</a> Stretch at 614-522-9419.`;

// A game is overdue once its 50-minute slot has ended and it still has no score. Only on event day.
// (?asof=14:00 pretends it is 2:00 PM, for trying this page out before the event.)
const SLOT_MINUTES = 50;
const clockMinutes = (label) => {
  const m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(label || '');
  return m ? (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3].toUpperCase() === 'PM' ? 720 : 0) : null;
};
function minutesNow() {
  const asof = /^(\d{1,2}):(\d{2})$/.exec(params.get('asof') || '');
  if (asof) return Number(asof[1]) * 60 + Number(asof[2]);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  if (`${get('year')}-${get('month')}-${get('day')}` !== EVENT_DATE) return null;
  return Number(get('hour')) * 60 + Number(get('minute'));
}
const isOverdue = (g) => {
  const now = minutesNow();
  const start = clockMinutes(sched.slots[g.slot]);
  return now !== null && start !== null && start + SLOT_MINUTES <= now;
};

function fieldPicker() {
  $('#field-title').textContent = 'Report a score';
  $('#app').innerHTML = `<section class="card"><h2>Which field?</h2>
    <p class="note">Pick the field you are scoring.</p>
    <div class="field-grid">${[1, 2, 3, 4].map((f) => `<a class="btn field-btn" style="--fc:${FIELD_COLORS[f]}" href="/report?field=${f}">Field ${f}</a>`).join('')}</div></section>`;
}

function card(g, reported, late = false) {
  const A = esc(sched.teams[g.a]);
  const B = esc(sched.teams[g.b]);
  const s = state.scores[g.id];
  const shown = s?.status === 'final' ? s : bridged(g) ? sent[g.id] : null;
  const done = !!shown;
  const held = !done && waiting(g);
  const note = held
    ? `<span class="sub note">Received ${sent[g.id].a}\u2013${sent[g.id].b}. A staff member will confirm it.</span>`
    : done ? '<span class="sub">Final score sent</span>' : '';
  return `<article class="game${done ? ' sent' : ''}${late ? ' late' : ''}" style="--fc:${FIELD_COLORS[g.field]}">
    <div>
      <div class="team"><span class="tname">${A}</span><span class="pts">${done ? shown.a : '–'}</span></div>
      <div class="team"><span class="tname">${B}</span><span class="pts">${done ? shown.b : '–'}</span></div>
    </div>
    <div class="meta">
      <span class="pill ${done ? 'final' : late ? 'late' : 'up'}">${done ? 'Final' : late ? 'Score needed' : esc(sched.slots[g.slot])}</span>
      <span class="sub">${done || late ? `${esc(sched.slots[g.slot])} \u00b7 ` : ''}${g.div}</span>
      ${note}
      ${reported && done && locked(g) ? `<span class="sub note">${lockedHtml()}</span>`
        : reported || held ? `<button class="btn alt edit-btn" data-fix="${g.id}">Edit score</button>` : done ? '' : `<button class="btn edit-btn" data-report="${g.id}">Report final score</button>`}
    </div>
  </article>`;
}

function render() {
  if (!sched) return;
  $('#field-title').textContent = `Field ${field}`;
  const games = sched.games.filter((g) => g.field === field && !g.cancelled).sort((x, y) => x.slot - y.slot);
  const isDone = (g) => state.scores[g.id]?.status === 'final' || bridged(g);
  const pending = games.filter((g) => !isDone(g));
  const overdue = pending.filter((g) => isOverdue(g) && !waiting(g)); // slot is over and no score yet, shown first
  const todo = pending.filter((g) => !overdue.includes(g)).slice(0, 3);
  // Finished games stay listed for an hour after their score was posted, newest first, then drop off.
  const postedAt = (g) => {
    const mine = bridged(g) ? sent[g.id].at : 0;
    const board = Date.parse(state.scores[g.id]?.updatedAt || '') || 0;
    return Math.max(mine, board);
  };
  const finished = games
    .filter((g) => isDone(g) && Date.now() - postedAt(g) <= SHOW_FINISHED_MS)
    .sort((x, y) => postedAt(y) - postedAt(x))
    .slice(0, 3);
  let html = '';
  if (overdue.length) {
    html += `<section class="slot"><div class="slot-head"><h2 class="late-h">Score needed</h2></div>
      <p class="note">These games should be over. Please report the final score. If the game was not played, call Stretch at 614-522-9419.</p>
      ${overdue.map((g) => card(g, false, true)).join('')}</section>`;
  }
  if (todo.length) {
    html += `<section class="slot"><div class="slot-head"><h2>Next games</h2></div>${todo.map((g) => card(g, false)).join('')}</section>`;
  } else if (!overdue.length) {
    html += '<p class="empty">No more games to report on this field. Thank you!</p>';
  }
  if (finished.length) {
    html += `<section class="slot"><div class="slot-head"><h2>Recently reported <span class="sub">(last hour)</span></h2></div>${finished.map((g) => card(g, true)).join('')}
      <p class="note">Shows the last 3 games reported on this field. Entered the wrong score? Tap <strong>Edit score</strong> and send the right one. It replaces the old score right away. You can fix a score for 20 minutes after it is sent; after that it is locked, so please <a href="tel:${PHONE}">call</a> or <a href="sms:${PHONE}">text</a> Stretch at 614-522-9419.</p></section>`;
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
  $('#r-next').disabled = false; // a previous "locked" answer may have left Send switched off
  $('#r-title').textContent = `${sched.teams[current.a]} vs ${sched.teams[current.b]}`;
  $('#r-sub').textContent = `${current.div} · ${sched.slots[current.slot]} · Field ${current.field}`;
  $('#r-a').textContent = sched.teams[current.a];
  $('#r-b').textContent = sched.teams[current.b];
  // Fixing starts from the score that is showing now, so only the wrong number needs changing.
  const known = fix ? ((bridged(current) || waiting(current)) ? sent[id] : state.scores[id]?.status === 'final' ? state.scores[id] : null) : null;
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
  let lockedNow = false;
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
    if (err.code === 'locked') {
      // Trying again will not help. Keep Send switched off and show how to reach Stretch.
      lockedNow = true;
      $('#r-err').innerHTML = lockedHtml();
      load(); // refresh the list so this game stops offering "Edit score"
    } else if (err.code === 'limit') {
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
    btn.disabled = lockedNow;
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
