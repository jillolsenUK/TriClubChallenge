const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCsv, extractTeams, extractMessage, toNumber } = require('../src/sheet');
const { Store } = require('../src/store');
const { computeState } = require('../src/race');
const { positionAt } = require('../src/geo');
const { weekStart, isSunday, weekLabel } = require('../src/weeks');

const config = {
  timeZone: 'Europe/London',
  challengeStart: '',
  validationTolerance: 0.5,
  scale: { run: 4, cycle: 1, swim: 26, strength: 25 },
};
const route = {
  name: 'Test',
  totalKm: 5000,
  points: [[0, 0, 0], [0, 1, 2500], [0, 2, 5000]],
};
const tmpStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'tri-')));

// Header row and the two filled-in teams from "Tri before christmas Output November 26.xlsx".
const SHEET = [
  'Team Name,Run-total,Cycle-Total,Swim-Total,Strength-total,Run-week,Cycle-week,Strength-week,swim-week,Charm-total,Charm-week,Hex-total,Hex-Week,Weekly Total (Calulated),Challenge Total (Calulated)',
  'Team 1,,,,,,,,,,,,,,0',
  'Team 8,75,600,5,6,,,,,,,150,150,,1030',
  'Sleighing it in Lycra,50,300,3,3,50,300,3,3,,,80,80,,573',
  'Team 11,,,,,,,,,,,,,,',
].join('\n');

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n');
  assert.deepStrictEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('extractMessage reads A2 under a "Message" header, and ignores other tabs', () => {
  assert.strictEqual(extractMessage(parseCsv('"Message"\n"Go team, 3 weeks to Santa! 🎅"\n')), 'Go team, 3 weeks to Santa! 🎅');
  assert.strictEqual(extractMessage(parseCsv('Message\n')), '');
  assert.strictEqual(extractMessage(parseCsv('Team Name,Run-total\nTeam 1,5\n')), null);
});

test('toNumber strips units and thousands separators', () => {
  assert.strictEqual(toNumber('1,234.5 km'), 1234.5);
  assert.strictEqual(toNumber(''), 0);
  assert.strictEqual(toNumber('n/a'), 0);
});

test('extractTeams reads the weekly and total columns of the real sheet layout', () => {
  const { teams } = extractTeams(parseCsv(SHEET));
  assert.deepStrictEqual(teams.map((t) => t.name), ['Team 1', 'Team 8', 'Sleighing it in Lycra', 'Team 11']);
  const lycra = teams[2];
  assert.strictEqual(lycra.key, 'slot:3');
  assert.deepStrictEqual(lycra.total, { run: 50, cycle: 300, swim: 3, strength: 3, charm: 0, hex: 80 });
  assert.deepStrictEqual(lycra.weekly, { run: 50, cycle: 300, swim: 3, strength: 3, charm: 0, hex: 80 });
  assert.strictEqual(lycra.sheetChallengeTotal, 573);
  assert.strictEqual(lycra.sheetWeeklyTotal, null); // that column is empty
  assert.strictEqual(teams[3].sheetChallengeTotal, null);
});

test('km use Run×4, Cycle×1, Swim×26, Strength×25, +Charm, −Hex and match the sheet', () => {
  const store = tmpStore();
  store.applyRows(extractTeams(parseCsv(SHEET)).teams, new Date('2026-11-26T12:00:00Z'));
  const state = computeState(store.data, route, config);
  const byName = Object.fromEntries(state.teams.map((t) => [t.name, t]));

  const t8 = byName['Team 8'];
  assert.deepStrictEqual([t8.totals.run, t8.totals.cycle, t8.totals.swim, t8.totals.strength], [300, 600, 130, 150]);
  assert.strictEqual(t8.totals.strengthSessions, 6);
  assert.strictEqual(t8.totals.hex, 150);
  assert.strictEqual(t8.totals.total, 1030);
  assert.strictEqual(byName['Sleighing it in Lycra'].totals.total, 573);
  assert.strictEqual(byName['Sleighing it in Lycra'].thisWeek.total, 573);

  // Three teams have a calculated challenge total; all three match.
  assert.strictEqual(state.validation.checked, 3);
  assert.deepStrictEqual(state.validation.mismatches, []);
  assert.deepStrictEqual(state.teams.map((t) => t.name).slice(0, 2), ['Team 8', 'Sleighing it in Lycra']);
});

