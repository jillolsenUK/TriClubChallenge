const path = require('path');
const express = require('express');
const config = require('./config');
const { Store } = require('./store');
const { fetchSheet, extractTeams } = require('./sheet');
const { computeState, currentWeekLabel } = require('./race');

const route = require('../route/route.json');
const store = new Store(config.dataDir);

let refreshing = null;
let lastManualRefresh = 0;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const rows = await fetchSheet();
      const { teams } = extractTeams(rows, currentWeekLabel(config));
      store.applyRows(teams);
      console.log(`Refreshed ${teams.length} team rows`);
    } catch (err) {
      store.data.lastError = { message: err.message, at: new Date().toISOString() };
      console.error('Refresh failed:', err.message);
    } finally {
      store.save();
      refreshing = null;
    }
  })();
  return refreshing;
}

const app = express();
// No max-age on the app's own files: browsers revalidate (cheap, via ETag) so a
// new deploy shows up on the next page load.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js')), { maxAge: '7d' }));

app.get('/api/route', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').json(route);
});

app.get('/api/state', (req, res) => {
  res.set('Cache-Control', 'no-store').json(computeState(store.data, route, config));
});

app.post('/api/refresh', async (req, res) => {
  if (config.adminKey && req.get('x-admin-key') !== config.adminKey) {
    return res.status(401).json({ error: 'Invalid admin key' });
  }
  if (!config.adminKey && Date.now() - lastManualRefresh < 60 * 1000) {
    return res.status(429).json({ error: 'Refreshed less than a minute ago' });
  }
  lastManualRefresh = Date.now();
  await refresh();
  res.json(computeState(store.data, route, config));
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(config.port, () => {
  console.log(`TriClub Challenge on port ${config.port}, data in ${config.dataDir}`);
  refresh();
  setInterval(refresh, config.refreshMinutes * 60 * 1000);
});
