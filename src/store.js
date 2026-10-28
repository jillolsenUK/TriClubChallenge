// JSON file store for teams and their weekly figures.
// Shape (version 4):
//   teams: { [key]: { key, name, styleIndex, firstSeen, lastSeen, previousNames: [],
//                     latest: { weekly, total, sheetWeeklyTotal, sheetChallengeTotal, at } } }
//   weeks: { [sundayDate]: { [teamKey]: { run, virtualCycle, outdoorCycle, swim, strength, charm, hex,
//                                         sheetWeeklyTotal, updatedAt } } }
//   resetSeen: { [sundayDate]: true }  (the sheet's weekly columns have been zeroed for that week)
//   lastWeek: the week the previous refresh saved into
//   message: the banner text from the sheet's Message tab
//   images: { [normalised team name]: { file, large, name } } pictures from the Images tab
//   prizes: { [spot id]: { code, claimedAt } } the hidden map prizes
//   lastFetch, lastError
// `weekly`/`total` hold the raw sheet values; km are worked out in race.js.

const fs = require('fs');
const path = require('path');
const { weekStart, previousWeek, isSunday, isWeekKey } = require('./weeks');

const FIELDS = ['run', 'virtualCycle', 'outdoorCycle', 'swim', 'strength', 'charm', 'hex'];
const VERSION = 4;

// Before version 4 there was one "cycle" field; it's what's now outdoor cycling (no multiplier).
function splitCycle(o) {
  if (!o || !('cycle' in o)) return;
  o.outdoorCycle = (o.outdoorCycle || 0) + (o.cycle || 0);
  o.virtualCycle = o.virtualCycle || 0;
  delete o.cycle;
}

class Store {
  constructor(dir, timeZone = 'Europe/London') {
    this.file = path.join(dir, 'store.json');
    this.timeZone = timeZone;
    fs.mkdirSync(dir, { recursive: true });
    this.data = { version: VERSION, teams: {}, weeks: {}, resetSeen: {}, lastFetch: null, lastError: null };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Earlier versions saved figures under other week names: ISO weeks
      // ("2026-W44"), or values from the "Weekly Total (Calulated)" column, which
      // was mistaken for a week number. Those aren't real weekly figures (the
      // race total comes from the sheet's total columns), so keep only weeks
      // named by their Sunday's date.
      for (const w of Object.keys(saved.weeks || {})) if (!isWeekKey(w)) delete saved.weeks[w];
      // Before version 3, those mixed-up early figures also recorded "renames"
      // that never happened (rows were matched up wrongly), so start the name
      // history afresh.
      if ((saved.version || 0) < 3) for (const t of Object.values(saved.teams || {})) t.previousNames = [];
      if ((saved.version || 0) < 4) {
        for (const w of Object.values(saved.weeks || {})) for (const e of Object.values(w)) splitCycle(e);
        for (const t of Object.values(saved.teams || {})) {
          splitCycle(t.latest?.weekly);
          splitCycle(t.latest?.total);
        }
      }
      saved.version = VERSION;
      this.data = { ...this.data, ...saved };
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Which week the sheet's weekly columns belong to right now. The organiser
  // zeroes them for every team some time on Sunday. Until that has happened
  // (no team's figures have dropped below what we saved for last week),
  // Sunday's figures, including late entries, still belong to last week.
  weekFor(rows, now) {
    const current = weekStart(now, this.timeZone);
    if (!isSunday(now, this.timeZone) || this.data.resetSeen[current]) return current;
    const last = this.data.weeks[previousWeek(current)] || {};
    const sum = (o) => FIELDS.reduce((a, k) => a + (o[k] || 0), 0);
    const hadLastWeek = rows.filter((r) => last[r.key] && sum(last[r.key]) > 0);
    if (!hadLastWeek.length) return current; // nothing to tell a reset by
    const dropped = hadLastWeek.some((r) => FIELDS.some((k) => (r.weekly[k] || 0) < (last[r.key][k] || 0)));
    if (!dropped) return previousWeek(current);
    this.data.resetSeen[current] = true;
    return current;
  }

  // Record one refresh worth of team entries from the sheet.
  applyRows(rows, now = new Date()) {
    const ts = now.toISOString();
    const { teams, weeks } = this.data;
    const week = this.weekFor(rows, now);
    // First read of a new week: catch up anything added to last week after our
    // last read of it (e.g. just before the Sunday reset).
    const rolledOver = this.data.lastWeek && week !== this.data.lastWeek && previousWeek(week) === this.data.lastWeek;
    for (const r of rows) {
      let t = teams[r.key];
      if (!t) {
        t = teams[r.key] = {
          key: r.key,
          name: r.name,
          styleIndex: Object.keys(teams).length,
          firstSeen: ts,
          previousNames: [],
        };
      } else if (t.name !== r.name) {
        if (!t.previousNames.includes(t.name)) t.previousNames.push(t.name);
        t.name = r.name;
        // Renamed back to an earlier name: it's the current name again, not a former one.
        t.previousNames = t.previousNames.filter((n) => n !== t.name);
      }
      t.lastSeen = ts;
      if (rolledOver) this.catchUp(this.data.lastWeek, t.latest, r);
      t.latest = {
        weekly: r.weekly,
        total: r.total,
        sheetWeeklyTotal: r.sheetWeeklyTotal ?? null,
        sheetChallengeTotal: r.sheetChallengeTotal ?? null,
        at: ts,
      };

      weeks[week] = weeks[week] || {};
      weeks[week][r.key] = { ...r.weekly, sheetWeeklyTotal: r.sheetWeeklyTotal ?? null, updatedAt: ts };
    }
    this.data.lastWeek = week;
    this.data.lastFetch = ts;
    this.data.lastError = null;
  }

  // Every entry goes into both a team's weekly and total columns, so between
  // our last read of last week and this first read of the new one:
  //   total now − total then = (late additions to last week) + (new week so far).
  // Whatever the new week's figures don't account for belongs to last week.
  catchUp(lastWeek, before, r) {
    const saved = this.data.weeks[lastWeek]?.[r.key];
    if (!saved || !before?.total || !r.total) return;
    for (const k of FIELDS) {
      const late = (r.total[k] || 0) - (before.total[k] || 0) - (r.weekly[k] || 0);
      if (late > 1e-9) saved[k] = +((saved[k] || 0) + late).toFixed(6);
    }
  }
}

module.exports = { Store, FIELDS };
