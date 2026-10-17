// Public endpoint behind the QR code on each scoring table. No login.
// A clean final score goes straight to the scoreboard; anything unusual is held for a staff member.
// Reports are rate limited, and repeating the same request (a retry on a weak signal) is harmless.

import { createHash } from 'node:crypto';
import { SLOTS, FIELDS, TEAMS, GAMES, TABLE } from '../lib/schedule.js';
import { applyEdits } from '../lib/apply.js';
import { readState } from '../lib/store.js';
import { publishScore } from '../lib/publish.js';
import { json } from '../lib/http.js';
import {
  findByClientId, reportsForGame, countRecentByIp, insertReport, updateReport, supersedeOthers, audit, ReportsUnavailable,
} from '../lib/reports-db.js';
import { assess, toScore, MAX_REPORTS_PER_GAME, MAX_REPORTS_PER_IP_10MIN } from '../lib/report-rules.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const CALL = 'Please call the number on the sheet, or write the score on the paper log.';
const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
const hashIp = (ip) => createHash('sha256').update(`svla-report:${ip}`).digest('hex').slice(0, 16);

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, NO_STORE); }

  const { gameId, clientId } = body || {};
  const field = Number(body?.field);
  const correction = body?.correction === true; // a table worker fixing a score they (or a teammate) already sent
  const a = toScore(body?.a);
  const b = toScore(body?.b);
  if (typeof gameId !== 'string' || typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 64) {
    return json({ error: 'Invalid request.' }, 400, NO_STORE);
  }
  if (!Number.isInteger(field) || !FIELDS[field]) return json({ error: 'Unknown field.' }, 400, NO_STORE);
  if (a === null || b === null) return json({ error: 'Scores must be whole numbers from 0 to 99.' }, 400, NO_STORE);
  if (a === b) {
    // No ties in this tournament. Nothing is stored; the worker is sent to Stretch if the game really ended tied.
    await audit({ actor: 'table', action: 'tie_rejected', game_id: gameId, detail: { a, b, field } });
    return json({
      error: 'Ties are not allowed. Please double-check the score. If the game truly ended in a tie, call or text Stretch at 614-522-9419.',
      code: 'tie',
    }, 422, NO_STORE);
  }

  try {
    // A retry of a request the server already handled returns the earlier result.
    const again = await findByClientId(clientId);
    if (again) return json({ ok: true, outcome: again.status === 'published' ? 'published' : 'held' }, 200, NO_STORE);

    const ipHash = hashIp(clientIp(request));
    if (await countRecentByIp(ipHash, new Date(Date.now() - 10 * 60 * 1000).toISOString()) >= MAX_REPORTS_PER_IP_10MIN) {
      return json({ error: `Too many reports from this phone. ${CALL}` }, 429, NO_STORE);
    }

    const state = await readState();
    const sched = applyEdits({ slots: SLOTS, fields: FIELDS, teams: TEAMS, games: GAMES, table: TABLE }, state.edits);
    const game = sched.games.find((g) => g.id === gameId);
    if (!game || game.cancelled) return json({ error: 'That game is not available for reporting.' }, 400, NO_STORE);

    const all = await reportsForGame(gameId);
    const prior = all.filter((r) => r.status === 'published' || r.status === 'approved' || r.status === 'held');
    if (all.length >= MAX_REPORTS_PER_GAME) return json({ error: `This game already has several reports. ${CALL}` }, 429, NO_STORE);

    // Same score already on the board or already reported: nothing to do.
    const existing = state.scores[gameId];
    const sameAsBoard = existing?.status === 'final' && existing.a === a && existing.b === b;
    const sameAsPrior = prior.some((r) => r.score_a === a && r.score_b === b);
    if (sameAsBoard || sameAsPrior) return json({ ok: true, outcome: 'duplicate' }, 200, NO_STORE);

    // A correction replaces a score that came from a table report. If a staff member set or changed the score,
    // it is not replaced automatically; the correction waits in the Reports tab like any other conflict.
    const autoCorrect = correction && existing?.status === 'final' && existing.source === 'table' && !!existing.reportId;
    const flags = autoCorrect
      ? assess({ game, field, a, b, existing: undefined, prior: [], slots: SLOTS })
      : assess({ game, field, a, b, existing, prior, slots: SLOTS });
    const row = {
      client_id: clientId, game_id: gameId, field, score_a: a, score_b: b, ip_hash: ipHash,
      status: flags.length ? 'held' : 'published', flags,
      ...(correction && existing?.status === 'final' ? { review_note: `Correction of ${existing.a}\u2013${existing.b}` } : {}),
    };
    let rec;
    try {
      rec = await insertReport(row);
    } catch (e) {
      if (e.code === 'UNIQUE') return json({ ok: true, outcome: 'held' }, 200, NO_STORE); // raced with its own retry
      throw e;
    }

    let outcome = rec.status === 'published' ? 'published' : 'held';
    if (outcome === 'published') {
      try {
        await publishScore(gameId, a, b, rec.id);
      } catch (e) {
        console.error('publish failed', e);
        await updateReport(rec.id, { status: 'held', flags: ['publish-failed'] });
        outcome = 'held';
      }
    }
    if (outcome === 'published' && autoCorrect) {
      try { await supersedeOthers(gameId, rec.id); } catch (e) { console.error('supersede failed', e.message); }
    }
    await audit({
      actor: 'table',
      action: `${correction ? 'correction_' : ''}${outcome === 'published' ? (correction ? 'published' : 'auto_published') : 'held'}`,
      report_id: rec.id, game_id: gameId,
      detail: { a, b, field, flags: outcome === 'held' && !flags.length ? ['publish-failed'] : flags },
    });
    return json({ ok: true, outcome }, 200, NO_STORE);
  } catch (e) {
    console.error('report failed', e);
    if (e instanceof ReportsUnavailable) return json({ error: `Could not send right now. ${CALL}` }, 503, NO_STORE);
    return json({ error: `Could not send. Tap to try again, or ${CALL.toLowerCase()}` }, 500, NO_STORE);
  }
}
