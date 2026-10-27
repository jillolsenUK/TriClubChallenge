(function () {
  'use strict';

  // Each team gets a Christmas picture = index % 11 inside a ring coloured
  // index % 10, so the first ten teams differ in both picture and colour, and
  // every combination is unique for the first 110 teams.
  const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#ffc20e', '#1b1f6b'];
  const SHAPES = [
    { name: 'Christmas tree', emoji: '🎄' },
    { name: 'Snowman', emoji: '⛄' },
    { name: 'Reindeer', emoji: '🦌' },
    { name: 'Present', emoji: '🎁' },
    { name: 'Bell', emoji: '🔔' },
    { name: 'Star', emoji: '⭐' },
    { name: 'Stocking', emoji: '🧦' },
    { name: 'Cookie', emoji: '🍪' },
    { name: 'Penguin', emoji: '🐧' },
    { name: 'Elf', emoji: '🧝' },
    { name: 'Snowflake', emoji: '❄️' },
  ];
  const DISCIPLINES = [
    { key: 'run', label: 'Run', color: '#e4572e' },
    { key: 'cycle', label: 'Cycle', color: '#17a2a0' },
    { key: 'swim', label: 'Swim', color: '#2e6fde' },
    { key: 'strength', label: 'Strength', color: '#e0a800' },
  ];
  // Everything that adds km: the disciplines plus charms. Hexes are taken off.
  const BONUS = { key: 'charm', label: 'Charms ✨', color: '#8e44ad' };
  const ADDS = [...DISCIPLINES, BONUS];
  const signedKm = (n, sign) => (n ? sign : '') + km(n);
  const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  // Charm totals in purple, hex totals in red.
  const charmText = (n, unit = ' km') => '<span class="charm">+' + num(n) + unit + '</span>';
  const hexText = (n, unit = ' km') => '<span class="hex">' + (n ? '−' : '') + num(n) + unit + '</span>';
  const sessions = (n) => n + (n === 1 ? ' session' : ' sessions');

  const styleFor = (team) => ({
    color: COLORS[team.styleIndex % COLORS.length],
    shape: SHAPES[team.styleIndex % SHAPES.length],
  });
  const teamIcon = (team, size) => {
    const s = styleFor(team);
    const ring = Math.max(3, Math.round(size / 8));
    return '<span class="xmas-badge" role="img" aria-label="' + s.shape.name + '" style="width:' + size + 'px;height:' + size +
      'px;border-width:' + ring + 'px;border-color:' + s.color + ';font-size:' + Math.round(size * 0.55) + 'px">' + s.shape.emoji + '</span>';
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const km = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + ' km';
  const pct = (n) => (n * 100).toFixed(1) + '%';
  const $ = (id) => document.getElementById(id);

  // ---- map ----
  const map = L.map('map', { worldCopyJump: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markers = {};
  let route = null;
  let state = null;
  let selectedKey = null;

  async function loadRoute() {
    route = await (await fetch('api/route')).json();
    const latlngs = route.points.map((p) => [p[0], p[1]]);
    // Candy-cane route: red line with white dashes on top.
    const line = L.polyline(latlngs, { color: '#c41e3a', weight: 6, opacity: 0.9 }).addTo(map);
    L.polyline(latlngs, { color: '#ffffff', weight: 3, opacity: 0.95, dashArray: '8 10', interactive: false }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });
    const flag = (txt) => L.divIcon({ className: '', html: '<div style="font-size:26px">' + txt + '</div>', iconSize: [24, 24], iconAnchor: [4, 22] });
    L.marker(latlngs[0], { icon: flag('🏁'), title: 'Start' }).addTo(map).bindTooltip('Start');
    L.marker(latlngs[latlngs.length - 1], { icon: flag('🎅'), title: 'Finish' }).addTo(map).bindTooltip('Finish – ' + esc(route.name));
    $('route-name').textContent = route.name + ' · ' + km(route.totalKm);
  }

  function updateMarkers() {
    const seen = new Set();
    for (const t of state.teams) {
      seen.add(t.key);
      const icon = L.divIcon({ className: 'team-icon', html: teamIcon(t, 34), iconSize: [34, 34], iconAnchor: [17, 17] });
      const tip = '<strong>' + esc(t.name) + '</strong><br>#' + t.rank + ' · ' + km(t.distanceKm) + ' (' + pct(t.progress) + ')';
      let m = markers[t.key];
      if (!m) {
        m = markers[t.key] = L.marker([t.position.lat, t.position.lon], { icon, riseOnHover: true }).addTo(map);
        m.on('click', () => selectTeam(t.key));
      } else {
        m.setLatLng([t.position.lat, t.position.lon]).setIcon(icon);
      }
      m.setZIndexOffset(1000 - t.rank);
      m.unbindTooltip().bindTooltip(tip, { className: 'team-label', direction: 'top', offset: [0, -16] });
    }
    for (const k of Object.keys(markers)) {
      if (!seen.has(k)) {
        map.removeLayer(markers[k]);
        delete markers[k];
      }
    }
  }

  // ---- panes ----
  function renderLeaderboard() {
    const list = $('leaderboard');
    list.innerHTML = state.teams.map((t) => {
      const s = styleFor(t);
      return '<li data-key="' + esc(t.key) + '">' +
        '<span class="rank">' + t.rank + '</span>' +
        teamIcon(t, 30) +
        '<div><div class="team-name">' + esc(t.name) + (t.finished ? ' 🎅' : '') + '</div>' +
        '<div class="team-sub">' + pct(t.progress) + (t.rank > 1 ? ' · ' + km(t.behindLeaderKm) + ' behind' : ' · leading') + '</div>' +
        '<div class="team-sub adj"><span title="Charms (added)">✨ ' + charmText(t.totals.charm) + '</span>' +
        '<span title="Hexes (taken off)">🧙 ' + hexText(t.totals.hex) + '</span></div>' +
        '<div class="bar"><span style="width:' + (t.progress * 100).toFixed(2) + '%;background:' + s.color + '"></span></div></div>' +
        '<span class="km">' + km(t.distanceKm) + '</span></li>';
    }).join('');
    $('empty').hidden = state.teams.length > 0;
    list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => selectTeam(li.dataset.key)));
  }

  function renderTeamSelect() {
    const sel = $('team-select');
    sel.innerHTML = state.teams.map((t) => '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>').join('');
    if (!selectedKey || !state.teams.some((t) => t.key === selectedKey)) selectedKey = state.teams[0] && state.teams[0].key;
    if (selectedKey) sel.value = selectedKey;
  }

  function renderTeamDetail() {
    const t = state.teams.find((x) => x.key === selectedKey);
    const el = $('team-detail');
    if (!t) {
      el.innerHTML = '<p class="muted">No teams yet.</p>';
      return;
    }
    const s = styleFor(t);
    const stat = (label, value) => '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
    let html = '<div class="detail-head">' + teamIcon(t, 40) + '<div><h2>' + esc(t.name) + '</h2>' +
      '<div class="muted" style="font-size:.8rem">' + esc(s.shape.name) + ' marker' +
      (t.previousNames.length ? ' · formerly ' + t.previousNames.map(esc).join(', ') : '') + '</div></div></div>';
    html += '<div class="bar" style="height:10px"><span style="width:' + (t.progress * 100).toFixed(2) + '%;background:' + s.color + '"></span></div>';
    html += '<div class="stats">' +
      stat('Position', '#' + t.rank + ' of ' + state.teams.length) +
      stat('Progress', pct(t.progress)) +
      stat('Distance', km(t.distanceKm)) +
      stat(t.finished ? 'Finished' : 'To go', t.finished ? '🎅' : km(t.remainingKm)) +
      stat('Behind leader', t.rank === 1 ? '—' : km(t.behindLeaderKm)) +
      stat('Weeks recorded', t.weekly.length) +
      '</div>';

    const dot = (c) => '<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + c + '"></i> ';
    html += '<h3>Totals by discipline</h3><div class="stats">' +
      DISCIPLINES.map((d) => stat(dot(d.color) + d.label, km(t.totals[d.key]) +
        (d.key === 'strength' ? '<div class="muted" style="font-size:.75rem;font-weight:400">' + sessions(t.totals.strengthSessions) + ' × 25 km</div>' : ''))).join('') +
      stat(dot(BONUS.color) + 'Charms ✨ (added)', '<span class="charm">' + signedKm(t.totals.charm, '+') + '</span>') +
      stat(dot('var(--hex)') + 'Hexes 🧙 (taken off)', '<span class="hex">' + signedKm(t.totals.hex, '−') + '</span>') +
      '</div>';

    html += '<h3>Weekly totals (km)</h3><div class="table-scroll"><table class="compact"><thead><tr><th>Week</th>' +
      DISCIPLINES.map((d) => '<th>' + d.label + '</th>').join('') + '<th>Charm</th><th>Hex</th><th>Total</th></tr></thead><tbody>' +
      t.weekly.slice().reverse().map((w) => '<tr><td>' + esc(w.week) + '</td>' +
        DISCIPLINES.map((d) => '<td' + (d.key === 'strength' ? ' title="' + sessions(w.strengthSessions) + '"' : '') + '>' + num(w[d.key]) + '</td>').join('') +
        '<td>' + (w.charm ? charmText(w.charm, '') : '–') + '</td>' +
        '<td>' + (w.hex ? hexText(w.hex, '') : '–') + '</td>' +
        '<td><strong>' + num(w.total) + '</strong></td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="muted" style="font-size:.75rem">Strength is 25 km per session. Charms add km; hexes take km off.</p>';
    el.innerHTML = html;
  }

  function renderWeekly() {
    const weeks = state.weeks;
    const head = '<thead><tr><th>Team</th>' + weeks.map((w) => '<th>' + esc(w) + '</th>').join('') +
      '<th>Charms</th><th>Hexes</th><th>Total</th></tr></thead>';
    const body = state.teams.map((t) => {
      const byWeek = Object.fromEntries(t.weekly.map((w) => [w.week, w.total]));
      return '<tr><td>' + esc(t.name) + '</td>' +
        weeks.map((w) => '<td>' + (w in byWeek ? byWeek[w].toFixed(1) : '–') + '</td>').join('') +
        '<td>' + (t.totals.charm ? charmText(t.totals.charm, '') : '–') + '</td>' +
        '<td>' + (t.totals.hex ? hexText(t.totals.hex, '') : '–') + '</td>' +
        '<td><strong>' + t.totals.total.toFixed(1) + '</strong></td></tr>';
    }).join('');
    const sum = (k) => state.teams.reduce((a, t) => a + t.totals[k], 0);
    const foot = state.teams.length
      ? '<tfoot><tr><th>All teams</th>' + weeks.map(() => '<th></th>').join('') +
        '<th>' + charmText(sum('charm'), '') + '</th><th>' + hexText(sum('hex'), '') + '</th><th>' + sum('total').toFixed(1) + '</th></tr></tfoot>'
      : '';
    $('weekly-table').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  }

  function renderDisciplines() {
    const added = (t) => ADDS.reduce((sum, d) => sum + Math.max(0, t.totals[d.key]), 0);
    const max = Math.max(1, ...state.teams.map(added));
    const legend = '<div class="legend">' + ADDS.map((d) => '<span><i style="background:' + d.color + '"></i>' + d.label + '</span>').join('') +
      '<span class="hex">🧙 Hexes are taken off the total</span></div>';
    const rows = state.teams.map((t) => '<div class="dbar-row"><div class="dbar-label"><span>' + esc(t.name) + '</span><span>' + km(t.totals.total) +
      (t.totals.hex ? ' <span class="hex">(' + signedKm(t.totals.hex, '−') + ' hex)</span>' : '') + '</span></div>' +
      '<div class="dbar">' + ADDS.map((d) => {
        const v = t.totals[d.key];
        return v > 0 ? '<span title="' + d.label + ': ' + v.toFixed(1) + ' km" style="width:' + ((v / max) * 100).toFixed(2) + '%;background:' + d.color + '"></span>' : '';
      }).join('') + '</div></div>').join('');
    $('discipline-bars').innerHTML = legend + (rows || '<p class="muted">No teams yet.</p>');
  }

  function renderStatus() {
    $('last-update').textContent = state.lastFetch ? 'Updated ' + new Date(state.lastFetch).toLocaleString() : 'Not updated yet';
    const banner = $('error-banner');
    banner.hidden = !state.lastError;
    if (state.lastError) banner.textContent = 'Last spreadsheet refresh failed: ' + state.lastError.message;
  }

  function render() {
    updateMarkers();
    renderLeaderboard();
    renderTeamSelect();
    renderTeamDetail();
    renderWeekly();
    renderDisciplines();
    renderStatus();
  }

  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-body').forEach((s) => (s.hidden = s.id !== 'tab-' + name));
  }

  function selectTeam(key) {
    selectedKey = key;
    $('team-select').value = key;
    renderTeamDetail();
    showTab('team');
    const m = markers[key];
    if (m) {
      map.panTo(m.getLatLng());
      m.openTooltip();
    }
  }

  async function loadState() {
    try {
      state = await (await fetch('api/state', { cache: 'no-store' })).json();
      render();
    } catch (e) {
      console.error(e);
    }
  }

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('team-select').addEventListener('change', (e) => selectTeam(e.target.value));
  $('refresh-btn').addEventListener('click', async () => {
    const btn = $('refresh-btn');
    btn.disabled = true;
    try {
      let res = await fetch('api/refresh', { method: 'POST' });
      if (res.status === 401) {
        const key = prompt('Admin key');
        if (!key) return;
        res = await fetch('api/refresh', { method: 'POST', headers: { 'x-admin-key': key } });
      }
      if (res.ok) {
        state = await res.json();
        render();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Refresh failed');
      }
    } finally {
      btn.disabled = false;
    }
  });

  loadRoute().then(loadState);
  setInterval(loadState, 60 * 1000);
})();