test('a total that disagrees with the sheet is reported', () => {
  const store = tmpStore();
  const wrong = SHEET.replace(',150,150,,1030', ',150,150,,999');
  store.applyRows(extractTeams(parseCsv(wrong)).teams, new Date('2026-11-26T12:00:00Z'));
  const { validation } = computeState(store.data, route, config);
  assert.deepStrictEqual(validation.mismatches, [{ team: 'Team 8', which: 'challenge', ours: 1030, sheet: 999, ok: false }]);
});

test('weekly figures are saved per Sunday–Saturday week; the race total comes from the total columns', () => {
  const store = tmpStore();
  const row = (week, total) => ({
    key: 'slot:1', name: 'A',
    weekly: { run: week, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 },
    total: { run: total, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 },
  });
  store.applyRows([row(5, 5)], new Date('2026-11-21T10:00:00Z')); // Sat: week of Sun 15 Nov
  store.applyRows([row(8, 8)], new Date('2026-11-21T22:00:00Z')); // Sat night, same week
  store.applyRows([row(0, 8)], new Date('2026-11-22T09:00:00Z')); // Sun: sheet reset
  store.applyRows([row(2, 10)], new Date('2026-11-24T09:00:00Z')); // Tue

  const t = computeState(store.data, route, config).teams[0];
  assert.deepStrictEqual(t.weekly.map((w) => [w.week, w.raw.run, w.run]), [['2026-11-15', 8, 32], ['2026-11-22', 2, 8]]);
  assert.strictEqual(t.totals.total, 40);
  assert.strictEqual(t.thisWeek.total, 8);
});

test("on Sunday, figures the sheet hasn't zeroed yet still count for last week", () => {
  const store = tmpStore();
  const row = (run) => ({ key: 'slot:1', name: 'A', weekly: { run, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 }, total: null });
  store.applyRows([row(8)], new Date('2026-11-21T20:00:00Z')); // Sat
  store.applyRows([row(9)], new Date('2026-11-22T08:00:00Z')); // Sun, before reset (late entry)
  store.applyRows([row(0)], new Date('2026-11-22T12:00:00Z')); // Sun, reset
  store.applyRows([row(3)], new Date('2026-11-22T18:00:00Z')); // Sun, new week's first entry
  const { data } = store;
  assert.strictEqual(data.weeks['2026-11-15']['slot:1'].run, 9);
  assert.strictEqual(data.weeks['2026-11-22']['slot:1'].run, 3);
  // No total columns: the race total is the saved weeks added up.
  assert.strictEqual(computeState(data, route, config).teams[0].totals.total, (9 + 3) * 4);
});

test('on Sunday, a late entry from a team with nothing last week still counts for last week', () => {
  const store = tmpStore();
  const blank = { run: 0, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 };
  const rows = (a, b) => [
    { key: 'slot:1', name: 'A', weekly: { ...blank, run: a }, total: null },
    { key: 'slot:2', name: 'B', weekly: { ...blank, swim: b }, total: null },
  ];
  store.applyRows(rows(8, 0), new Date('2026-11-21T20:00:00Z')); // Sat: B has done nothing
  store.applyRows(rows(8, 1), new Date('2026-11-22T08:00:00Z')); // Sun, before reset: B logs Saturday's swim
  store.applyRows(rows(0, 0), new Date('2026-11-22T10:00:00Z')); // Sun: organiser zeroes the week
  store.applyRows(rows(0, 2), new Date('2026-11-22T18:00:00Z')); // Sun: B's first swim of the new week
  const { weeks } = store.data;
  assert.strictEqual(weeks['2026-11-15']['slot:2'].swim, 1);
  assert.strictEqual(weeks['2026-11-22']['slot:2'].swim, 2);
  assert.strictEqual(weeks['2026-11-15']['slot:1'].run, 8);
});

