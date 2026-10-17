// Moves a table-reported score onto (or off) the live scoreboard. Uses the same shared state document
// as the staff Scores tab, with the same safe concurrent-write handling.

import { mutate } from './store.js';

export function publishScore(gameId, a, b, reportId) {
  return mutate((s) => {
    s.scores[gameId] = { a, b, status: 'final', updatedAt: new Date().toISOString(), source: 'table', reportId };
    return s;
  });
}

export class ScoreChanged extends Error {}

// Removes a published score, but only if it is still the one this report put there.
export function unpublishScore(gameId, reportId) {
  return mutate((s) => {
    const cur = s.scores[gameId];
    if (cur && cur.reportId !== reportId) throw new ScoreChanged();
    delete s.scores[gameId];
    return s;
  });
}
