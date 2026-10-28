#!/usr/bin/env node
// Plays the spreadsheet forward several weeks and runs the app's real
// reading/saving/scoring code against it, then checks every saved week and
// total against what the sheet's own formulas say.
//
// Starts from test/fixtures/data-tab-2026-11-26.csv (a copy of the real sheet's Data tab)
// and simulates up to Christmas Eve:
//   - teams log activities at random times; each one goes into both the
//     "-week" and the "-total" columns, as the organiser does
//   - charms and hexes are handed out
//   - placeholder teams are renamed when they join (and get the formulas)
//   - people add Saturday activities late on Sunday morning, and the
//     organiser zeroes the "-week" columns at 10:00 every Sunday
//   - the app reads the sheet every 15 minutes, like the live site
//
// Usage: node scripts/simulate.js [outDir] [--refresh=15] [--seed=1]
// Writes outDir/store.json (open it with DATA_DIR=outDir REFRESH_MINUTES=0 npm start),
// outDir/sheet-final.csv and outDir/report.md.

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, d) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || d;
const outDir = args.find((a) => !a.startsWith('--')) || fs.mkdtempSync(path.join(os.tmpdir(), 'tri-sim-'));
const REFRESH_MIN = +opt('refresh', 15);
let seed = +opt('seed', 1);

const config = require('../src/config');
const { parseCsv, extractTeams } = require('../src/sheet');
const { Store } = require('../src/store');
const { computeState, toKm } = require('../src/race');
const { weekStart, weekLabel } = require('../src/weeks');
const route = require('../route/route.json');

// ---- the spreadsheet ----
const fixture = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'data-tab-2026-11-26.csv'), 'utf8'));
const HEADER = fixture[0];
const col = (name) => HEADER.indexOf(name);
const C = {
  run: ['Run-total', 'Run-week'],
  virtualCycle: ['Virtual-Cycle Total', 'Virtual-Cycle-week'],
  outdoorCycle: ['Outdoor-Cycle-Total', 'Outdoor Cycle-week'],
  swim: ['Swim-Total', 'swim-week'],
  strength: ['Strength-total', 'Strength-week'],
  charm: ['Charm-total', 'Charm-week'],
  hex: ['Hex-total', 'Hex-Week'],
};
const WEEKLY_CALC = col('Weekly Total (Calulated)');
const CHALLENGE_CALC = col('Challenge Total (Calulated)');
const rows = fixture.slice(1).filter((r) => r[0]);
// Which rows have the organiser's formulas (now every row; earlier copies had gaps).
const formulas = rows.map((r) => ({ weekly: r[WEEKLY_CALC] !== '', challenge: r[CHALLENGE_CALC] !== '' }));

const n = (v) => (v === '' || v == null ? 0 : +v);
const cell = (r, name) => n(r[col(name)]);
const add = (r, name, v) => (r[col(name)] = String(+(cell(r, name) + v).toFixed(2)));
// The sheet's own formulas, copied from the workbook.
//   Weekly:    =((I2*4)+(J2*0.8)+K2+(M2*25)+(L2*26)+N2)-O2
//   Challenge: =((B2*4)+(C2*0.8)+D2+(E2*26)+(F2*25)+G2)-H2
const weeklyFormula = (r) =>
  cell(r, 'Run-week') * 4 + cell(r, 'Virtual-Cycle-week') * 0.8 + cell(r, 'Outdoor Cycle-week') + cell(r, 'Strength-week') * 25 +
  cell(r, 'swim-week') * 26 + cell(r, 'Charm-week') - cell(r, 'Hex-Week');
const challengeFormula = (r) =>
  cell(r, 'Run-total') * 4 + cell(r, 'Virtual-Cycle Total') * 0.8 + cell(r, 'Outdoor-Cycle-Total') + cell(r, 'Swim-Total') * 26 +
  cell(r, 'Strength-total') * 25 + cell(r, 'Charm-total') - cell(r, 'Hex-total');

