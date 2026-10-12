// Scorekeeper passcode check. The passcode lives only in the ORGANIZER_PASSCODE
// environment variable. If it is not set, score entry is disabled (fails closed).

import { createHash, timingSafeEqual } from 'node:crypto';

const failures = new Map(); // best-effort, per warm instance
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;

const digest = (s) => createHash('sha256').update(String(s)).digest();
const clientIp = (req) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

export async function checkPasscode(req) {
  const expected = process.env.ORGANIZER_PASSCODE;
  if (!expected) return { ok: false, status: 503, error: 'Score entry is not configured yet.' };

  const ip = clientIp(req);
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    return { ok: false, status: 429, error: 'Too many attempts. Please wait a few minutes.' };
  }

  const given = (req.headers.get('x-passcode') || '').trim();
  if (timingSafeEqual(digest(given), digest(expected.trim()))) return { ok: true };

  recent.push(now);
  failures.set(ip, recent);
  await new Promise((r) => setTimeout(r, 400));
  return { ok: false, status: 401, error: 'Incorrect passcode.' };
}
