// Anonymous visit counter for the parent page and the table report pages. The browser sends a random id it
// made up itself (no name, no IP address). Staff pages are not counted. Always answers 204 so a counting
// problem can never get in the way of a page loading.

import { recordVisit } from '../lib/reports-db.js';

const PAGES = new Set(['scores', 'report']);
const ID = /^[A-Za-z0-9-]{8,64}$/;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|monitor|uptime/i;

export async function POST(request) {
  try {
    if (BOT.test(request.headers.get('user-agent') || '')) return new Response(null, { status: 204 });
    const body = await request.json();
    if (!PAGES.has(body?.page) || !ID.test(body?.id || '')) return new Response(null, { status: 204 });
    await recordVisit(body.id, body.page);
  } catch (e) {
    console.error('visit not recorded', e.message);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
