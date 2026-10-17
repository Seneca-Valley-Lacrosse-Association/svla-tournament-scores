// TEMPORARY diagnostic (removed after use). Compares the ETags that put/head/get report.
import { put, head, get } from '@vercel/blob';

export async function GET() {
  const out = { steps: [] };
  const P = 'preview-test/diag.json';
  const readEtag = async () => {
    const r = await get(P, { access: 'private', useCache: false });
    const text = r ? await new Response(r.stream).text() : null;
    return { getEtag: r?.blob?.etag, body: text };
  };
  try {
    const state = process.env.BLOB_PATH || 'pumpkin-classic-2026/state.json';
    const h0 = await head(state).catch((e) => ({ err: String(e.message) }));
    const g0 = await get(state, { access: 'private', useCache: false }).catch((e) => ({ err: String(e.message) }));
    out.statePath = state;
    out.stateHeadEtag = h0?.etag ?? h0?.err;
    out.stateGetEtag = g0?.blob?.etag ?? g0?.err ?? null;
    out.stateEtagsEqual = out.stateHeadEtag === out.stateGetEtag;

    let cur = await put(P, JSON.stringify({ n: 0 }), { access: 'private', allowOverwrite: true, contentType: 'application/json' });
    out.steps.push({ op: 'put0', putEtag: cur.etag });
    for (let i = 1; i <= 4; i++) {
      const g = await readEtag();
      const h = await head(P);
      const step = { i, getEtag: g.getEtag, headEtag: h.etag, lastPutEtag: cur.etag, bodyBefore: g.body, getEqualsHead: g.getEtag === h.etag, putEqualsHead: cur.etag === h.etag };
      try {
        cur = await put(P, JSON.stringify({ n: i }), { access: 'private', allowOverwrite: true, contentType: 'application/json', ifMatch: g.getEtag });
        step.writeWithGetEtag = 'ok';
      } catch (e) {
        step.writeWithGetEtag = `FAIL ${e.message}`;
        try {
          cur = await put(P, JSON.stringify({ n: i }), { access: 'private', allowOverwrite: true, contentType: 'application/json', ifMatch: h.etag });
          step.writeWithHeadEtag = 'ok';
        } catch (e2) { step.writeWithHeadEtag = `FAIL ${e2.message}`; }
      }
      out.steps.push(step);
    }
  } catch (e) {
    out.error = String(e.stack || e.message);
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
