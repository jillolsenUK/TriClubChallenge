const path = require('path');

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

const sheetId = env.SHEET_ID || '1j1f2LI1zluWNUFeYprODvV0g6swACpYW1lss1ddDHf8';
const sheetGid = env.SHEET_GID || '0';

module.exports = {
  port: num(env.PORT, 3000),
  sheetCsvUrl: env.SHEET_CSV_URL || `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`,
  // Azure App Service keeps /home across restarts and deployments.
  dataDir: env.DATA_DIR || (env.WEBSITE_SITE_NAME ? '/home/data' : path.join(__dirname, '..', 'data')),
  refreshMinutes: num(env.REFRESH_MINUTES, 15),
  adminKey: env.ADMIN_KEY || '',
  // Weeks run Sunday to Saturday in this time zone (the sheet's weekly
  // columns are zeroed on Sunday).
  timeZone: env.TIME_ZONE || 'Europe/London',
  // How a team is recognised between refreshes when it is renamed.
  // 'slot' = row position in the sheet (default), 'name' = team name.
  // A "Team ID" column in the sheet always takes precedence.
  teamKey: env.TEAM_KEY === 'name' ? 'name' : 'slot',
  // Optional race start date (YYYY-MM-DD); weeks are then labelled "Week 1", "Week 2", ...
  // counting from the Sunday-to-Saturday week that contains it.
  challengeStart: env.CHALLENGE_START || '',
  // Multipliers converting each sheet value into km along the route.
  // Strength is a count of sessions, each worth 25 km. Charms are added and
  // hexes taken off as they are.
  scale: {
    run: num(env.SCALE_RUN, 4),
    cycle: num(env.SCALE_CYCLE, 1),
    swim: num(env.SCALE_SWIM, 26),
    strength: num(env.SCALE_STRENGTH, 25),
  },
  // Largest difference (km) from the sheet's calculated totals still counted as a match.
  validationTolerance: num(env.VALIDATION_TOLERANCE, 0.5),
  // Optional exact header names, if auto-detection picks the wrong column.
  columns: {
    team: env.COL_TEAM || '',
    id: env.COL_TEAM_ID || '',
    weeklyCalculated: env.COL_WEEKLY_CALCULATED || '',
    challengeCalculated: env.COL_CHALLENGE_CALCULATED || '',
    // e.g. COL_RUN_WEEKLY="Run (Week)", COL_RUN_TOTAL="Run-Total"
    ...Object.fromEntries(
      ['run', 'cycle', 'swim', 'strength', 'charm', 'hex'].flatMap((k) => [
        [k + 'Weekly', env[`COL_${k.toUpperCase()}_WEEKLY`] || ''],
        [k + 'Total', env[`COL_${k.toUpperCase()}_TOTAL`] || ''],
      ]),
    ),
  },
};
