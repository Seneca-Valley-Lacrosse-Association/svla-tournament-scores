// Decides whether a table's score report can go straight to the scoreboard or must wait for a person.
// Clean reports publish automatically. Anything unusual is held (not shown to parents) and flagged
// for a staff member to approve, edit, or reject in the Reports tab.

export const EVENT_DATE = '2026-10-18'; // America/New_York, same as public/shared.js
export const MAX_NORMAL_GOALS = 30;
export const MAX_REPORTS_PER_GAME = 6; // includes corrections
export const MAX_REPORTS_PER_IP_10MIN = 60; // venue Wi-Fi or cell towers can put several tables behind one address

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
