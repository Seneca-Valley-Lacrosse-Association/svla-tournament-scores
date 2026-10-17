// Decides whether a table's score report can go straight to the scoreboard or must wait for a person.
// Clean reports publish automatically. Anything unusual is held (not shown to parents) and flagged
// for a staff member to approve, edit, or reject in the Reports tab.

export const EVENT_DATE = '2026-10-18'; // America/New_York, same as public/shared.js
export const MAX_NORMAL_GOALS = 30;
export const MAX_REPORTS_PER_GAME = 6; // includes corrections
export const MAX_REPORTS_PER_IP_10MIN = 60; // venue Wi-Fi or cell towers can put several tables behind one address
export const LOCK_MINUTES = 20; // a table worker can fix a score for this long after the game's first report posted
export const LOCK_MS = LOCK_MINUTES * 60 * 1000;

// When did this game's score first go up? The earliest report that was posted (published, approved, or since
// replaced). Held, rejected and undone reports never reached the board, so they do not start the clock.
// Corrections do not restart it. Returns a time in ms, or null if nothing has been posted yet.
export function firstPostedAt(reports) {
  const times = reports
    .filter((r) => r.status === 'published' || r.status === 'approved' || r.status === 'superseded')
    .map((r) => Date.parse(r.created_at))
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.min(...times) : null;
}

// Table workers can no longer change a game's score once LOCK_MINUTES have passed since it was first posted.
// Staff changes in the Scores and Reports tabs are not subject to this.
export function isScoreLocked(reports, now = Date.now()) {
  const first = firstPostedAt(reports);
  return first !== null && now - first > LOCK_MS;
}

export const FLAG_TEXT = {
  'wrong-field': 'Reported from a different field than the game is scheduled on',
  'already-final': 'The game already has a final score',
  'conflict': 'Another report for this game has a different score',
  'tie': 'Final score is a tie (Braveheart games should not end in a tie)',
  'high-score': `A team score is above ${MAX_NORMAL_GOALS}`,
  'too-early': 'The game has not reached its scheduled start time yet',
  'publish-failed': 'Could not post to the scoreboard; needs a manual check',
};

function minutes(label) {
  const [, h, m, ap] = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(label);
  return (Number(h) % 12) * 60 + Number(m) + (ap.toUpperCase() === 'PM' ? 720 : 0);
}

// On event day only: index of the latest slot that has started (-1 before the first). Otherwise null.
export function slotIndexNow(slots, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  if (`${get('year')}-${get('month')}-${get('day')}` !== EVENT_DATE) return null;
  const now = Number(get('hour')) * 60 + Number(get('minute'));
  let idx = -1;
  slots.forEach((label, i) => { if (minutes(label) <= now) idx = i; });
  return idx;
}

export function toScore(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

// game: effective game (after staff edits); existing: live score entry or undefined;
// prior: earlier reports for this game that are still in play.
export function assess({ game, field, a, b, existing, prior, slots, now = new Date() }) {
  const flags = [];
  if (Number(field) !== Number(game.field)) flags.push('wrong-field');
  if (existing?.status === 'final') flags.push('already-final');
  if (prior.some((r) => (r.status === 'published' || r.status === 'approved' || r.status === 'held') && (r.score_a !== a || r.score_b !== b))) flags.push('conflict');
  if (a === b) flags.push('tie');
  if (Math.max(a, b) > MAX_NORMAL_GOALS) flags.push('high-score');
  const idx = slotIndexNow(slots, now);
  if (idx !== null && game.slot > idx) flags.push('too-early');
  return flags;
}
