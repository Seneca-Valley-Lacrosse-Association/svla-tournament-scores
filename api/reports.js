// Staff endpoint (passcode required) for the Reports tab: list reports, approve or edit a held report,
// reject one, or undo one that was already posted.

import { checkPasscode } from '../lib/auth.js';
import { json } from '../lib/http.js';
import { publishScore, unpublishScore, ScoreChanged } from '../lib/publish.js';
import { getReport, updateReport, listReports, insertReport, supersedeOthers, audit, clearAllReports, ReportsUnavailable } from '../lib/reports-db.js';
import { SLOTS, FIELDS, TEAMS, GAMES, TABLE } from '../lib/schedule.js';
import { applyEdits } from '../lib/apply.js';
import { readState, mutate } from '../lib/store.js';
import { toScore } from '../lib/report-rules.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const now = () => new Date().toISOString();

export async function POST(request) {
  const auth = await checkPasscode(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status, NO_STORE);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400, NO_STORE); }
  const { action, id } = body || {};

  try {
    if (action === 'list') return json({ ok: true, reports: await listReports(48) }, 200, NO_STORE);
    // Sets every score back to zero (not started) and deletes all report history. The schedule and team edits are kept.
    if (action === 'reset') {
      if (body.confirm !== 'RESET') return json({ error: 'Reset was not confirmed.' }, 400, NO_STORE);
      await mutate((s) => { s.scores = {}; return s; });
      await clearAllReports();
      await audit({ actor: 'staff', action: 'reset_all', detail: {} });
      return json({ ok: true }, 200, NO_STORE);
    }
    // An admin sets a game's score directly from the Reports tab. It is recorded as its own entry in the game's history.
    if (action === 'edit') {
      const a = toScore(body.a);
      const b = toScore(body.b);
      if (typeof body.gameId !== 'string' || a === null || b === null) return json({ error: 'Scores must be whole numbers from 0 to 99.' }, 400, NO_STORE);
      if (a === b) return json({ error: 'A final score cannot be tied. If the game truly ended in a tie, set it in the Scores tab.' }, 400, NO_STORE);
      const state = await readState();
      const sched = applyEdits({ slots: SLOTS, fields: FIELDS, teams: TEAMS, games: GAMES, table: TABLE }, state.edits);
      const game = sched.games.find((g) => g.id === body.gameId);
      if (!game) return json({ error: 'Unknown game.' }, 400, NO_STORE);
      const was = state.scores[game.id]?.status === 'final' ? state.scores[game.id] : null;
      if (was && was.a === a && was.b === b) return json({ ok: true }, 200, NO_STORE); // nothing to change
      const rec = await insertReport({
        client_id: `staff-${globalThis.crypto.randomUUID()}`, game_id: game.id, field: game.field, score_a: a, score_b: b,
        ip_hash: 'staff', status: 'approved', flags: [], approved_a: a, approved_b: b, reviewed_at: now(),
        review_note: `Edited by admin${was ? ` (was ${was.a}\u2013${was.b})` : ''}`,
      });
      try {
        await publishScore(game.id, a, b, rec.id);
      } catch (e) {
        await updateReport(rec.id, { status: 'held', flags: ['publish-failed'] });
        throw e;
      }
      await supersedeOthers(game.id, rec.id, true); // earlier reports for this game, posted or waiting, are settled by this edit
      await audit({ actor: 'staff', action: 'admin_edited', report_id: rec.id, game_id: game.id, detail: { a, b, was: was ? [was.a, was.b] : null } });
      return json({ ok: true }, 200, NO_STORE);
    }
    if (typeof id !== 'string') return json({ error: 'Unknown report.' }, 400, NO_STORE);

    const rep = await getReport(id);
    if (!rep) return json({ error: 'Report not found.' }, 404, NO_STORE);

    if (action === 'approve') {
      if (rep.status !== 'held') return json({ error: 'This report was already handled.' }, 409, NO_STORE);
      const a = body.a === undefined ? rep.score_a : toScore(body.a);
      const b = body.b === undefined ? rep.score_b : toScore(body.b);
      if (a === null || b === null) return json({ error: 'Scores must be whole numbers from 0 to 99.' }, 400, NO_STORE);
      if (a === b) return json({ error: 'A final score cannot be tied. Tap Edit score and enter the real final score.' }, 400, NO_STORE);
      await publishScore(rep.game_id, a, b, rep.id);
      await updateReport(rep.id, { status: 'approved', approved_a: a, approved_b: b, reviewed_at: now() });
      await supersedeOthers(rep.game_id, rep.id);
      await audit({ actor: 'staff', action: a === rep.score_a && b === rep.score_b ? 'approved' : 'approved_edited', report_id: rep.id, game_id: rep.game_id, detail: { a, b, reported: [rep.score_a, rep.score_b] } });
      return json({ ok: true }, 200, NO_STORE);
    }

    if (action === 'reject') {
      if (rep.status !== 'held') return json({ error: 'This report was already handled.' }, 409, NO_STORE);
      await updateReport(rep.id, { status: 'rejected', reviewed_at: now() });
      await audit({ actor: 'staff', action: 'rejected', report_id: rep.id, game_id: rep.game_id });
      return json({ ok: true }, 200, NO_STORE);
    }

    if (action === 'undo') {
      if (rep.status !== 'published' && rep.status !== 'approved') return json({ error: 'Only a posted score can be undone.' }, 409, NO_STORE);
      try {
        await unpublishScore(rep.game_id, rep.id);
      } catch (e) {
        if (e instanceof ScoreChanged) {
          return json({ error: 'That score was changed after this report. Fix it in the Scores tab instead.' }, 409, NO_STORE);
        }
        throw e;
      }
      await updateReport(rep.id, { status: 'undone', reviewed_at: now() });
      await audit({ actor: 'staff', action: 'undone', report_id: rep.id, game_id: rep.game_id, detail: { a: rep.score_a, b: rep.score_b } });
      return json({ ok: true }, 200, NO_STORE);
    }

    return json({ error: 'Unknown action.' }, 400, NO_STORE);
  } catch (e) {
    console.error('reports action failed', e);
    if (e instanceof ReportsUnavailable) return json({ error: 'Reports are unavailable right now. Scores can still be entered in the Scores tab.' }, 503, NO_STORE);
    return json({ error: 'Could not save. Please try again.' }, 500, NO_STORE);
  }
}
