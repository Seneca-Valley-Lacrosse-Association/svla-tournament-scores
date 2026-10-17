// Shared score state. One small JSON document, stored in a private Vercel Blob.
// Writes use optimistic concurrency (ETag + ifMatch) so two scorekeepers saving at the
// same moment can't silently overwrite each other. Local testing: STORE=file.

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Preview deployments set BLOB_PATH so testing never touches the live scoreboard document.
const BLOB_PATH = process.env.BLOB_PATH || 'pumpkin-classic-2026/state.json';
const FILE_PATH = process.env.STORE_FILE || '.data/state.json';
const useFile = () => process.env.STORE === 'file';

const emptyState = () => ({ scores: {}, edits: {}, updatedAt: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPrecondition(e) {
  return e?.name === 'BlobPreconditionFailedError' || e?.code === 'PRECONDITION' || /precondition/i.test(e?.message || '');
}

async function readBlob() {
  const { get } = await import('@vercel/blob');
  const res = await get(BLOB_PATH, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return { state: emptyState(), etag: null };
  const text = await new Response(res.stream).text();
  return { state: JSON.parse(text), etag: res.blob.etag };
}

async function writeBlob(state, etag) {
  const { put } = await import('@vercel/blob');
  await put(BLOB_PATH, JSON.stringify(state), {
    access: 'private',
    allowOverwrite: true,
    contentType: 'application/json',
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function readLocal() {
  try {
    const state = JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
    return { state, etag: String(state._v || 0) };
  } catch {
    return { state: emptyState(), etag: '0' };
  }
}

// Local test store only: a lock file makes check-then-write atomic, like Blob's ifMatch.
async function withLock(fn) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  const lock = FILE_PATH + '.lock';
  for (let i = 0; i < 400; i++) {
    let fh;
    try {
      fh = await fs.open(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      await sleep(5);
      continue;
    }
    try { return await fn(); } finally { await fh.close(); await fs.unlink(lock).catch(() => {}); }
  }
  throw new Error('local store lock timeout');
}

async function writeLocal(state, etag) {
  await withLock(async () => {
    const cur = await readLocal();
    if (cur.etag !== etag) {
      const e = new Error('precondition failed');
      e.code = 'PRECONDITION';
      throw e;
    }
    await fs.writeFile(FILE_PATH, JSON.stringify({ ...state, _v: Number(etag) + 1 }));
  });
}

export async function readState() {
  const { state } = useFile() ? await readLocal() : await readBlob();
  return { scores: state.scores || {}, edits: state.edits || {}, updatedAt: state.updatedAt || null };
}

// Read-modify-write with retry on conflicting writes.
export async function mutate(fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = useFile() ? await readLocal() : await readBlob();
    const next = fn({ scores: { ...(state.scores || {}) }, edits: state.edits || {}, updatedAt: state.updatedAt || null });
    next.updatedAt = new Date().toISOString();
    try {
      if (useFile()) await writeLocal(next, etag);
      else await writeBlob(next, etag);
      return { scores: next.scores, edits: next.edits || {}, updatedAt: next.updatedAt };
    } catch (e) {
      if (!isPrecondition(e)) throw e;
      await sleep(60 * (attempt + 1));
    }
  }
  throw new Error('Too many simultaneous updates — please try again.');
}
