import { GAMES, TEAMS, TABLE, SLOTS } from '../lib/schedule.js';

let problems = 0;
const bad = (m) => { problems++; console.log('PROBLEM:', m); };

// 1. Field/slot uniqueness
const seen = new Map();
for (const g of GAMES) {
  const k = `${g.slot}-${g.field}`;
  if (seen.has(k)) bad(`double-booked ${SLOTS[g.slot]} field ${g.field}: ${seen.get(k)} & ${g.id}`);
  seen.set(k, g.id);
}
// 2. A team plays at most once per slot, and only inside its own division
const perTeamSlot = new Set();
const counts = {};
for (const g of GAMES) {
  for (const t of [g.a, g.b]) {
    if (!TEAMS[t]) bad(`unknown team ${t}`);
    const k = `${t}-${g.slot}`;
    if (perTeamSlot.has(k)) bad(`${t} plays twice in ${SLOTS[g.slot]}`);
    perTeamSlot.add(k);
    counts[t] = (counts[t] || 0) + 1;
  }
  if (g.div === 'Varsity' && !(g.a.startsWith('VA') && g.b.startsWith('VA'))) bad(`${g.id} division mismatch`);
  if (g.div === 'JV' && !(g.a.startsWith('JV') && g.b.startsWith('JV'))) bad(`${g.id} division mismatch`);
}
// 3. Expected counts from the PDF: VA1 and VA8 play 4, every other team 3
for (const t of Object.keys(TEAMS)) {
  const want = t === 'VA1' || t === 'VA8' ? 4 : 3;
  if (counts[t] !== want) bad(`${t} has ${counts[t]} games, expected ${want}`);
}
// 4. Table duty: a team in the game, or "SV Option"; null exactly where no game
for (const [f, row] of Object.entries(TABLE)) {
  row.forEach((name, slot) => {
    const g = GAMES.find((x) => x.field === Number(f) && x.slot === slot);
    if (!g && name !== null) bad(`table duty on field ${f} ${SLOTS[slot]} but no game`);
    if (g && name === null) bad(`game ${g.id} has no table duty entry`);
    if (g && name && name !== 'SV Option' && ![TEAMS[g.a], TEAMS[g.b]].includes(name)) {
      bad(`table team ${name} not in ${g.id} (${TEAMS[g.a]} v ${TEAMS[g.b]})`);
    }
  });
}
const v = GAMES.filter((g) => g.div === 'Varsity').length;
const j = GAMES.filter((g) => g.div === 'JV').length;
console.log(`games: ${GAMES.length} (varsity ${v}, JV ${j}); problems: ${problems}`);
process.exit(problems ? 1 : 0);
