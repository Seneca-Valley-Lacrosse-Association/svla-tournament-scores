// Staff endpoint (passcode required) for the Reports tab: list reports, approve or edit a held report,
// reject one, or undo one that was already posted.

import { checkPasscode } from '../lib/auth.js';
import { json } from '../lib/http.js';
import { publishScore, unpublishScore, ScoreChanged } from '../lib/publish.js';
import { getReport, updateReport, listReports, supersedeOthers, audit, ReportsUnavailable } from '../lib/reports-db.js';
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
