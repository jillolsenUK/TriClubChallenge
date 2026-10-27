// JSON file store for teams and their weekly totals.
// Shape:
//   teams: { [key]: { key, name, styleIndex, firstSeen, lastSeen, previousNames: [] } }
//   weeks: { [weekLabel]: { [teamKey]: { run, cycle, swim, strength, charm, hex, updatedAt } } }
//   lastFetch, lastError

const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'store.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = { teams: {}, weeks: {}, lastFetch: null, lastError: null };
    if (fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Record one refresh worth of rows from the sheet.
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
      weeks[r.week] = weeks[r.week] || {};
      weeks[r.week][r.key] = {
        run: r.run,
        cycle: r.cycle,
        swim: r.swim,
        strength: r.strength,
        charm: r.charm || 0,
        hex: r.hex || 0,
        updatedAt: ts,
      };
    }
    this.data.lastFetch = ts;
    this.data.lastError = null;
  }
}

module.exports = { Store };
