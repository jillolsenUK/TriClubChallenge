const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseCsv, extractTeams, toNumber } = require('../src/sheet');
const { Store } = require('../src/store');
const { computeState, isoWeekLabel } = require('../src/race');
const { positionAt } = require('../src/geo');

const config = {
  totalsMode: 'weekly',
  challengeStart: '',
  scale: { run: 1, cycle: 1, swim: 1, strength: 1 },
};
const liveConfig = {
  ...config,
  scale: { ...config.scale, strength: 25 },
};
const route = {
  name: 'Test',
  totalKm: 100,
  points: [[0, 0, 0], [0, 1, 50], [0, 2, 100]],
};

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n');
  assert.deepStrictEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
});

test('toNumber strips units and thousands separators', () => {
  assert.strictEqual(toNumber('1,234.5 km'), 1234.5);
  assert.strictEqual(toNumber(''), 0);
  assert.strictEqual(toNumber('n/a'), 0);
});

test('extractTeams finds the header row and Run/Cycle/Swim/Strength total columns', () => {
  const csv = [
    'Club challenge,,,,,',
    'Team,Run,Run-Total,Cycle-Total,Swim-Total,Strength-total',
    'Red Rockets,1,10,20,3,4',
    'Blue Whales,2,"1,000",0,0,1',
    'Total,,,,,',
  ].join('\n');
  const { teams } = extractTeams(parseCsv(csv), '2026-W44');
  assert.strictEqual(teams.length, 2);
  assert.deepStrictEqual(teams[0], { key: 'slot:1', name: 'Red Rockets', week: '2026-W44', run: 10, cycle: 20, swim: 3, strength: 4, charm: 0, hex: 0 });
  assert.strictEqual(teams[1].run, 1000);
});

test('extractTeams uses a Week column when present', () => {
  const csv = 'Week,Team,Run-Total,Cycle-Total,Swim-Total,Strength-Total\n1,A,1,1,1,1\n1,B,2,2,2,2\n2,A,3,3,3,3\n';
  const { teams } = extractTeams(parseCsv(csv), 'ignored');
  assert.deepStrictEqual(teams.map((t) => [t.week, t.key, t.name]), [['1', 'slot:1', 'A'], ['1', 'slot:2', 'B'], ['2', 'slot:1', 'A']]);
});

test('store sums weekly totals and keeps history when a team is renamed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const store = new Store(dir);
  store.applyRows([{ key: 'slot:1', name: 'Team One', week: 'W1', run: 10, cycle: 20, swim: 1, strength: 2 }]);
  store.applyRows([{ key: 'slot:1', name: 'Team One', week: 'W1', run: 12, cycle: 20, swim: 1, strength: 2 }]); // same week updated
  store.applyRows([{ key: 'slot:1', name: 'Speedy', week: 'W2', run: 5, cycle: 0, swim: 0, strength: 0 }]);
  store.save();

  const reloaded = new Store(dir);
  const state = computeState(reloaded.data, route, config);
  const t = state.teams[0];
  assert.strictEqual(t.name, 'Speedy');
  assert.deepStrictEqual(t.previousNames, ['Team One']);
  assert.strictEqual(t.totals.total, 12 + 20 + 1 + 2 + 5);
  assert.strictEqual(t.weekly.length, 2);
  assert.strictEqual(t.distanceKm, 40);
  assert.deepStrictEqual(t.position, { lat: 0, lon: 0.8 });
});

test('cumulative mode uses only the latest week, and distance is capped at the finish', () => {
  const data = {
    teams: { a: { key: 'a', name: 'A', styleIndex: 0, previousNames: [] } },
    weeks: { 'Week 9': { a: { run: 50, cycle: 0, swim: 0, strength: 0 } }, 'Week 10': { a: { run: 150, cycle: 0, swim: 0, strength: 0 } } },
  };
  const state = computeState(data, route, { ...config, totalsMode: 'cumulative' });
  assert.deepStrictEqual(state.weeks, ['Week 9', 'Week 10']);
  assert.strictEqual(state.teams[0].totals.total, 150);
  assert.strictEqual(state.teams[0].distanceKm, 100);
  assert.strictEqual(state.teams[0].finished, true);
});

test('positionAt interpolates and clamps', () => {
  assert.deepStrictEqual(positionAt(route, -5), [0, 0]);
  assert.deepStrictEqual(positionAt(route, 75), [0, 1.5]);
  assert.deepStrictEqual(positionAt(route, 500), [0, 2]);
});

test('isoWeekLabel', () => {
  assert.strictEqual(isoWeekLabel(new Date('2026-10-27T12:00:00Z')), '2026-W44');
  assert.strictEqual(isoWeekLabel(new Date('2027-01-01T12:00:00Z')), '2026-W53');
});

test('strength sessions are worth 25 km, charms add and hexes subtract', () => {
  const csv = 'Team,Run-Total,Cycle-Total,Swim-Total,Strength-Total,Charm,Hex\nA,10,20,5,4,30,-15\n';
  const { teams } = extractTeams(parseCsv(csv), 'W1');
  assert.deepStrictEqual(teams[0], { key: 'slot:1', name: 'A', week: 'W1', run: 10, cycle: 20, swim: 5, strength: 4, charm: 30, hex: 15 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const store = new Store(dir);
  store.applyRows(teams);
  store.applyRows([{ key: 'slot:1', name: 'A', week: 'W2', run: 0, cycle: 0, swim: 0, strength: 1, charm: 0, hex: 5 }]);
  const t = computeState(store.data, { ...route, totalKm: 1000 }, liveConfig).teams[0];
  assert.deepStrictEqual(t.weekly.map((w) => w.total), [10 + 20 + 5 + 100 + 30 - 15, 25 - 5]);
  assert.strictEqual(t.weekly[0].strength, 100);
  assert.strictEqual(t.totals.strengthSessions, 5);
  assert.strictEqual(t.totals.charm, 30);
  assert.strictEqual(t.totals.hex, 20);
  assert.strictEqual(t.totals.total, 150 + 20);
});

test('hexes never push a team behind the start', () => {
  const data = {
    teams: { a: { key: 'a', name: 'A', styleIndex: 0, previousNames: [] } },
    weeks: { W1: { a: { run: 5, cycle: 0, swim: 0, strength: 0, charm: 0, hex: 50 } } },
  };
  const t = computeState(data, route, liveConfig).teams[0];
  assert.strictEqual(t.totals.total, -45);
  assert.strictEqual(t.distanceKm, 0);
  assert.deepStrictEqual(t.position, { lat: 0, lon: 0 });
});

test('weeks saved before charms and hexes existed still add up', () => {
  const data = {
    teams: { a: { key: 'a', name: 'A', styleIndex: 0, previousNames: [] } },
    weeks: { W1: { a: { run: 5, cycle: 5, swim: 0, strength: 2 } } },
  };
  const t = computeState(data, route, liveConfig).teams[0];
  assert.strictEqual(t.totals.total, 60);
  assert.strictEqual(t.totals.charm, 0);
});
