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

// "w/c 25 Oct", or "Week 3 · 25 Oct" when the challenge start date is known.
function weekLabel(weekKey, challengeStart, timeZone) {
  const d = new Date(weekKey + 'T00:00:00Z');
  const short = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (challengeStart && !isNaN(Date.parse(challengeStart + 'T12:00:00Z'))) {
    const first = weekStart(new Date(challengeStart + 'T12:00:00Z'), timeZone);
    const n = Math.round((Date.parse(weekKey) - Date.parse(first)) / (7 * DAY_MS)) + 1;
    if (n >= 1) return `Week ${n} · ${short}`;
  }
  return `w/c ${short}`;
}

module.exports = { weekStart, previousWeek, isSunday, weekLabel };
