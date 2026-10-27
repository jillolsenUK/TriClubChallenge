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
  // 'weekly': the sheet's totals are for the current week and are summed across weeks.
  // 'cumulative': the sheet's totals are already race-to-date; the latest week is used.
  totalsMode: env.TOTALS_MODE === 'cumulative' ? 'cumulative' : 'weekly',
  // How a team is recognised between refreshes when it is renamed.
  // 'slot' = row position in the sheet (default), 'name' = team name.
  // A "Team ID" column in the sheet always takes precedence.
  teamKey: env.TEAM_KEY === 'name' ? 'name' : 'slot',
  // Optional race start date (YYYY-MM-DD); weeks are then labelled "Week 1", "Week 2", ...
  challengeStart: env.CHALLENGE_START || '',
  // Multipliers converting each discipline total into km along the route.
  // Strength is a count of sessions, each worth 25 km.
  scale: {
    run: num(env.SCALE_RUN, 1),
    cycle: num(env.SCALE_CYCLE, 1),
    swim: num(env.SCALE_SWIM, 1),
    strength: num(env.SCALE_STRENGTH, 25),
  },
  // Optional exact header names, if auto-detection picks the wrong column.
  columns: {
    team: env.COL_TEAM || '',
    id: env.COL_TEAM_ID || '',
    week: env.COL_WEEK || '',
    run: env.COL_RUN || '',
    cycle: env.COL_CYCLE || '',
    swim: env.COL_SWIM || '',
    strength: env.COL_STRENGTH || '',
    charm: env.COL_CHARM || '',
    hex: env.COL_HEX || '',
  },
};
