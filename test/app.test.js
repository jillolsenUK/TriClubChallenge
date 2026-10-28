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
const { extractTeamImages, saveThumbnails } = require('../src/images');
const { ensurePrize, claimPrize } = require('../src/northpole');
const { zipSync, strToU8 } = require('fflate');
const sharp = require('sharp');

const config = {
  timeZone: 'Europe/London',
  challengeStart: '',
  validationTolerance: 0.5,
  scale: { run: 4, virtualCycle: 0.8, outdoorCycle: 1, swim: 26, strength: 25 },
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
  assert.deepStrictEqual(lycra.total, { run: 50, virtualCycle: 0, outdoorCycle: 300, swim: 3, strength: 3, charm: 0, hex: 80 });
  assert.deepStrictEqual(lycra.weekly, { run: 50, virtualCycle: 0, outdoorCycle: 300, swim: 3, strength: 3, charm: 0, hex: 80 });
  assert.strictEqual(lycra.sheetChallengeTotal, 573);
  assert.strictEqual(lycra.sheetWeeklyTotal, null); // that column is empty
  assert.strictEqual(teams[3].sheetChallengeTotal, null);
});

// The Data tab from "Tri before christmas Output November 26 (5).xlsx", with figures filled in.
const DATA_TAB = [
  'Team Name,Run-total,Virtual-Cycle Total,Outdoor-Cycle-Total,Swim-Total,Strength-total,Charm-total,Hex-total,Run-week,Virtual-Cycle-week,Outdoor Cycle-week,swim-week,Strength-week,Charm-week,Hex-Week,Weekly Total (Calulated),Challenge Total (Calulated)',
  // weekly: 10×4 + 50×0.8 + 30 + 1×26 + 1×25 + 20 − 5 = 176
  // total:  60×4 + 200×0.8 + 300 + 4×26 + 3×25 + 40 − 25 = 894
  'Sleighing it in Lycra,60,200,300,4,3,40,25,10,50,30,1,1,20,5,176,894',
  'Team 1,,,,,,,,,,,,,,,0,0',
].join('\n');

test('the Data tab: Virtual-Cycle (×0.8) and Outdoor-Cycle (×1) are read and scored separately', () => {
  const { teams } = extractTeams(parseCsv(DATA_TAB));
  assert.deepStrictEqual(teams[0].total, { run: 60, virtualCycle: 200, outdoorCycle: 300, swim: 4, strength: 3, charm: 40, hex: 25 });
  assert.deepStrictEqual(teams[0].weekly, { run: 10, virtualCycle: 50, outdoorCycle: 30, swim: 1, strength: 1, charm: 20, hex: 5 });
  const store = tmpStore();
  store.applyRows(teams, new Date('2026-11-26T12:00:00Z'));
  const state = computeState(store.data, route, config);
  const t = state.teams[0];
  assert.deepStrictEqual([t.totals.virtualCycle, t.totals.outdoorCycle], [160, 300]);
  assert.strictEqual(t.totals.total, 894);
  assert.strictEqual(t.thisWeek.total, 176);
  assert.strictEqual(state.validation.checked, 4);
  assert.deepStrictEqual(state.validation.mismatches, []);
});

test('saved figures from before the cycle split count as outdoor cycling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const saved = {
    version: 3,
    teams: { a: { key: 'a', name: 'A', styleIndex: 0, previousNames: ['B'], latest: { weekly: { run: 1, cycle: 40 }, total: { run: 2, cycle: 90 } } } },
    weeks: { '2026-11-22': { a: { run: 1, cycle: 40, swim: 0 } } },
  };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(saved));
  const { data } = new Store(dir);
  assert.deepStrictEqual(data.weeks['2026-11-22'].a, { run: 1, outdoorCycle: 40, virtualCycle: 0, swim: 0 });
  assert.deepStrictEqual(data.teams.a.latest.total, { run: 2, outdoorCycle: 90, virtualCycle: 0 });
  assert.deepStrictEqual(data.teams.a.previousNames, ['B']); // only version < 3 clears the name history
  assert.strictEqual(computeState(data, route, config).teams[0].totals.total, 2 * 4 + 90);
});

