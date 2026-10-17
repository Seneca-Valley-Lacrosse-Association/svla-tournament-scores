// End-to-end check of the table report flow against a local dev server.
//   rm -rf .data
//   STORE=file REPORTS_STORE=file ORGANIZER_PASSCODE=test PORT=3000 node scripts/dev-server.mjs &
//   node scripts/test-reports.mjs
import { assess, slotIndexNow } from '../lib/report-rules.js';
import { SLOTS } from '../lib/schedule.js';

const base = process.env.BASE || 'http://localhost:3000';
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const post = async (path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const report = (gameId, field, a, b, clientId) => post('/api/report', { gameId, field, a, b, clientId: clientId || `test-${Math.random().toString(36).slice(2)}-${Date.now()}` });
const staff = (body) => post('/api/reports', body, { 'x-passcode': 'test' });
const state = async () => (await fetch(base + '/api/state?fresh=1')).json();
const list = async () => (await staff({ action: 'list' })).data.reports;

// 1. A clean report posts straight to the board.
let r = await report('V01', 1, 7, 5);
ok(r.data.outcome === 'published', 'clean report is published');
ok((await state()).scores.V01?.a === 7 && (await state()).scores.V01?.status === 'final', 'published score is on the board as final');

// 2. The same score again is a harmless duplicate.
r = await report('V01', 1, 7, 5);
ok(r.data.outcome === 'duplicate', 'same score again is treated as a duplicate');

// 3. A conflicting second report is held and does not change the board.
r = await report('V01', 1, 4, 3);
ok(r.data.outcome === 'held', 'conflicting report is held');
ok((await state()).scores.V01.a === 7, 'held report does not change the board');

// 4. Retry with the same clientId never creates a second row.
const cid = 'retry-test-client-id-1';
r = await report('V02', 2, 3, 3, cid);
const before = (await list()).length;
const r2 = await report('V02', 2, 3, 3, cid);
ok(r.data.outcome === 'held' && r2.data.outcome === 'held', 'tie is held, and a retry returns the same result');
ok((await list()).length === before, 'a retry does not add another report');

// 5. Wrong field, high score.
r = await report('V03', 4, 6, 4);
ok(r.data.outcome === 'held', 'report from the wrong field is held');
r = await report('V04', 2, 40, 2);
ok(r.data.outcome === 'held', 'unusually high score is held');

// 6. Validation.
r = await report('V05', 3, -1, 4);
ok(r.status === 400, 'negative score is rejected');
r = await report('NOPE', 3, 5, 4);
ok(r.status === 400, 'unknown game is rejected');
r = await post('/api/reports', { action: 'list' });
ok(r.status === 401, 'staff list needs the passcode');

// 7. Staff review.
const reps = await list();
const heldTie = reps.find((x) => x.game_id === 'V02' && x.status === 'held');
ok(!!heldTie && heldTie.flags.includes('tie'), 'held tie shows its flag');
r = await staff({ action: 'approve', id: heldTie.id });
ok(r.status === 400, 'approving a tied score as-is is refused');
r = await staff({ action: 'approve', id: heldTie.id, a: 6, b: 5 });
ok(r.status === 200 && (await state()).scores.V02.a === 6, 'approve with a corrected score posts it');
r = await staff({ action: 'approve', id: heldTie.id });
ok(r.status === 409, 'approving twice is refused');
const heldHigh = reps.find((x) => x.game_id === 'V04' && x.status === 'held');
r = await staff({ action: 'reject', id: heldHigh.id });
ok(r.status === 200 && !(await state()).scores.V04, 'reject keeps it off the board');

// 8. Undo removes a posted score, but not one staff changed afterwards.
const posted = (await list()).find((x) => x.game_id === 'V01' && x.status === 'published');
r = await staff({ action: 'undo', id: posted.id });
ok(r.status === 200 && !(await state()).scores.V01, 'undo removes the posted score');
r = await report('V06', 1, 9, 2);
const v06 = (await list()).find((x) => x.game_id === 'V06');
await post('/api/score', { gameId: 'V06', status: 'final', a: 9, b: 3 }, { 'x-passcode': 'test' });
r = await staff({ action: 'undo', id: v06.id });
ok(r.status === 409, 'undo is refused after a scorekeeper changed that score');

// 9. Per-game report limit.
for (let i = 0; i < 6; i++) r = await report('V07', 3, 10 + i, 1);
ok(r.status === 429, 'too many reports for one game are refused');

// 10. Time window rule (pure function): only on event day.
const day = (iso) => new Date(iso);
ok(slotIndexNow(SLOTS, day('2026-10-17T15:00:00Z')) === null, 'no time rule on other days');
ok(slotIndexNow(SLOTS, day('2026-10-18T13:30:00Z')) === 0, '9:30 AM on event day is slot 0');
ok(slotIndexNow(SLOTS, day('2026-10-18T12:00:00Z')) === -1, '8:00 AM on event day is before the first slot');
const g = { id: 'V09', slot: 3, field: 1 };
const early = assess({ game: g, field: 1, a: 5, b: 4, existing: undefined, prior: [], slots: SLOTS, now: day('2026-10-18T13:30:00Z') });
ok(early.includes('too-early'), 'a game that has not started yet is flagged');
const fine = assess({ game: g, field: 1, a: 5, b: 4, existing: undefined, prior: [], slots: SLOTS, now: day('2026-10-18T17:00:00Z') });
ok(fine.length === 0, 'a game in the current slot is clean');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
