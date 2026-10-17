// Called by the Vercel cron in vercel.json every 5 days. Supabase pauses free projects after about a week
// with no activity, so this makes a tiny read to keep the report database awake all year.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET environment variable is set.
// Without that variable the endpoint refuses every request.

import { timingSafeEqual } from 'node:crypto';
import { ping } from '../lib/reports-db.js';
import { json } from '../lib/http.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') || '');
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(request) {
  if (!authorized(request)) return json({ error: 'Not allowed.' }, 401, NO_STORE);
  try {
    await ping();
    return json({ ok: true, at: new Date().toISOString() }, 200, NO_STORE);
  } catch (e) {
    console.error('keepalive failed', e.message);
    return json({ error: 'Database check failed.' }, 500, NO_STORE);
  }
}
