// 2026 Pumpkin Classic Showcase schedule — transcribed from "2026 Pumpkin Classic Showcase Schedule.pdf".
// Field assignments come from the cell colors in the PDF (green=1, blue=2, red=3, orange=4).
// If the organizer revises the schedule, edit GAMES below and redeploy.

export const SLOTS = [
  '9:00 AM', '9:50 AM', '10:40 AM', '11:30 AM', '12:20 PM',
  '1:10 PM', '2:00 PM', '2:50 PM', '3:40 PM',
];

export const FIELDS = {
  1: 'Myers Law Group Stadium (Turf)',
  2: 'Sr. High Baseball Field (Turf)',
  3: 'High School Stadium (Turf)',
  4: 'Ryan Gloyer Middle School (Turf)',
};

export const TEAMS = {
  VA1: 'Seneca Valley', VA2: 'North Allegheny', VA3: 'Bethel Park', VA4: 'Shaler',
  VA5: 'South Fayette', VA6: 'Canon Mac', VA7: 'Central Catholic', VA8: 'Peters Township',
  VA9: 'Penn Trafford', VA10: 'Hempfield', VA11: 'Indiana', VA12: 'Norwin',
  VA13: 'North Hills', VA14: 'Plum',
  JV1: 'Seneca Valley', JV2: 'Pine Richland', JV3: 'North Allegheny', JV4: 'Mars',
  JV5: 'Butler', JV6: 'Upper St Clair', JV7: 'Peters Township', JV8: 'Hempfield',
};

// [division, slotIndex, field, teamA, teamB]  (A/B follow the order printed in the PDF)
const RAW = [
  ['V', 0, 1, 'VA1', 'VA2'], ['V', 0, 2, 'VA3', 'VA4'], ['V', 0, 3, 'VA5', 'VA6'], ['V', 0, 4, 'VA7', 'VA8'],
  ['V', 1, 1, 'VA9', 'VA10'], ['V', 1, 2, 'VA11', 'VA12'],
  ['J', 1, 3, 'JV1', 'JV2'], ['J', 1, 4, 'JV3', 'JV4'],
  ['V', 2, 1, 'VA1', 'VA3'], ['V', 2, 2, 'VA2', 'VA4'], ['V', 2, 3, 'VA5', 'VA7'], ['V', 2, 4, 'VA6', 'VA8'],
  ['V', 3, 1, 'VA1', 'VA13'], ['V', 3, 2, 'VA9', 'VA11'],
  ['J', 3, 3, 'JV5', 'JV6'], ['J', 3, 4, 'JV7', 'JV8'],
  ['V', 4, 1, 'VA10', 'VA12'], ['V', 4, 2, 'VA2', 'VA3'],
  ['J', 4, 3, 'JV1', 'JV3'], ['J', 4, 4, 'JV2', 'JV4'],
  ['V', 5, 1, 'VA5', 'VA8'], ['V', 5, 2, 'VA11', 'VA14'], ['V', 5, 3, 'VA1', 'VA4'], ['V', 5, 4, 'VA6', 'VA7'],
  ['V', 6, 1, 'VA8', 'VA9'], ['J', 6, 2, 'JV6', 'JV8'], ['V', 6, 3, 'VA10', 'VA13'], ['J', 6, 4, 'JV5', 'JV7'],
  ['V', 7, 1, 'VA12', 'VA14'], ['J', 7, 2, 'JV2', 'JV3'], ['J', 7, 3, 'JV1', 'JV4'],
  ['V', 8, 1, 'VA13', 'VA14'], ['J', 8, 2, 'JV5', 'JV8'], ['J', 8, 3, 'JV6', 'JV7'],
];

const counters = { V: 0, J: 0 };
export const GAMES = RAW.map(([div, slot, field, a, b]) => {
  counters[div] += 1;
  const id = (div === 'V' ? 'V' : 'JV') + String(counters[div]).padStart(2, '0');
  return { id, div: div === 'V' ? 'Varsity' : 'JV', slot, field, a, b };
});

// Score table / penalty timekeeper assignment per field (rows) and slot (columns). null = no game.
export const TABLE = {
  1: ['SV Option', 'Penn Trafford', 'SV Option', 'North Hills', 'SV Option', 'SV Option', 'SV Option', 'Norwin', 'SV Option'],
  2: ['Bethel Park', 'Indiana', 'North Allegheny', 'SV Option', 'SV Option', 'Plum', 'Hempfield', 'Pine Richland', 'SV Option'],
  3: ['South Fayette', 'SV Option', 'Central Catholic', 'Butler', 'SV Option', 'Shaler', 'SV Option', 'SV Option', 'Upper St Clair'],
  4: ['Peters Township', 'North Allegheny', 'Peters Township', 'Hempfield', 'Mars', 'Canon Mac', 'SV Option', null, null],
};

export const GAME_IDS = new Set(GAMES.map((g) => g.id));