function sheetCsv() {
  const out = [HEADER];
  rows.forEach((r, i) => {
    const copy = [...r];
    copy[WEEKLY_CALC] = formulas[i].weekly ? String(+weeklyFormula(r).toFixed(2)) : '';
    copy[CHALLENGE_CALC] = formulas[i].challenge ? String(+challengeFormula(r).toFixed(2)) : '';
    out.push(copy);
  });
  return out.map((r) => r.map((v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',')).join('\n') + '\n';
}

// ---- the story ----
// Everything is keyed by sheet row, so renames don't affect who logs what.
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const at = (iso) => Date.parse(iso); // the sheet is in UK time, which is UTC in Nov/Dec
const START = at('2026-11-26T12:00:00Z'); // the copy of the sheet is from Thu 26 Nov
const END = at('2026-12-24T18:00:00Z');
const RESET_HOUR = 10; // organiser zeroes the -week columns at 10:00 on Sundays

const row = (name) => rows.findIndex((r) => r[0] === name);
const TEAM8 = row('Team 8');
const LYCRA = row('Sleighing it in Lycra');
const TEAM3 = row('Team 3');
const TEAM11 = row('Team 11');
// When each row starts logging activities.
const activeFrom = { [TEAM8]: START, [LYCRA]: START, [TEAM3]: at('2026-11-29T14:00:00Z'), [TEAM11]: at('2026-12-05T12:00:00Z') };
const isActive = (i, t) => activeFrom[i] !== undefined && t >= activeFrom[i];

const events = []; // { t, run() -> description }
const log = (i, field, amount, note) => ({
  run: () => {
    add(rows[i], C[field][0], amount);
    add(rows[i], C[field][1], amount);
    return `${rows[i][0]}: +${+amount.toFixed(2)} ${field}${note ? ' (' + note + ')' : ''}`;
  },
});
const rename = (t, i, to, addFormulas) =>
  events.push({
    t,
    run: () => {
      const from = rows[i][0];
      rows[i][0] = to;
      if (addFormulas) formulas[i] = { weekly: true, challenge: true };
      return `"${from}" renamed to "${to}"${addFormulas ? ' (formulas added)' : ''}`;
    },
  });

// Team 3 joins as Jingle Joggers on Sunday morning and, before the reset, logs
// Saturday's swim: the only thing it did that week.
rename(at('2026-11-29T08:00:00Z'), TEAM3, 'Jingle Joggers');
events.push({ t: at('2026-11-29T08:20:00Z'), ...log(TEAM3, 'swim', 1.5, "Saturday's swim, logged late; nothing else that week") });
rename(at('2026-12-05T12:00:00Z'), TEAM11, "Rudolph's Rockets", true);
rename(at('2026-12-12T15:00:00Z'), TEAM8, 'Mince Pie Milers');

const sundays = [];
for (let day = at('2026-11-26T00:00:00Z'); day < END; day += DAY) {
  const weekday = new Date(day).getUTCDay();
  if (weekday === 0) sundays.push(day + RESET_HOUR * 60 * MIN);
  for (const i of Object.keys(activeFrom).map(Number)) {
    for (let k = Math.floor(between(0, 3)); k > 0; k--) {
      // Normal activities land between 07:00 and 22:00; on Sundays only after the reset.
      const t = day + between(weekday === 0 ? 11 * 60 : 7 * 60, 22 * 60) * MIN;
      if (t <= START || t >= END || !isActive(i, t)) continue;
      const field = pick(['run', 'run', 'virtualCycle', 'outdoorCycle', 'outdoorCycle', 'swim', 'strength']);
      const amount = { run: between(3, 15), virtualCycle: between(15, 60), outdoorCycle: between(15, 80), swim: between(0.5, 2.5), strength: 1 }[field];
      events.push({ t, ...log(i, field, amount) });
    }
    // Sunday morning, before the reset: Saturday's run, logged late.
    if (weekday === 0 && i !== TEAM3 && rand() < 0.6) {
      const t = day + between(7 * 60, RESET_HOUR * 60 - 1) * MIN;
      if (t > START && isActive(i, t - DAY)) events.push({ t, ...log(i, 'run', between(3, 10), "Saturday's run, logged late") });
    }
  }
  // A charm and a hex every Wednesday evening.
  if (weekday === 3) {
    const teams = Object.keys(activeFrom).map(Number).filter((i) => isActive(i, day));
    events.push({ t: day + 19 * 60 * MIN, ...log(pick(teams), 'charm', Math.round(between(2, 6)) * 10) });
    events.push({ t: day + 20 * 60 * MIN, ...log(pick(teams), 'hex', Math.round(between(1, 5)) * 10) });
  }
}
const timeline = events.filter((e) => e.t > START && e.t <= END).sort((a, b) => a.t - b.t);

// ---- run it ----
fs.rmSync(path.join(outDir, 'store.json'), { force: true });
const store = new Store(outDir, config.timeZone);
const truth = {}; // week -> slot -> { name, weekly: raw, calc }
const record = (week) => {
  truth[week] = {};
  rows.forEach((r, i) => {
    const raw = Object.fromEntries(Object.entries(C).map(([k, [, weekCol]]) => [k, cell(r, weekCol)]));
    truth[week]['slot:' + (i + 1)] = { name: r[0], raw, calc: weeklyFormula(r) };
  });
};

let refreshes = 0;
let checks = 0;
const mismatches = [];
let ei = 0;
let si = 0;
const activity = [];
const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
for (let t = START; t <= END; t += MIN) {
  while (ei < timeline.length && timeline[ei].t <= t) {
    const e = timeline[ei++];
    activity.push(`${stamp(e.t)}  ${e.run()}`);
  }
  if (si < sundays.length && sundays[si] <= t) {
    // The organiser zeroes the week columns. Record what the week ended on first.
    record(weekStart(new Date(sundays[si] - 24 * 60 * MIN), config.timeZone));
    for (const r of rows) for (const [, weekCol] of Object.values(C)) r[col(weekCol)] = '';
    activity.push(`${stamp(sundays[si])}  -- organiser zeroes the -week columns --`);
    si++;
  }
  if ((t - START) % (REFRESH_MIN * MIN) === 0) {
    store.applyRows(extractTeams(parseCsv(sheetCsv())).teams, new Date(t));
    const { validation } = computeState(store.data, route, config);
    refreshes++;
    checks += validation.checked;
    for (const m of validation.mismatches) mismatches.push({ at: new Date(t).toISOString(), ...m });
  }
}
record(weekStart(new Date(END), config.timeZone)); // the week still in progress
store.save();
fs.writeFileSync(path.join(outDir, 'sheet-final.csv'), sheetCsv());

// ---- compare ----
const state = computeState(store.data, route, config);
const lines = [];
const out = (s = '') => lines.push(s);
let weekOk = 0;
let weekBad = 0;
out('# Simulation report');
out();
out(`Simulated ${new Date(START).toUTCString()} to ${new Date(END).toUTCString()}; the app read the sheet every ${REFRESH_MIN} minutes (${refreshes} reads).`);
out();
out('## Weekly totals: sheet\'s "Weekly Total (Calulated)" at the end of each week vs what the app saved');
for (const [week, teams] of Object.entries(truth)) {
  out();
  out(`### ${weekLabel(week, '', config.timeZone)}`);
  out();
  out('| Team | Sheet (km) | App (km) | |');
  out('|---|---:|---:|---|');
  for (const [key, tr] of Object.entries(teams)) {
    const saved = store.data.weeks[week]?.[key];
    const app = saved ? toKm(saved, config.scale).total : 0;
    if (tr.calc === 0 && app === 0) continue; // placeholder teams with nothing logged
    const ok = Math.abs(app - tr.calc) < 0.01;
    ok ? weekOk++ : weekBad++;
    out(`| ${tr.name} | ${tr.calc.toFixed(1)} | ${app.toFixed(1)} | ${ok ? '✓' : '✗'} |`);
  }
}
out();
out('## Challenge totals at the end: sheet\'s "Challenge Total (Calulated)" vs app');
out();
out('| # | Team | Sheet (km) | App (km) | |');
out('|---:|---|---:|---:|---|');
let totalOk = 0;
let totalBad = 0;
for (const t of state.teams) {
  const r = rows[+t.key.split(':')[1] - 1];
  const sheet = challengeFormula(r);
  if (sheet === 0 && t.totals.total === 0) continue;
  const ok = Math.abs(sheet - t.totals.total) < 0.01;
  ok ? totalOk++ : totalBad++;
  out(`| ${t.rank} | ${t.name}${t.previousNames.length ? ' (was ' + t.previousNames.join(', ') + ')' : ''} | ${sheet.toFixed(1)} | ${t.totals.total.toFixed(1)} | ${ok ? '✓' : '✗'} |`);
}
out();
out('## Summary');
out();
out(`- Weekly totals matching the sheet: ${weekOk} of ${weekOk + weekBad}`);
out(`- Challenge totals matching the sheet: ${totalOk} of ${totalOk + totalBad}`);
out(`- Live checks against the sheet's calculated columns during the run: ${checks - mismatches.length} of ${checks} passed`);
for (const m of mismatches.slice(0, 10)) out(`  - ${m.at} ${m.team} ${m.which}: sheet ${m.sheet}, app ${m.ours}`);
out();
out('## Sheet activity log');
out();
out('```');
for (const l of activity) out(l);
out('```');
fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n') + '\n');

console.log(lines.slice(0, lines.indexOf('## Sheet activity log')).join('\n'));
console.log(`Full report with the activity log: ${path.join(outDir, 'report.md')}`);
process.exitCode = weekBad || totalBad || mismatches.length ? 1 : 0;
