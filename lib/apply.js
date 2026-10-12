// Applies scorekeeper edits (renamed/added teams, moved or cancelled games, score-table duty)
// on top of the base schedule. public/shared.js carries an identical copy for the browser —
// keep the two in sync.

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
