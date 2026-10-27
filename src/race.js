// Turns stored sheet values into km and race standings along the route.
//
// km = Run×4 + Cycle + Swim×26 + Strength×25 + Charm − Hex
// (multipliers from config.scale), the same formula as the sheet's
// "Challenge Total (Calculated)" column, which we check our sums against.

const { positionAt } = require('./geo');
const { weekLabel } = require('./weeks');

const DISCIPLINES = ['run', 'cycle', 'swim', 'strength'];
const FIELDS = [...DISCIPLINES, 'charm', 'hex'];

// Raw sheet values -> km for each field plus the combined total.
function toKm(raw, scale) {
  const out = { raw: {} };
  let sum = 0;
  for (const k of FIELDS) out.raw[k] = raw?.[k] || 0;
  for (const k of DISCIPLINES) {
    out[k] = out.raw[k] * scale[k];
    sum += out[k];
  }
  out.charm = out.raw.charm;
  out.hex = out.raw.hex;
  out.strengthSessions = out.raw.strength;
  out.total = sum + out.charm - out.hex;
  return out;
}

const addKm = (a, b) => {
  const out = { raw: {} };
  for (const k of FIELDS) out.raw[k] = (a.raw[k] || 0) + (b.raw[k] || 0);
  for (const k of [...FIELDS, 'strengthSessions', 'total']) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
};

function check(which, ours, sheet, tolerance) {
  if (sheet == null) return null;
  return { which, ours, sheet, ok: Math.abs(ours - sheet) <= tolerance };
}

function computeState(data, route, config) {
  const weekKeys = Object.keys(data.weeks).sort();
  const tolerance = config.validationTolerance ?? 0.5;

  const teams = Object.values(data.teams).map((t) => {
    const weekly = weekKeys
      .filter((w) => data.weeks[w][t.key])
      .map((w) => {
        const e = data.weeks[w][t.key];
        return { week: w, updatedAt: e.updatedAt, sheetWeeklyTotal: e.sheetWeeklyTotal ?? null, ...toKm(e, config.scale) };
      });

    // The sheet's challenge-total columns are the race total. Without them,
    // fall back to adding up the saved weeks.
    const latest = t.latest || {};
    const totals = latest.total
      ? toKm(latest.total, config.scale)
      : weekly.reduce(addKm, toKm(null, config.scale));
    const thisWeek = toKm(latest.weekly, config.scale);

    const checks = [
      check('week', thisWeek.total, latest.sheetWeeklyTotal, tolerance),
      check('challenge', totals.total, latest.sheetChallengeTotal, tolerance),
    ].filter(Boolean);

    // Hexes can push a team backwards, but never behind the start line.
    const distanceKm = Math.min(Math.max(totals.total, 0), route.totalKm);
    const [lat, lon] = positionAt(route, distanceKm);
    return {
      key: t.key,
      name: t.name,
      previousNames: t.previousNames,
      styleIndex: t.styleIndex,
      totals,
      thisWeek,
      weekly,
      checks,
      distanceKm,
      remainingKm: route.totalKm - distanceKm,
      progress: route.totalKm ? distanceKm / route.totalKm : 0,
      finished: totals.total >= route.totalKm,
      position: { lat, lon },
      lastSeen: t.lastSeen,
    };
  });

  teams.sort((a, b) => b.totals.total - a.totals.total || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const leader = teams[0] ? teams[0].distanceKm : 0;
  teams.forEach((t, i) => {
    t.rank = i + 1;
    t.behindLeaderKm = leader - t.distanceKm;
  });

  const mismatches = teams.flatMap((t) => t.checks.filter((c) => !c.ok).map((c) => ({ team: t.name, ...c })));
  return {
    route: { name: route.name, totalKm: route.totalKm },
    weeks: weekKeys,
    weekLabels: Object.fromEntries(weekKeys.map((w) => [w, weekLabel(w, config.challengeStart, config.timeZone)])),
    scale: config.scale,
    teams,
    validation: { checked: teams.reduce((n, t) => n + t.checks.length, 0), mismatches },
    lastFetch: data.lastFetch,
    lastError: data.lastError,
  };
}

module.exports = { computeState, toKm };
