// Logic shared by the parent view and the organizer view.

export const EVENT_DATE = '2026-10-18'; // America/New_York
export const FIELD_COLORS = { 1: 'var(--f1)', 2: 'var(--f2)', 3: 'var(--f3)', 4: 'var(--f4)' };

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export async function fetchSchedule() {
  const r = await fetch('/api/schedule');
  if (!r.ok) throw new Error('schedule');
  return r.json();
}

export async function fetchState(fresh = false) {
  const r = await fetch('/api/state' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' });
  if (!r.ok) throw new Error('state');
  return r.json();
}

// Same function as lib/apply.js (server). Keep the two in sync.
export function applyEdits(base, edits) {
  const e = edits || {};
  const teams = { ...base.teams, ...(e.teams || {}) };
  const games = base.games.map((g) => {
    const o = e.games?.[g.id];
    if (!o) return { ...g, cancelled: false, note: '', changed: false };
    return {
      ...g,
      a: o.a ?? g.a,
      b: o.b ?? g.b,
      slot: o.slot ?? g.slot,
      field: o.field ?? g.field,
      cancelled: !!o.cancelled,
      note: o.note || '',
      changed: true,
    };
  });
  // Games added by staff (ids A1, A2, ...). They behave like any other game.
  for (const [id, o] of Object.entries(e.added || {})) {
    games.push({
      id, div: o.div, a: o.a, b: o.b, slot: o.slot, field: o.field,
      cancelled: !!o.cancelled, note: o.note || '', changed: true, added: true,
    });
  }
  const table = {};
  for (const [f, row] of Object.entries(base.table)) table[f] = [...row];
  for (const [k, v] of Object.entries(e.table || {})) {
    const [f, s] = k.split(':');
    if (table[f]) table[f][Number(s)] = v;
  }
  return { slots: base.slots, fields: base.fields, teams, games, table };
}

// Minutes after midnight for labels like "12:20 PM".
function minutes(label) {
  const [, h, m, ap] = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(label);
  return (Number(h) % 12) * 60 + Number(m) + (ap.toUpperCase() === 'PM' ? 720 : 0);
}

// On event day only: which slot is under way, or next up. Otherwise nothing.
export function slotClock(slots) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  if (`${get('year')}-${get('month')}-${get('day')}` !== EVENT_DATE) return {};
  const now = Number(get('hour')) * 60 + Number(get('minute'));
  const starts = slots.map(minutes);
  for (let i = 0; i < starts.length; i++) {
    if (now >= starts[i] && now < starts[i] + 50) return { now: i, next: i + 1 < slots.length ? i + 1 : undefined };
  }
  const nextIdx = starts.findIndex((s) => s > now);
  return nextIdx >= 0 ? { next: nextIdx } : {};
}

export function standings(sched, scores) {
  const rows = {};
  for (const [code, name] of Object.entries(sched.teams)) {
    rows[code] = { code, name, div: code.startsWith('VA') ? 'Varsity' : 'JV', gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0 };
  }
  for (const g of sched.games) {
    const s = scores[g.id];
    if (!s || s.status !== 'final' || g.cancelled) continue;
    const A = rows[g.a];
    const B = rows[g.b];
    A.gp++; B.gp++;
    A.gf += s.a; A.ga += s.b; B.gf += s.b; B.ga += s.a;
    if (s.a > s.b) { A.w++; B.l++; } else if (s.b > s.a) { B.w++; A.l++; } else { A.t++; B.t++; }
  }
  const out = { Varsity: [], JV: [] };
  for (const r of Object.values(rows)) out[r.div].push(r);
  for (const list of Object.values(out)) {
    list.sort((x, y) => y.w - x.w || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name));
  }
  return out;
}

export function gameCard(g, sched, scores, { team = '', editable = false, schedEdit = false } = {}) {
  const s = g.cancelled ? undefined : scores[g.id];
  const status = s?.status || 'scheduled';
  const A = sched.teams[g.a];
  const B = sched.teams[g.b];
  const final = status === 'final';
  const winA = final && s.a > s.b;
  const winB = final && s.b > s.a;
  const mine = team && (A === team || B === team);
  const pill = g.cancelled
    ? '<span class="pill cancelled">Cancelled</span>'
    : status === 'live'
      ? '<span class="pill live">In progress</span>'
      : final ? '<span class="pill final">Final</span>'
        : `<span class="pill up">${esc(sched.slots[g.slot])}</span>`;
  const pts = (v) => (s ? v : '\u2013');
  const table = editable || schedEdit ? sched.table[g.field]?.[g.slot] : null;
  const note = g.note
    ? `<span class="sub note">${esc(g.note)}</span>`
    : g.changed && !g.cancelled ? `<span class="sub note">${g.added ? 'Added game' : 'Schedule updated'}</span>` : '';
  const button = schedEdit
    ? `<button class="btn edit-btn" data-gedit="${g.id}">Edit game</button>`
    : editable && !g.cancelled
      ? `<button class="btn edit-btn" data-edit="${g.id}">${status === 'scheduled' ? 'Start / score' : 'Update'}</button>`
      : '';
  return `
  <article class="game${mine ? ' mine' : ''}${g.cancelled ? ' cancelled' : ''}" style="--fc:${FIELD_COLORS[g.field]}" data-id="${g.id}" aria-label="${esc(A)} versus ${esc(B)}${g.cancelled ? ', cancelled' : ''}">
    <div>
      <div class="team${winA ? ' win' : ''}"><span class="tname">${esc(A)}</span><span class="tcode">${g.a}</span><span class="pts">${pts(s?.a)}</span></div>
      <div class="team${winB ? ' win' : ''}"><span class="tname">${esc(B)}</span><span class="tcode">${g.b}</span><span class="pts">${pts(s?.b)}</span></div>
    </div>
    <div class="meta">
      ${pill}
      <span class="fieldtag"><i></i>Field ${g.field}</span>
      <span class="sub">${g.div}${table ? ` \u00b7 Table: ${esc(table)}` : ''}</span>
      ${note}
      ${button}
    </div>
  </article>`;
}

export function timeAgo(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

// When embedded in an iframe on svlacrosse.org, tell the parent page how tall we are.
export function reportHeight() {
  if (window.parent === window) return;
  const send = () => window.parent.postMessage({ type: 'pc-hub-resize', height: document.documentElement.scrollHeight }, '*');
  new ResizeObserver(send).observe(document.body);
  send();
}

// Counts this phone once as a visitor of `page` ('scores' or 'report'). The id is random and made up here;
// nothing personal is sent. Sent at most once every 30 minutes per page so reloading does not inflate hits.
// Never throws: counting must not get in the way of the page.
export function trackVisit(page) {
  try {
    let id = store.get('svla-vid');
    if (!id) {
      id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `v${Date.now()}${Math.random().toString(16).slice(2)}`;
      store.set('svla-vid', id);
      if (store.get('svla-vid') !== id) return; // storage is blocked: skip rather than count every load as a new person
    }
    const key = `svla-visit-${page}`;
    if (Date.now() - Number(store.get(key) || 0) < 30 * 60 * 1000) return;
    store.set(key, String(Date.now()));
    fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, page }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
