import { SLOTS, FIELDS, TEAMS, GAMES, TABLE } from '../lib/schedule.js';
import { json } from '../lib/http.js';

export function GET() {
  return json(
    { slots: SLOTS, fields: FIELDS, teams: TEAMS, games: GAMES, table: TABLE },
    200,
    { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  );
}
