import { GAME_IDS } from '../lib/schedule.js';
import { checkPasscode } from '../lib/auth.js';
import { mutate } from '../lib/store.js';
import { json } from '../lib/http.js';

class UnknownGame extends Error {}
const STATUSES = new Set(['scheduled', 'live', 'final']);
const NO_STORE = { 'Cache-Control': 'no-store' };

function toScore(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

export async function POST(request) {
  const auth = await checkPasscode(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status, NO_STORE);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400, NO_STORE);
  }

  const { gameId, status } = body || {};
  if (typeof gameId !== 'string') return json({ error: 'Unknown game.' }, 400, NO_STORE);
  if (!STATUSES.has(status)) return json({ error: 'Unknown status.' }, 400, NO_STORE);

  let a = null;
  let b = null;
  if (status !== 'scheduled') {
    a = toScore(body.a);
    b = toScore(body.b);
    if (a === null || b === null) return json({ error: 'Scores must be whole numbers from 0 to 99.' }, 400, NO_STORE);
  }

  try {
    const next = await mutate((s) => {
      if (!GAME_IDS.has(gameId) && !s.edits?.added?.[gameId]) throw new UnknownGame();
      if (status === 'scheduled') delete s.scores[gameId];
      else s.scores[gameId] = { a, b, status, updatedAt: new Date().toISOString() };
      return s;
    });
    return json({ ok: true, scores: next.scores, edits: next.edits, updatedAt: next.updatedAt }, 200, NO_STORE);
  } catch (e) {
    if (e instanceof UnknownGame) return json({ error: 'Unknown game.' }, 400, NO_STORE);
    console.error('score write failed', e);
    return json({ error: 'Could not save. Please try again.' }, 500, NO_STORE);
  }
}
