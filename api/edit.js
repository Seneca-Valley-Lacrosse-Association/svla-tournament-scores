// Schedule changes made by tournament staff: rename/replace a team, add a team, move or cancel a
// game, change score-table duty, or reset. Everything is validated here, so a typo can't break the
// schedule. Changes are stored as "edits" layered over the original schedule in lib/schedule.js.

import { SLOTS, FIELDS, TEAMS, GAMES, TABLE } from '../lib/schedule.js';
import { checkPasscode } from '../lib/auth.js';
import { mutate } from '../lib/store.js';
import { applyEdits } from '../lib/apply.js';
import { json } from '../lib/http.js';

const BASE = { slots: SLOTS, fields: FIELDS, teams: TEAMS, games: GAMES, table: TABLE };
const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_TEAMS = 40;
const MAX_ADDED = 40;

class Bad extends Error {}
const bad = (m) => { throw new Bad(m); };
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const divOf = (code) => (String(code).startsWith('VA') ? 'Varsity' : 'JV');

function setTable(edits, field, slot, val) {
  const key = `${field}:${slot}`;
  const original = TABLE[field]?.[slot] ?? null;
  if ((val ?? null) === original) delete edits.table[key];
  else edits.table[key] = val ?? null;
}

// Shared rules for adding or changing a game. Throws a friendly message if it can't work.
function checkGame(eff, id, div, { a, b, slot, field, cancelled }) {
  if (!eff.teams[a] || !eff.teams[b]) bad('Pick two teams.');
  if (a === b) bad('A team cannot play itself.');
  if (divOf(a) !== div || divOf(b) !== div) bad(`Both teams must be ${div} teams.`);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS.length) bad('Unknown time.');
  if (!FIELDS[field]) bad('Unknown field.');
  if (cancelled) return;
  for (const o of eff.games) {
    if (o.id === id || o.cancelled || o.slot !== slot) continue;
    if (o.field === field) bad(`Field ${field} at ${SLOTS[slot]} already has ${eff.teams[o.a]} vs ${eff.teams[o.b]}.`);
    for (const t of [a, b]) {
      if (o.a === t || o.b === t) bad(`${eff.teams[t]} is already playing at ${SLOTS[slot]}.`);
    }
  }
}

function applyTable(edits, eff, body, field, slot) {
  if (body.table === undefined) return;
  const val = clean(body.table, 40) || null;
  const cur = eff.table[field]?.[slot] ?? null;
  if (val !== cur) setTable(edits, field, slot, val);
}

// Stores a change for a game: added games live in edits.added, original games in edits.games.
function setGame(edits, g, patch) {
  if (g.added) edits.added[g.id] = { ...edits.added[g.id], ...patch };
  else edits.games[g.id] = { a: g.a, b: g.b, slot: g.slot, field: g.field, cancelled: g.cancelled, note: g.note, ...patch };
}

function nameTaken(teams, code, name) {
  return Object.entries(teams).some(
    ([c, n]) => c !== code && divOf(c) === divOf(code) && n.toLowerCase() === name.toLowerCase(),
  );
}

