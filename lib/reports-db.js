// Table score reports and their audit log, stored in Supabase (Postgres) through its REST API.
// No extra npm package is needed. The tables are locked down with row level security, so only this
// server code (using the secret key) can read or write them. The public report page never talks to
// the database directly.
//
// Env vars:   SUPABASE_URL           e.g. https://xxxx.supabase.co
//             SUPABASE_SECRET_KEY    the project's secret key (server only, never sent to a browser)
// Local test: REPORTS_STORE=file keeps reports in .data/reports.json instead.

import { promises as fs } from 'node:fs';
import path from 'node:path';

const FILE_PATH = process.env.REPORTS_FILE || '.data/reports.json';
const useFile = () => process.env.REPORTS_STORE === 'file';

export class ReportsUnavailable extends Error {}

/* ---------- Supabase REST ---------- */

function rest() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new ReportsUnavailable('Report storage is not configured.');
  // New-style secret keys (sb_secret_...) go in the apikey header only. Legacy service_role keys are JWTs.
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return { url, headers };
}

async function call(method, table, query, body, prefer = 'return=representation') {
  const { url, headers } = rest();
  let res;
  try {
    res = await fetch(`${url}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      method,
      headers: { ...headers, ...(method === 'GET' ? {} : { Prefer: prefer }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new ReportsUnavailable(`Report storage unreachable: ${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Supabase ${method} ${table} failed: ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    err.code = /23505/.test(text) ? 'UNIQUE' : /SCORE_LOCKED/.test(text) ? 'LOCKED' : undefined;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const enc = encodeURIComponent;

/* ---------- local file backend (testing only) ---------- */

async function readLocal() {
  try { return JSON.parse(await fs.readFile(FILE_PATH, 'utf8')); } catch { return { reports: [], audit: [] }; }
}
async function writeLocal(data) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(data));
}
const uuid = () => globalThis.crypto.randomUUID();

/* ---------- public API ---------- */

export async function findByClientId(clientId) {
  if (useFile()) return (await readLocal()).reports.find((r) => r.client_id === clientId) || null;
  const rows = await call('GET', 'reports', `client_id=eq.${enc(clientId)}&limit=1`);
  return rows[0] || null;
}

export async function reportsForGame(gameId) {
  if (useFile()) return (await readLocal()).reports.filter((r) => r.game_id === gameId);
  return call('GET', 'reports', `game_id=eq.${enc(gameId)}&order=created_at.asc&limit=50`);
}

export async function countRecentByIp(ipHash, sinceIso) {
  if (useFile()) return (await readLocal()).reports.filter((r) => r.ip_hash === ipHash && r.created_at >= sinceIso).length;
  const rows = await call('GET', 'reports', `ip_hash=eq.${enc(ipHash)}&created_at=gte.${enc(sinceIso)}&select=id&limit=200`);
  return rows.length;
}

export async function insertReport(row) {
  if (useFile()) {
    const data = await readLocal();
    if (row.client_id && data.reports.some((r) => r.client_id === row.client_id)) {
      const e = new Error('duplicate client_id');
      e.code = 'UNIQUE';
      throw e;
    }
    const rec = { id: uuid(), created_at: new Date().toISOString(), reviewed_at: null, review_note: null, approved_a: null, approved_b: null, ...row };
    data.reports.push(rec);
    await writeLocal(data);
    return rec;
  }
  const rows = await call('POST', 'reports', '', row);
  return rows[0];
}

export async function getReport(id) {
  if (useFile()) return (await readLocal()).reports.find((r) => r.id === id) || null;
  const rows = await call('GET', 'reports', `id=eq.${enc(id)}&limit=1`);
  return rows[0] || null;
}

export async function updateReport(id, patch) {
  if (useFile()) {
    const data = await readLocal();
    const rec = data.reports.find((r) => r.id === id);
    if (!rec) return null;
    Object.assign(rec, patch);
    await writeLocal(data);
    return rec;
  }
  const rows = await call('PATCH', 'reports', `id=eq.${enc(id)}`, patch);
  return rows[0] || null;
}

export async function listReports(hours = 48) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  if (useFile()) {
    return (await readLocal()).reports.filter((r) => r.created_at >= since).sort((x, y) => y.created_at.localeCompare(x.created_at));
  }
  return call('GET', 'reports', `created_at=gte.${enc(since)}&order=created_at.desc&limit=200&select=id,game_id,field,score_a,score_b,status,flags,approved_a,approved_b,created_at,reviewed_at,review_note`);
}

// After a corrected score goes live, earlier posted reports for the same game are marked as replaced.
export async function supersedeOthers(gameId, exceptId, includeHeld = false) {
  const rows = (await reportsForGame(gameId)).filter((r) => r.id !== exceptId
    && (r.status === 'published' || r.status === 'approved' || (includeHeld && r.status === 'held')));
  for (const r of rows) await updateReport(r.id, { status: 'superseded', reviewed_at: new Date().toISOString() });
  return rows.length;
}

// Audit entries are best effort: a failure to log must never block a score.
export async function audit(entry) {
  try {
    if (useFile()) {
      const data = await readLocal();
      data.audit.push({ at: new Date().toISOString(), detail: {}, ...entry });
      await writeLocal(data);
      return;
    }
    await call('POST', 'audit_log', '', { detail: {}, ...entry }, 'return=minimal');
  } catch (e) {
    console.error('audit write failed', e.message);
  }
}

// A tiny read for the keep-alive cron (api/keepalive.js). Real traffic to the database stops the free
// Supabase project from pausing after a week of inactivity. Throws if the database cannot be reached.
export async function ping() {
  if (useFile()) return 0;
  const rows = await call('GET', 'reports', 'select=id&limit=1');
  return rows.length;
}

// Game-day reset: removes every report and every audit entry. Only the staff "Reset everything" action calls this.
export async function clearAllReports() {
  if (useFile()) { await writeLocal({ reports: [], audit: [] }); return; }
  await call('DELETE', 'audit_log', 'id=not.is.null', undefined, 'return=minimal');
  await call('DELETE', 'reports', 'id=not.is.null', undefined, 'return=minimal');
}
