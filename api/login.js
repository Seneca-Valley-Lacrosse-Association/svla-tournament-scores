import { checkPasscode } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function POST(request) {
  const auth = await checkPasscode(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status, { 'Cache-Control': 'no-store' });
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
}