test('the reordered Sheet1 columns (charm/hex totals moved, week columns reordered) read the same', () => {
  const csv = [
    'Team Name,Run-total,Cycle-Total,Swim-Total,Strength-total,Charm-total,Hex-total,Run-week,Cycle-week,swim-week,Strength-week,Charm-week,Hex-Week,Weekly Total (Calulated),Challenge Total (Calulated)',
    'Sleighing it in Lycra,50,300,3,3,10,80,20,100,1,2,5,30,231,583',
  ].join('\n');
  const [t] = extractTeams(parseCsv(csv)).teams;
  assert.deepStrictEqual(t.total, { run: 50, virtualCycle: 0, outdoorCycle: 300, swim: 3, strength: 3, charm: 10, hex: 80 });
  assert.deepStrictEqual(t.weekly, { run: 20, virtualCycle: 0, outdoorCycle: 100, swim: 1, strength: 2, charm: 5, hex: 30 });
  const store = tmpStore();
  store.applyRows([t], new Date('2026-11-26T12:00:00Z'));
  assert.deepStrictEqual(computeState(store.data, route, config).validation.mismatches, []);
});

test('old layout: a plain Cycle column counts as outdoor cycling; km match the sheet', () => {
  const store = tmpStore();
  store.applyRows(extractTeams(parseCsv(SHEET)).teams, new Date('2026-11-26T12:00:00Z'));
  const state = computeState(store.data, route, config);
  const byName = Object.fromEntries(state.teams.map((t) => [t.name, t]));

  const t8 = byName['Team 8'];
  assert.deepStrictEqual([t8.totals.run, t8.totals.outdoorCycle, t8.totals.swim, t8.totals.strength], [300, 600, 130, 150]);
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
    weekly: { run: week, virtualCycle: 0, outdoorCycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 },
    total: { run: total, virtualCycle: 0, outdoorCycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 },
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
  const row = (run) => ({ key: 'slot:1', name: 'A', weekly: { run, virtualCycle: 0, outdoorCycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 }, total: null });
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
  const blank = { run: 0, virtualCycle: 0, outdoorCycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 };
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
  const blank = { run: 0, virtualCycle: 0, outdoorCycle: 0, swim: 0, strength: 0, charm: 0, hex: 0 };
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

test("a team's current name is never listed as a former name, and old stores start their name history afresh", () => {
  const store = tmpStore();
  const row = (name) => ({ key: 'slot:1', name, weekly: {}, total: { run: 1 } });
  for (const name of ['Team 9', 'Sleighing it in Lycra', 'Team 9', 'Sleighing it in Lycra']) store.applyRows([row(name)]);
  assert.deepStrictEqual(store.data.teams['slot:1'].previousNames, ['Team 9']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const teams = { 'slot:9': { key: 'slot:9', name: 'Sleighing it in Lycra', styleIndex: 8, previousNames: ['Team 9', 'Sleighing it in Lycra', 'Team 17'] } };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ version: 2, teams, weeks: {} }));
  const t = new Store(dir).data.teams['slot:9'];
  assert.deepStrictEqual(t.previousNames, []);
  assert.strictEqual(t.styleIndex, 8); // keeps its icon
});

test('saved weeks not named by a Sunday date are dropped on start-up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-'));
  const weeks = { '2026-W44': { a: { run: 1 } }, 0: { a: { run: 1 } }, 573: { a: { run: 1 } }, '2026-10-25': { a: { run: 2 } } };
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ version: 2, teams: {}, weeks }));
  const store = new Store(dir);
  assert.deepStrictEqual(store.data.weeks, { '2026-10-25': { a: { run: 2 } } });
  assert.strictEqual(store.data.version, 4);
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

