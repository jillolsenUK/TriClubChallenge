// Turns stored weekly totals into race standings along the route.

const { positionAt } = require('./geo');

const DISCIPLINES = ['run', 'cycle', 'swim', 'strength'];
const SUMMED = [...DISCIPLINES, 'strengthSessions', 'charm', 'hex', 'total'];
const DAY_MS = 24 * 60 * 60 * 1000;

function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function currentWeekLabel(config, now = new Date()) {
  if (config.challengeStart) {
    const start = new Date(config.challengeStart + 'T00:00:00Z');
    if (!isNaN(start)) return `Week ${Math.max(1, Math.floor((now - start) / (7 * DAY_MS)) + 1)}`;
  }
  return isoWeekLabel(now);
}

// Natural sort so "Week 10" comes after "Week 9".
const weekCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function computeState(data, route, config) {
  const weekLabels = Object.keys(data.weeks).sort(weekCompare);
  const teams = Object.values(data.teams).map((t) => {
    const weekly = weekLabels
      .filter((w) => data.weeks[w][t.key])
      .map((w) => {
        const e = data.weeks[w][t.key];
        const row = { week: w, updatedAt: e.updatedAt, strengthSessions: e.strength || 0 };
        let sum = 0;
        for (const k of DISCIPLINES) {
          row[k] = (e[k] || 0) * config.scale[k];
          sum += row[k];
        }
        row.charm = e.charm || 0;
        row.hex = e.hex || 0;
        row.total = sum + row.charm - row.hex;
        return row;
      });

    const totals = Object.fromEntries(SUMMED.map((k) => [k, 0]));
    const counted = config.totalsMode === 'cumulative' ? weekly.slice(-1) : weekly;
    for (const w of counted) for (const k of SUMMED) totals[k] += w[k];

    // Hexes can push a team backwards, but never behind the start line.
    const distanceKm = Math.min(Math.max(totals.total, 0), route.totalKm);
    const [lat, lon] = positionAt(route, distanceKm);
    return {
      key: t.key,
      name: t.name,
      previousNames: t.previousNames,
      styleIndex: t.styleIndex,
      totals,
      weekly,
      distanceKm,
      remainingKm: route.totalKm - distanceKm,
      progress: route.totalKm ? distanceKm / route.totalKm : 0,
      finished: totals.total >= route.totalKm,
      position: { lat, lon },
      lastSeen: t.lastSeen,
    };
  });

  teams.sort((a, b) => b.totals.total - a.totals.total || a.name.localeCompare(b.name));
  const leader = teams[0] ? teams[0].distanceKm : 0;
  teams.forEach((t, i) => {
    t.rank = i + 1;
    t.behindLeaderKm = leader - t.distanceKm;
  });

  return {
    route: { name: route.name, totalKm: route.totalKm },
    weeks: weekLabels,
    teams,
    lastFetch: data.lastFetch,
    lastError: data.lastError,
    totalsMode: config.totalsMode,
  };
}

module.exports = { computeState, currentWeekLabel, isoWeekLabel, weekCompare };
