// Challenge weeks run Sunday to Saturday in the club's time zone. A week is
// identified by the date of its Sunday, e.g. "2026-10-25".

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The calendar date and weekday (0 = Sunday) of `date` in `timeZone`.
function localDay(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { utcDate: Date.UTC(+parts.year, +parts.month - 1, +parts.day), weekday: WEEKDAYS.indexOf(parts.weekday) };
}

function weekStart(date, timeZone) {
  const { utcDate, weekday } = localDay(date, timeZone);
  return new Date(utcDate - weekday * DAY_MS).toISOString().slice(0, 10);
}

function previousWeek(weekKey) {
  return new Date(Date.parse(weekKey + 'T00:00:00Z') - 7 * DAY_MS).toISOString().slice(0, 10);
}

const isSunday = (date, timeZone) => localDay(date, timeZone).weekday === 0;

const isWeekKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && !isNaN(Date.parse(key + 'T00:00:00Z'));

// The week's dates, e.g. "22–28 Nov" or "29 Nov – 5 Dec", with "Week 4 · "
// in front when the challenge start date is known.
function weekLabel(weekKey, challengeStart, timeZone) {
  if (!isWeekKey(weekKey)) return String(weekKey);
  const sun = new Date(weekKey + 'T00:00:00Z');
  const sat = new Date(sun.getTime() + 6 * DAY_MS);
  const fmt = (d, opts) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
  const range =
    sun.getUTCMonth() === sat.getUTCMonth()
      ? `${sun.getUTCDate()}–${fmt(sat, { day: 'numeric', month: 'short' })}`
      : `${fmt(sun, { day: 'numeric', month: 'short' })} – ${fmt(sat, { day: 'numeric', month: 'short' })}`;
  const n = weekNumber(weekKey, challengeStart, timeZone);
  return n ? `Week ${n} · ${range}` : range;
}

// 1 for the Sunday-to-Saturday week containing the challenge start date.
function weekNumber(weekKey, challengeStart, timeZone) {
  if (!challengeStart || isNaN(Date.parse(challengeStart + 'T12:00:00Z'))) return null;
  const first = weekStart(new Date(challengeStart + 'T12:00:00Z'), timeZone);
  return Math.round((Date.parse(weekKey) - Date.parse(first)) / (7 * DAY_MS)) + 1;
}

module.exports = { weekStart, previousWeek, isSunday, weekLabel, weekNumber, isWeekKey };