test('an entry added just before the Sunday reset, after our last read, still counts for last week', () => {
  const store = tmpStore();
  const blank = { run: 0, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 };
  const row = (weekRun, totalRun) => [{ key: 'slot:1', name: 'A', weekly: { ...blank, run: weekRun }, total: { ...blank, run: totalRun } }];
  store.applyRows(row(6, 18), new Date('2026-11-21T20:00:00Z')); // Sat
  store.applyRows(row(8, 20), new Date('2026-11-22T09:45:00Z')); // Sun, last read before the reset
  // 09:50 someone adds a 5 km run for Saturday (week 8 -> 13, total 20 -> 25); 10:00 the sheet is reset;
  // 10:05 the new week's first 2 km run (week 0 -> 2, total 25 -> 27).
  store.applyRows(row(2, 27), new Date('2026-11-22T10:15:00Z'));
  assert.strictEqual(store.data.weeks['2026-11-15']['slot:1'].run, 13);
  assert.strictEqual(store.data.weeks['2026-11-22']['slot:1'].run, 2);
});

test('store keeps history when a team is renamed', () => {
  const store = tmpStore();
  const row = (name) => ({ key: 'slot:1', name, weekly: {}, total: { run: 1 } });
  store.applyRows([row('Team 9')]);
  store.applyRows([row('Sleighing it in Lycra')]);
  store.save();
  const t = new Store(path.dirname(store.file)).data.teams['slot:1'];
  assert.strictEqual(t.name, 'Sleighing it in Lycra');
  assert.deepStrictEqual(t.previousNames, ['Team 9']);
  assert.strictEqual(t.styleIndex, 0);
});

test('saved weeks not named by a Sunday date are dropped on start-up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const weeks = { '2026-W44': { a: { run: 1 } }, 0: { a: { run: 1 } }, 573: { a: { run: 1 } }, '2026-10-25': { a: { run: 2 } } };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ version: 2, teams: {}, weeks }));
  const store = new Store(dir);
  assert.deepStrictEqual(store.data.weeks, { '2026-10-25': { a: { run: 2 } } });
  assert.strictEqual(store.data.version, 2);
});

test('weeks before CHALLENGE_START are not shown', () => {
  const data = { teams: {}, weeks: { '2026-10-25': {}, '2026-11-01': {}, '2026-11-08': {} } };
  const state = computeState(data, route, { ...config, challengeStart: '2026-11-03' });
  assert.deepStrictEqual(state.weeks, ['2026-11-01', '2026-11-08']);
  assert.deepStrictEqual(Object.values(state.weekLabels), ['Week 1 · 1–7 Nov', 'Week 2 · 8–14 Nov']);
});

test('hexes never push a team behind the start', () => {
  const data = {
    teams: { a: { key: 'a', name: 'A', styleIndex: 0, previousNames: [], latest: { total: { run: 1, hex: 50 } } } },
    weeks: {},
  };
  const t = computeState(data, route, config).teams[0];
  assert.strictEqual(t.totals.total, -46);
  assert.strictEqual(t.distanceKm, 0);
});

test('positionAt interpolates and clamps', () => {
  const r = { totalKm: 100, points: [[0, 0, 0], [0, 1, 50], [0, 2, 100]] };
  assert.deepStrictEqual(positionAt(r, -5), [0, 0]);
  assert.deepStrictEqual(positionAt(r, 75), [0, 1.5]);
  assert.deepStrictEqual(positionAt(r, 500), [0, 2]);
});

test('weeks start on Sunday in UK time, including across the clock change', () => {
  const tz = 'Europe/London';
  assert.strictEqual(weekStart(new Date('2026-10-24T22:59:00Z'), tz), '2026-10-18'); // Sat 23:59 BST
  assert.strictEqual(weekStart(new Date('2026-10-24T23:30:00Z'), tz), '2026-10-25'); // Sun 00:30 BST
  assert.strictEqual(weekStart(new Date('2026-11-28T23:59:00Z'), tz), '2026-11-22'); // Sat 23:59 GMT
  assert.strictEqual(isSunday(new Date('2026-11-29T00:01:00Z'), tz), true);
  assert.strictEqual(weekLabel('2026-11-22', '', tz), '22–28 Nov');
  assert.strictEqual(weekLabel('2026-11-29', '', tz), '29 Nov – 5 Dec');
  assert.strictEqual(weekLabel('2026-11-22', '2026-11-03', tz), 'Week 4 · 22–28 Nov');
  assert.strictEqual(weekLabel('573', '', tz), '573');
});
