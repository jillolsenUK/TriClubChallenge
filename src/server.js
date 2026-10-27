const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const { Store } = require('./store');
const { fetchSheet, fetchMessage, extractTeams } = require('./sheet');
const { computeState } = require('./race');

const route = require('../route/route.json');
const store = new Store(config.dataDir, config.timeZone);

let refreshing = null;
let lastManualRefresh = 0;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const rows = await fetchSheet();
      const { teams } = extractTeams(rows);
      store.applyRows(teams);
      const { validation } = computeState(store.data, route, config);
      for (const m of validation.mismatches) {
        console.warn(`Check failed: ${m.team} ${m.which} total is ${m.ours} km here but ${m.sheet} in the sheet`);
      }
      console.log(`Refreshed ${teams.length} teams; ${validation.checked - validation.mismatches.length}/${validation.checked} totals match the sheet`);
    } catch (err) {
      store.data.lastError = { message: err.message, at: new Date().toISOString() };
      console.error('Refresh failed:', err.message);
    }
    // The banner message is optional: if it can't be read, keep the last one.
    try {
      const text = await fetchMessage();
      if (text === null) console.warn('Message tab not found or has no "Message" header in A1');
      else store.data.message = text;
    } catch (err) {
      console.warn('Message refresh failed:', err.message);
    } finally {
      store.save();
      refreshing = null;
    }
  })();
  return refreshing;
}

// Serve index.html with a per-deploy version on its CSS/JS links, so browsers
// fetch fresh copies after every deploy instead of reusing old cached ones.
const version = Date.now().toString(36);
const indexHtml = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
  .replace(/__VERSION__/g, version);
const sendIndex = (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml);

const app = express();
app.get(['/', '/index.html'], sendIndex);
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
  // REFRESH_MINUTES=0 only shows what's saved (e.g. a simulation's store.json).
  if (config.refreshMinutes > 0) {
    refresh();
    setInterval(refresh, config.refreshMinutes * 60 * 1000);
  }
});
