// Reads the public Google Sheet as CSV and turns it into team rows:
//   { key, name, week, run, cycle, swim, strength, charm, hex }
// Columns are found by header name so the sheet can be rearranged freely.

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

const DISCIPLINES = {
  run: ['run', 'running'],
  cycle: ['cycle', 'cycling', 'bike', 'ride'],
  swim: ['swim', 'swimming'],
  strength: ['strength', 'gym', 'weights'],
};
// Bonus (charm) and penalty (hex) km, applied on top of the disciplines.
const ADJUSTMENTS = { charm: ['charm'], hex: ['hex'] };

// Pick the column for each field. For disciplines, a header containing
// "total" (e.g. "Run-Total") wins over a bare "Run" column.
function mapColumns(header) {
  const h = header.map(norm);
  const find = (pred) => h.findIndex(pred);
  const cols = {};

  for (const [key, words] of Object.entries({ ...DISCIPLINES, ...ADJUSTMENTS })) {
    const override = config.columns[key];
    if (override) {
      cols[key] = h.indexOf(norm(override));
      continue;
    }
    const matches = (x) => words.some((w) => x.includes(w));
    let idx = find((x) => matches(x) && x.includes('total'));
    if (idx < 0) idx = find(matches);
    cols[key] = idx;
  }

  const teamOverride = config.columns.team;
  cols.team = teamOverride
    ? h.indexOf(norm(teamOverride))
    : find((x) => x === 'team' || x === 'teamname' || x === 'name' || (x.includes('team') && x.includes('name')));
  if (cols.team < 0) cols.team = find((x) => x.includes('team') && !/(id|no|number|num)$/.test(x));

  const idOverride = config.columns.id;
  cols.id = idOverride
    ? h.indexOf(norm(idOverride))
    : find((x) => /^team(id|no|number|num)$/.test(x) || x === 'id');

  const weekOverride = config.columns.week;
  cols.week = weekOverride ? h.indexOf(norm(weekOverride)) : find((x) => x.startsWith('week'));
  return cols;
}

function toNumber(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// Turn CSV rows into team entries. `currentWeek` labels rows when the sheet
// has no week column (it only shows this week's totals).
function extractTeams(rows, currentWeek) {
  let headerIdx = -1;
  let cols;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = mapColumns(rows[i]);
    const found = ['run', 'cycle', 'swim', 'strength'].filter((k) => c[k] >= 0).length;
    if (c.team >= 0 && found >= 2) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('Could not find a header row with a Team column and Run/Cycle/Swim/Strength total columns');
  }

  const slotsPerWeek = {};
  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const name = String(r[cols.team] || '').trim();
    if (!name || /^(total|totals|grand total)$/i.test(name)) continue;
    const week = (cols.week >= 0 && String(r[cols.week] || '').trim()) || currentWeek;
    const slot = (slotsPerWeek[week] = (slotsPerWeek[week] || 0) + 1);
    let key;
    if (cols.id >= 0 && String(r[cols.id] || '').trim()) key = 'id:' + String(r[cols.id]).trim();
    else if (config.teamKey === 'name') key = 'name:' + norm(name);
    else key = 'slot:' + slot;
    const val = (k) => (cols[k] >= 0 ? toNumber(r[cols[k]]) : 0);
    out.push({
      key,
      name,
      week,
      run: val('run'),
      cycle: val('cycle'),
      swim: val('swim'),
      strength: val('strength'),
      // Always treated as amounts: a charm adds km and a hex takes km away,
      // whether the sheet writes the hex as 50 or -50.
      charm: Math.abs(val('charm')),
      hex: Math.abs(val('hex')),
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

module.exports = { parseCsv, mapColumns, extractTeams, fetchSheet, toNumber };