// A minimal .xlsx like Google's export: an "Images" tab with team names in row 1
// and pictures anchored to the cells below them.
async function workbookWithPictures() {
  const png = (r, g, b) => sharp({ create: { width: 300, height: 300, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const [red, blue] = await Promise.all([png(200, 0, 0), png(0, 0, 200)]);
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (...r) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join('')}</Relationships>`;
  const anchor = (col, row, id) =>
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="1" cy="1"/><xdr:pic><xdr:blipFill><a:blip r:embed="${id}"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>`;
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Images" sheetId="3" r:id="rId3"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(rels(rel('rId1', 'worksheet', 'worksheets/sheet1.xml'), rel('rId3', 'worksheet', 'worksheets/sheet3.xml'))),
    'xl/sharedStrings.xml': strToU8("<sst><si><t>Team 1</t></si><si><t>Lapping&apos; Around the Christmas Tree</t></si><si><r><t>Sleighing it </t></r><r><t>in Lycra</t></r></si></sst>"),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData/></worksheet>'),
    'xl/worksheets/sheet3.xml': strToU8('<worksheet xmlns:r="r"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="G1" t="s"><v>2</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>'),
    'xl/worksheets/_rels/sheet3.xml.rels': strToU8(rels(rel('rId1', 'drawing', '../drawings/drawing3.xml'))),
    'xl/drawings/drawing3.xml': strToU8(`<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:r="r">${anchor(1, 1, 'rId1')}${anchor(6, 1, 'rId2')}${anchor(9, 1, 'rId1')}${anchor(6, 0, 'rId1')}</xdr:wsDr>`),
    'xl/drawings/_rels/drawing3.xml.rels': strToU8(rels(rel('rId1', 'image', '../media/image1.png'), rel('rId2', 'image', '../media/image2.png'))),
    'xl/media/image1.png': new Uint8Array(red),
    'xl/media/image2.png': new Uint8Array(blue),
  }));
}

test('team pictures are read from the Images tab and matched to the header above them', async () => {
  const pictures = extractTeamImages(await workbookWithPictures(), 'Images');
  // Team 1 has no picture; the picture in column J has no header; the one over the header row itself is ignored.
  assert.deepStrictEqual(pictures.map((p) => p.name).sort(), ["Lapping' Around the Christmas Tree", 'Sleighing it in Lycra']);
  assert.strictEqual(extractTeamImages(await workbookWithPictures(), 'Pictures'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tri-img-'));
  const saved = await saveThumbnails(pictures, dir);
  const meta = await sharp(path.join(dir, saved.sleighingitinlycra.file)).metadata();
  assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 128, 128]);
  const large = await sharp(path.join(dir, saved.sleighingitinlycra.large)).metadata();
  assert.deepStrictEqual([large.width, large.height], [480, 480]);

  // Teams with a picture get it (matched by name); the rest keep their emoji markers.
  const data = {
    teams: {
      'slot:2': { key: 'slot:2', name: "Lapping' Around the Christmas Tree", styleIndex: 1, previousNames: [] },
      'slot:3': { key: 'slot:3', name: 'Team 3', styleIndex: 2, previousNames: [] },
    },
    weeks: {},
    images: saved,
  };
  const byName = Object.fromEntries(computeState(data, route, config).teams.map((t) => [t.name, t.image]));
  assert.strictEqual(byName["Lapping' Around the Christmas Tree"], 'team-images/' + saved.lappingaroundthechristmastree.file);
  assert.strictEqual(byName['Team 3'], null);
});

test('the North Pole prize goes to the first finder only, and a new code starts a new hunt', () => {
  const data = {};
  const cfg = { northPoleCode: 'SANTA-50', northPoleKm: 50 };
  assert.deepStrictEqual(claimPrize(data, cfg, new Date('2026-11-05T10:00:00Z')), { found: true, code: 'SANTA-50', km: 50 });
  assert.deepStrictEqual(claimPrize(data, cfg), { found: false, claimedAt: '2026-11-05T10:00:00.000Z', km: 50 });
  // Changing the code re-hides the prize.
  assert.strictEqual(claimPrize(data, { ...cfg, northPoleCode: 'ELF-77' }).code, 'ELF-77');
  // Without a configured code a random one is made, and kept.
  const d2 = {};
  ensurePrize(d2, { northPoleCode: '' });
  assert.match(d2.northPole.code, /^POLE-[A-HJ-NP-Z2-9]{6}$/);
  assert.strictEqual(ensurePrize(d2, { northPoleCode: '' }), false);
  // The code is never part of the state sent to every page.
  assert.ok(!JSON.stringify(computeState({ teams: {}, weeks: {}, northPole: d2.northPole }, route, config)).includes(d2.northPole.code));
});
