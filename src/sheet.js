// Reads the public Google Sheet as CSV and turns it into one entry per team:
//   { key, name, weekly: {run, cycle, swim, strength, charm, hex},
//     total: {...same fields...} | null, sheetWeeklyTotal, sheetChallengeTotal }
// The sheet has a "weekly" column (zeroed every Sunday) and a challenge
// "total" column for each field. Columns are found by header name, so the
// sheet can be rearranged freely.

const config = require('./config');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELDS = {
  run: ['run', 'running'],
  cycle: ['cycle', 'cycling', 'bike', 'ride'],
  swim: ['swim', 'swimming'],
  strength: ['strength', 'gym', 'weights'],
  // Bonus (charm) and penalty (hex) km, applied on top of the disciplines.
  charm: ['charm'],
  hex: ['hex'],
};
const FIELD_KEYS = Object.keys(FIELDS);
const DISCIPLINE_KEYS = ['run', 'cycle', 'swim', 'strength'];

const isWeekly = (x) => x.includes('week') && !x.includes('challenge');
const isTotal = (x) => (x.includes('total') || x.includes('challenge')) && !x.includes('week');

// Find the weekly and the challenge-total column for each field, plus the
// sheet's own calculated totals ("Weekly Total (Calculated)" and
// "Challenge Total (Calculated)"), which are used to check our sums.
function mapColumns(header) {
  const h = header.map(norm);
  const byName = (name) => h.indexOf(norm(name));
  const cols = { weekly: {}, total: {} };

  for (const [key, words] of Object.entries(FIELDS)) {
    const o = config.columns;
    if (o[key + 'Weekly'] || o[key + 'Total']) {
      cols.weekly[key] = o[key + 'Weekly'] ? byName(o[key + 'Weekly']) : -1;
      cols.total[key] = o[key + 'Total'] ? byName(o[key + 'Total']) : -1;
      continue;
    }
    const candidates = h.map((x, i) => (words.some((w) => x.includes(w)) ? i : -1)).filter((i) => i >= 0);
    let weekly = candidates.find((i) => isWeekly(h[i]));
    let total = candidates.find((i) => isTotal(h[i]));
    // Fall back to a bare "Run" column next to "Run-Total" (or vice versa).
    const rest = candidates.filter((i) => i !== weekly && i !== total);
    if (weekly === undefined && total !== undefined && rest.length) weekly = rest[0];
    if (total === undefined && weekly !== undefined && rest.length) total = rest[0];
    if (weekly === undefined && total === undefined && rest.length) total = rest[0];
    cols.weekly[key] = weekly ?? -1;
    cols.total[key] = total ?? -1;
  }

  const noField = (x) => !FIELD_KEYS.some((k) => FIELDS[k].some((w) => x.includes(w)));
  cols.sheetWeeklyTotal = config.columns.weeklyCalculated
    ? byName(config.columns.weeklyCalculated)
    : h.findIndex((x) => noField(x) && x.includes('week') && x.includes('total'));
  cols.sheetChallengeTotal = config.columns.challengeCalculated
    ? byName(config.columns.challengeCalculated)
    : h.findIndex((x) => noField(x) && x.includes('challenge') && x.includes('total'));

  cols.team = config.columns.team
    ? byName(config.columns.team)
    : h.findIndex((x) => x === 'team' || x === 'teamname' || x === 'name' || (x.includes('team') && x.includes('name')));
  if (cols.team < 0) cols.team = h.findIndex((x) => x.includes('team') && !/(id|no|number|num)$/.test(x));

  cols.id = config.columns.id ? byName(config.columns.id) : h.findIndex((x) => /^team(id|no|number|num)$/.test(x) || x === 'id');
  return cols;
}

function toNumber(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractTeams(rows) {
  let headerIdx = -1;
  let cols;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = mapColumns(rows[i]);
    const found = DISCIPLINE_KEYS.filter((k) => c.weekly[k] >= 0 || c.total[k] >= 0).length;
    if (c.team >= 0 && found >= 2) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Could not find a header row with a Team column and Run/Cycle/Swim/Strength columns');
  }
  const hasTotals = DISCIPLINE_KEYS.some((k) => cols.total[k] >= 0);

  const out = [];
  let slot = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const name = String(r[cols.team] || '').trim();
    if (!name || /^(total|totals|grand total)$/i.test(name)) continue;
    slot++;
    let key;
    if (cols.id >= 0 && String(r[cols.id] || '').trim()) key = 'id:' + String(r[cols.id]).trim();
    else if (config.teamKey === 'name') key = 'name:' + norm(name);
    else key = 'slot:' + slot;

    // Charms and hexes are always amounts: a charm adds km and a hex takes km
    // away, whether the sheet writes the hex as 50 or -50.
    const read = (map) => {
      const o = {};
      for (const k of FIELD_KEYS) {
        const v = map[k] >= 0 ? toNumber(r[map[k]]) : 0;
        o[k] = k === 'charm' || k === 'hex' ? Math.abs(v) : v;
      }
      return o;
    };
    const cell = (i) => (i >= 0 && String(r[i] || '').trim() !== '' ? toNumber(r[i]) : null);
    out.push({
      key,
      name,
      weekly: read(cols.weekly),
      total: hasTotals ? read(cols.total) : null,
      sheetWeeklyTotal: cell(cols.sheetWeeklyTotal),
      sheetChallengeTotal: cell(cols.sheetChallengeTotal),
    });
  }
  return { teams: out, columns: cols, header: rows[headerIdx] };
}

async function fetchSheet() {
  const res = await fetch(config.sheetCsvUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet download failed: HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error('Sheet returned HTML instead of CSV - check it is shared as "Anyone with the link can view"');
  }
  return parseCsv(text);
}

module.exports = { parseCsv, mapColumns, extractTeams, fetchSheet, toNumber, FIELD_KEYS };
