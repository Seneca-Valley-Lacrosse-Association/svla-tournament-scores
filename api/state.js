import { readState } from '../lib/store.js';
import { json } from '../lib/http.js';

// Parents get a briefly cached copy (keeps storage reads low on tournament day).
// Scorekeepers pass ?fresh=1 to bypass the cache and see the latest right away.
export async function GET(request) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  try {
    const state = await readState();
    return json(state, 200, {
      'Cache-Control': fresh ? 'no-store' : 'public, s-maxage=10, stale-while-revalidate=20',
    });
  } catch (e) {
    console.error('state read failed', e);
    return json({ error: 'Scores are temporarily unavailable.' }, 500, { 'Cache-Control': 'no-store' });
  }
}
