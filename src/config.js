const path = require('path');

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

const sheetId = env.SHEET_ID || '1j1f2LI1zluWNUFeYprODvV0g6swACpYW1lss1ddDHf8';
const sheetGid = env.SHEET_GID || '0';

module.exports = {
  port: num(env.PORT, 3000),
  sheetCsvUrl: env.SHEET_CSV_URL || `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`,
  // Fallback: the figures' tab looked up by name.
  dataTabCsvUrl: env.SHEET_CSV_URL
    ? ''
    : `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(env.DATA_SHEET || 'Data')}`,
  // The banner message: cell A2 under a "Message" header, on the first of these tabs that has one.
  messageCsvUrls: env.MESSAGE_CSV_URL
    ? [env.MESSAGE_CSV_URL]
    : (env.MESSAGE_SHEET ? [env.MESSAGE_SHEET] : ['Message', 'Sheet2', 'Sheet 2']).map(
        (tab) => `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`,
      ),
  // Team pictures: the "Images" tab of the workbook's .xlsx export (CSV leaves pictures out).
  workbookXlsxUrl: env.IMAGES_XLSX_URL || `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`,
  imagesSheet: env.IMAGES_SHEET || 'Images',
  imagesRefreshMinutes: num(env.IMAGES_REFRESH_MINUTES, 60),
  // Azure App Service keeps /home across restarts and deployments.
  dataDir: env.DATA_DIR || (env.WEBSITE_SITE_NAME ? '/home/data' : path.join(__dirname, '..', 'data')),
  refreshMinutes: num(env.REFRESH_MINUTES, 15),
  adminKey: env.ADMIN_KEY || '',
  // Hidden map prizes. Each spot's code comes from its environment variable
  // (a random one if not set; codes are printed in the log). PRIZE_KM is what
  // each is worth.
  prizes: [
    { id: 'north-pole', name: 'the North Pole', lat: 84.6, lon: 0, env: 'NORTH_POLE_CODE', prefix: 'POLE' },
    { id: 'hyde-park-sydney', name: 'Hyde Park… in Sydney', lat: -33.8732, lon: 151.2111, env: 'SYDNEY_CODE', prefix: 'SYD' },
    { id: 'tenerife', name: 'Mount Teide, Tenerife', lat: 28.2724, lon: -16.6425, env: 'TENERIFE_CODE', prefix: 'TEIDE' },
    { id: 'girona', name: 'Girona', lat: 41.9866, lon: 2.8243, env: 'GIRONA_CODE', prefix: 'GIRONA' },
  ].map(({ env: codeVar, ...spot }) => ({
    ...spot,
    code: (env[codeVar] || '').trim(),
    codeVar,
    km: num(env.PRIZE_KM, num(env.NORTH_POLE_KM, 50)),
  })),
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
    virtualCycle: num(env.SCALE_VIRTUAL_CYCLE, 0.8),
    outdoorCycle: num(env.SCALE_OUTDOOR_CYCLE, num(env.SCALE_CYCLE, 1)),
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
    // e.g. COL_RUN_WEEKLY="Run (Week)", COL_VIRTUAL_CYCLE_TOTAL="Virtual-Cycle Total"
    ...Object.fromEntries(
      ['run', 'virtualCycle', 'outdoorCycle', 'swim', 'strength', 'charm', 'hex'].flatMap((k) => {
        const name = k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase();
        return [
          [k + 'Weekly', env[`COL_${name}_WEEKLY`] || ''],
          [k + 'Total', env[`COL_${name}_TOTAL`] || ''],
        ];
      }),
    ),
  },
};
