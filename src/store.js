// JSON file store for teams and their weekly figures.
// Shape (version 2):
//   teams: { [key]: { key, name, styleIndex, firstSeen, lastSeen, previousNames: [],
//                     latest: { weekly, total, sheetWeeklyTotal, sheetChallengeTotal, at } } }
//   weeks: { [sundayDate]: { [teamKey]: { run, cycle, swim, strength, charm, hex,
//                                         sheetWeeklyTotal, updatedAt } } }
//   lastFetch, lastError
// `weekly`/`total` hold the raw sheet values; km are worked out in race.js.

const fs = require('fs');
const path = require('path');
const { weekStart, previousWeek, isSunday } = require('./weeks');

const FIELDS = ['run', 'cycle', 'swim', 'strength', 'charm', 'hex'];
const VERSION = 2;

class Store {
  constructor(dir, timeZone = 'Europe/London') {
    this.file = path.join(dir, 'store.json');
    this.timeZone = timeZone;
    fs.mkdirSync(dir, { recursive: true });
    this.data = { version: VERSION, teams: {}, weeks: {}, lastFetch: null, lastError: null };
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Version 1 saved the sheet's challenge totals under ISO week labels
      // ("2026-W44") as if they were weekly figures. They can't be turned into
      // real weekly figures, and the race total now comes from the sheet's total
      // columns, so drop them.
      if (!saved.version) {
        for (const w of Object.keys(saved.weeks || {})) if (/^\d{4}-W\d{2}$/.test(w)) delete saved.weeks[w];
        saved.version = VERSION;
      }
      this.data = { ...this.data, ...saved };
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Which week a team's weekly columns belong to right now. The sheet zeroes
  // them some time on Sunday; until it has (the figures haven't dropped below
  // what we saved for last week), Sunday's figures still belong to last week.
  weekFor(teamKey, weekly, now) {
    const current = weekStart(now, this.timeZone);
    if (!isSunday(now, this.timeZone) || this.data.weeks[current]?.[teamKey]) return current;
    const last = this.data.weeks[previousWeek(current)]?.[teamKey];
    const sum = (o) => FIELDS.reduce((a, k) => a + (o[k] || 0), 0);
    const notReset = last && sum(last) > 0 && FIELDS.every((k) => (weekly[k] || 0) >= (last[k] || 0));
    return notReset ? previousWeek(current) : current;
  }

  // Record one refresh worth of team entries from the sheet.
  applyRows(rows, now = new Date()) {
    const ts = now.toISOString();
    const { teams, weeks } = this.data;
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
      }
      t.lastSeen = ts;
      t.latest = {
        weekly: r.weekly,
        total: r.total,
        sheetWeeklyTotal: r.sheetWeeklyTotal ?? null,
        sheetChallengeTotal: r.sheetChallengeTotal ?? null,
        at: ts,
      };

      const week = this.weekFor(r.key, r.weekly, now);
      weeks[week] = weeks[week] || {};
      weeks[week][r.key] = { ...r.weekly, sheetWeeklyTotal: r.sheetWeeklyTotal ?? null, updatedAt: ts };
    }
    this.data.lastFetch = ts;
    this.data.lastError = null;
  }
}

module.exports = { Store, FIELDS };