function perform(edits, body, state) {
  const eff = applyEdits(BASE, edits);

  switch (body.type) {
    case 'team': {
      const code = body.code;
      if (!eff.teams[code]) bad('Unknown team.');
      const name = clean(body.name, 40);
      if (!name) bad('Enter a team name.');
      if (nameTaken(eff.teams, code, name)) bad(`${name} is already in the ${divOf(code)} division.`);
      const old = eff.teams[code];
      if (old === name) return;
      // Table duty is listed by school name. If no other team still uses the old name, follow the rename.
      const oldStillUsed = Object.entries(eff.teams).some(([c, n]) => c !== code && n === old);
      if (!oldStillUsed) {
        for (const [f, row] of Object.entries(eff.table)) row.forEach((v, s) => { if (v === old) setTable(edits, f, s, name); });
      }
      if (TEAMS[code] === name) delete edits.teams[code];
      else edits.teams[code] = name;
      return;
    }

    case 'addTeam': {
      const pre = body.div === 'JV' ? 'JV' : body.div === 'VA' ? 'VA' : bad('Choose Varsity or JV.');
      const name = clean(body.name, 40);
      if (!name) bad('Enter a team name.');
      if (Object.keys(eff.teams).length >= MAX_TEAMS) bad('That is the maximum number of teams.');
      let n = 0;
      for (const c of Object.keys(eff.teams)) if (c.startsWith(pre)) n = Math.max(n, parseInt(c.slice(2), 10) || 0);
      const code = `${pre}${n + 1}`;
      if (nameTaken({ ...eff.teams, [code]: name }, code, name)) bad(`${name} is already in the ${divOf(code)} division.`);
      edits.teams[code] = name;
      return;
    }

    case 'game': {
      const g = eff.games.find((x) => x.id === body.id);
      if (!g) bad('Unknown game.');
      const next = {
        a: body.a, b: body.b, slot: Number(body.slot), field: Number(body.field),
        cancelled: body.cancelled === true, note: clean(body.note, 80),
      };
      checkGame(eff, g.id, g.div, next);
      if (g.added) {
        setGame(edits, g, next);
      } else {
        const orig = GAMES.find((x) => x.id === g.id);
        const unchanged = next.a === orig.a && next.b === orig.b && next.slot === orig.slot && next.field === orig.field && !next.cancelled && !next.note;
        if (unchanged) delete edits.games[g.id];
        else edits.games[g.id] = next;
      }
      applyTable(edits, eff, body, next.field, next.slot);
      return;
    }

    case 'addGame': {
      const div = body.div === 'JV' ? 'JV' : body.div === 'Varsity' ? 'Varsity' : bad('Choose Varsity or JV.');
      if (Object.keys(edits.added).length >= MAX_ADDED) bad('That is the maximum number of added games.');
      const game = {
        div, a: body.a, b: body.b, slot: Number(body.slot), field: Number(body.field),
        cancelled: false, note: clean(body.note, 80),
      };
      checkGame(eff, null, div, game);
      let n = 0;
      for (const id of Object.keys(edits.added)) n = Math.max(n, parseInt(id.slice(1), 10) || 0);
      edits.added[`A${n + 1}`] = game;
      applyTable(edits, eff, body, game.field, game.slot);
      return;
    }

    case 'deleteGame': {
      if (!edits.added[body.id]) bad('Only games you added can be deleted.');
      delete edits.added[body.id];
      delete state.scores[body.id];
      return;
    }

    case 'deleteTeam': {
      const code = body.code;
      if (!eff.teams[code]) bad('Unknown team.');
      if (TEAMS[code]) bad('Original teams cannot be deleted. Use "Team withdrew" to cancel their games, or rename the team.');
      if (eff.games.some((g) => g.a === code || g.b === code)) bad('This team is in a game. Move or delete those games first.');
      delete edits.teams[code];
      return;
    }

    case 'cancelTeam': {
      const code = body.code;
      if (!eff.teams[code]) bad('Unknown team.');
      const note = clean(body.note, 80) || 'Team withdrew';
      let n = 0;
      for (const g of eff.games) {
        if (g.cancelled || (g.a !== code && g.b !== code)) continue;
        setGame(edits, g, { cancelled: true, note });
        n++;
      }
      if (!n) bad('That team has no games left to cancel.');
      return;
    }

    case 'resetGame': {
      if (!GAMES.some((x) => x.id === body.id)) bad('Unknown game.');
      delete edits.games[body.id];
      return;
    }

    case 'resetAll': {
      for (const id of Object.keys(edits.added)) delete state.scores[id];
      edits.teams = {};
      edits.games = {};
      edits.table = {};
      edits.added = {};
      return;
    }

    default:
      bad('Unknown change.');
  }
}

export async function POST(request) {
  const auth = await checkPasscode(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status, NO_STORE);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400, NO_STORE);
  }

  try {
    const next = await mutate((s) => {
      const edits = JSON.parse(JSON.stringify(s.edits || {}));
      edits.teams ||= {};
      edits.games ||= {};
      edits.table ||= {};
      edits.added ||= {};
      perform(edits, body || {}, s);
      s.edits = edits;
      return s;
    });
    return json({ ok: true, scores: next.scores, edits: next.edits, updatedAt: next.updatedAt }, 200, NO_STORE);
  } catch (e) {
    if (e instanceof Bad) return json({ error: e.message }, 400, NO_STORE);
    console.error('edit failed', e);
    return json({ error: 'Could not save. Please try again.' }, 500, NO_STORE);
  }
}
