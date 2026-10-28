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
    { key: 'virtualCycle', label: 'Virtual cycle', short: 'V-cyc', color: '#0f766e' },
    { key: 'outdoorCycle', label: 'Outdoor cycle', short: 'O-cyc', color: '#4cc3b5' },
    { key: 'swim', label: 'Swim', color: '#2e6fde' },
    { key: 'strength', label: 'Strength', short: 'Str', color: '#e0a800' },
  ];
  // Everything that adds km: the disciplines plus charms. Hexes are taken off.
  const BONUS = { key: 'charm', label: 'Charms ✨', color: '#8e44ad' };
  const ADDS = [...DISCIPLINES, BONUS];
  const signedKm = (n, sign) => (n ? sign : '') + km(n);
  const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  // Charm totals in purple, hex totals in red.
  const charmText = (n, unit = ' km') => '<span class="charm">+' + num(n) + unit + '</span>';
  const hexText = (n, unit = ' km') => '<span class="hex">' + (n ? '−' : '') + num(n) + unit + '</span>';
  const sessions = (n) => num(n) + (n === 1 ? ' session' : ' sessions');
  const formerNames = (t) => (t.previousNames || []).filter((n) => n !== t.name);
  const weekName = (w) => (state.weekLabels && state.weekLabels[w]) || w;
  const failedChecks = (t) => t.checks.filter((c) => !c.ok);
  // e.g. "75 × 4" under the Run km, "6 sessions × 25" under Strength.
  const rawLine = (t, key) => {
    const raw = t.totals.raw[key];
    const text = key === 'strength' ? sessions(raw) + ' × ' + num(state.scale.strength) : num(raw) + ' × ' + num(state.scale[key]);
    return '<div class="muted" style="font-size:.75rem;font-weight:400">' + text + '</div>';
  };

  const styleFor = (team) => ({
    color: COLORS[team.styleIndex % COLORS.length],
    shape: SHAPES[team.styleIndex % SHAPES.length],
  });
  const teamIcon = (team, size) => {
    const s = styleFor(team);
    const ring = Math.max(3, Math.round(size / 8));
    // A team picture from the sheet, inside the team's coloured ring; otherwise its Christmas emoji.
    if (team.image) {
      return '<span class="xmas-badge photo" role="img" aria-label="' + esc(team.name) + ' team picture" style="width:' + size + 'px;height:' + size +
        'px;border-width:' + ring + 'px;border-color:' + s.color + '"><img src="' + esc(team.image) + '" alt="" loading="lazy"></span>';
    }
    return '<span class="xmas-badge" role="img" aria-label="' + s.shape.name + '" style="width:' + size + 'px;height:' + size +
      'px;border-width:' + ring + 'px;border-color:' + s.color + ';font-size:' + Math.round(size * 0.55) + 'px">' + s.shape.emoji + '</span>';
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const km = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1)) + ' km';
  const pct = (n) => (n * 100).toFixed(1) + '%';
  const $ = (id) => document.getElementById(id);

  // ---- map ----
  // On touch screens one finger scrolls the page (so it can be scrolled past
  // the map) and two fingers move and zoom the map.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const map = L.map('map', { worldCopyJump: true, dragging: !touch, touchZoom: true });
  if (touch) {
    const hint = L.DomUtil.create('div', 'map-hint', map.getContainer());
    hint.textContent = 'Use two fingers to move the map';
    let hideHint;
    map.getContainer().addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 1) return hint.classList.remove('show');
        hint.classList.add('show');
        clearTimeout(hideHint);
        hideHint = setTimeout(() => hint.classList.remove('show'), 1200);
      },
      { passive: true },
    );
  }
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
    // Santa at the finish, a bit bigger than the start flag, centred on the end of the route.
    const santa = L.divIcon({ className: '', html: '<div class="santa">🎅</div>', iconSize: [44, 44], iconAnchor: [22, 22] });
    L.marker(latlngs[0], { icon: flag('🏁'), title: 'Start' }).addTo(map).bindTooltip('Start');
    L.marker(latlngs[latlngs.length - 1], { icon: santa, title: 'Finish' }).addTo(map).bindTooltip('Finish – ' + esc(route.name));
    hidePrizes();
    $('route-name').textContent = route.name + ' · ' + km(route.totalKm);
  }

  // Faint snowflakes hidden around the map (the server says where). The first
  // person to click each gets that spot's code for extra km.
  async function hidePrizes() {
    let spots = [];
    try {
      spots = await (await fetch('api/prizes')).json();
    } catch (e) {
      return;
    }
    const remember = (id, value) => {
      try {
        if (value === undefined) return JSON.parse(localStorage.getItem('prize:' + id) || 'null');
        localStorage.setItem('prize:' + id, JSON.stringify(value));
      } catch (e) {
        return null;
      }
    };
    // Shown at the normal view and closer, but not when zoomed right out to the
    // whole world, so you have to go looking rather than spot all four at once.
    const PRIZE_ZOOM = 3;
    const layer = L.layerGroup();
    const toggle = () => (map.getZoom() >= PRIZE_ZOOM ? layer.addTo(map) : layer.remove());
    map.on('zoomend', toggle);
    toggle();
    for (const spot of spots) {
      const icon = L.divIcon({ className: 'hidden-prize', html: '<span>❄</span>', iconSize: [24, 24], iconAnchor: [12, 12] });
      const marker = L.marker([spot.lat, spot.lon], { icon, keyboard: false, riseOnHover: true }).addTo(layer);
      const show = (html) =>
        L.popup({ maxWidth: 260, offset: [0, -4] }).setLatLng(marker.getLatLng()).setContent('<div class="np-popup">' + html + '</div>').openOn(map);
      // The finder's code is remembered (for this visit, and in this browser) so they can see it again.
      let mine = remember(spot.id);
      marker.on('click', async () => {
        if (mine) return show(foundText(spot, mine.code, mine.km));
        try {
          const res = await (await fetch('api/prizes/' + encodeURIComponent(spot.id), { method: 'POST' })).json();
          if (res.found) {
            mine = { code: res.code, km: res.km };
            remember(spot.id, mine);
            show(foundText(spot, res.code, res.km));
          } else {
            show('<strong>🎅 Ho ho ho!</strong><br>You found the secret snowflake at ' + esc(spot.name) + ', but someone got here first and claimed the prize.');
          }
        } catch (e) {
          show('This snowflake is frozen solid. Try again in a moment.');
        }
      });
    }
  }
  const foundText = (spot, code, km) =>
    '<strong>🎉 You found the secret snowflake at ' + esc(spot.name) + '!</strong><br>Your prize code is<div class="np-code">' + esc(code) + '</div>' +
    'Send it to the challenge organiser to claim <strong>' + km + ' km</strong>: either as a ✨ <strong>charm</strong> for your team, ' +
    'or as a 🧙 <strong>hex</strong> taking ' + km + ' km off another team. Only the first finder gets it, so keep it secret!';

  function updateMarkers() {
    const seen = new Set();
    for (const t of state.teams) {
      seen.add(t.key);
      const px = t.image ? 44 : 34;
      const icon = L.divIcon({ className: 'team-icon', html: teamIcon(t, px), iconSize: [px, px], iconAnchor: [px / 2, px / 2] });
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
        '<div><div class="team-name">' + esc(t.name) + (t.finished ? ' 🎅' : '') +
        (failedChecks(t).length ? ' <span class="warn-icon" title="Doesn\'t match the spreadsheet\'s calculated total">⚠️</span>' : '') + '</div>' +
        '<div class="team-sub">' + pct(t.progress) + (t.rank > 1 ? ' · ' + km(t.behindLeaderKm) + ' behind' : ' · leading') + '</div>' +
        '<div class="team-sub adj"><span title="Charms (added)">✨ ' + charmText(t.totals.charm) + '</span>' +
        '<span title="Hexes (taken off)">🧙 ' + hexText(t.totals.hex) + '</span></div>' +
        '<div class="bar"><span style="width:' + (t.progress * 100).toFixed(2) + '%;background:' + s.color + '"></span></div></div>' +
        '<span class="km">' + km(t.distanceKm) + '</span></li>';
    }).join('');
    $('empty').hidden = state.teams.length > 0;
    list.querySelectorAll('li').forEach((li) =>
      li.addEventListener('click', () => {
        selectTeam(li.dataset.key);
        // On phones the page scrolls: bring the top of the Team pane back into view.
        const tabs = document.querySelector('.tabs');
        if (tabs.getBoundingClientRect().top < 0 || window.scrollY > tabs.offsetTop) window.scrollTo({ top: tabs.offsetTop, behavior: 'smooth' });
      }),
    );
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
    const former = formerNames(t).length ? 'formerly ' + formerNames(t).map(esc).join(', ') : '';
    // Teams with a picture get it shown large; the rest keep the small emoji badge beside the name.
    let html = t.image
      ? '<div class="detail-hero"><img src="' + esc(t.imageLarge || t.image) + '" alt="' + esc(t.name) + ' team picture" style="border-color:' + s.color + '">' +
        '<h2>' + esc(t.name) + '</h2>' + (former ? '<div class="muted" style="font-size:.8rem">' + former + '</div>' : '') + '</div>'
      : '<div class="detail-head">' + teamIcon(t, 40) + '<div><h2>' + esc(t.name) + '</h2>' +
        '<div class="muted" style="font-size:.8rem">' + esc(s.shape.name) + ' marker' + (former ? ' · ' + former : '') + '</div></div></div>';
    html += '<div class="bar" style="height:10px"><span style="width:' + (t.progress * 100).toFixed(2) + '%;background:' + s.color + '"></span></div>';
    html += '<div class="stats">' +
      stat('Position', '#' + t.rank + ' of ' + state.teams.length) +
      stat('Progress', pct(t.progress)) +
      stat('Distance', km(t.distanceKm)) +
      stat(t.finished ? 'Finished' : 'To go', t.finished ? '🎅' : km(t.remainingKm)) +
      stat('Behind leader', t.rank === 1 ? '—' : km(t.behindLeaderKm)) +
      stat('This week', km(t.thisWeek.total)) +
      '</div>';
    html += t.checks.map((c) => {
      const what = c.which === 'week' ? 'Weekly total' : 'Challenge total';
      return c.ok
        ? '<p class="check ok">✓ ' + what + ' matches the spreadsheet (' + km(c.sheet) + ')</p>'
        : '<p class="check bad">⚠️ ' + what + ': the spreadsheet says ' + km(c.sheet) + ', but its figures add up to ' + km(c.ours) + '</p>';
    }).join('');

    const dot = (c) => '<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + c + '"></i> ';
    html += '<h3>Totals by discipline</h3><div class="stats">' +
      DISCIPLINES.map((d) => stat(dot(d.color) + d.label, km(t.totals[d.key]) + rawLine(t, d.key))).join('') +
      stat(dot(BONUS.color) + 'Charms ✨ (added)', '<span class="charm">' + signedKm(t.totals.charm, '+') + '</span>') +
      stat(dot('var(--hex)') + 'Hexes 🧙 (taken off)', '<span class="hex">' + signedKm(t.totals.hex, '−') + '</span>') +
      '</div>';

    html += '<h3>Weekly totals (km, rounded)</h3><div class="table-scroll"><table class="compact"><thead><tr><th>Week</th>' +
      DISCIPLINES.map((d) => '<th title="' + d.label + '">' + (d.short || d.label) + '</th>').join('') + '<th title="Charms">✨</th><th title="Hexes">🧙</th><th>Total</th></tr></thead><tbody>' +
      t.weekly.slice().reverse().map((w) => '<tr><td>' + esc(weekName(w.week)) + '</td>' +
        DISCIPLINES.map((d) => '<td' + (d.key === 'strength' ? ' title="' + sessions(w.strengthSessions) + '"' : '') + '>' + Math.round(w[d.key]) + '</td>').join('') +
        '<td>' + (w.charm ? charmText(Math.round(w.charm), '') : '–') + '</td>' +
        '<td>' + (w.hex ? hexText(Math.round(w.hex), '') : '–') + '</td>' +
        '<td><strong>' + Math.round(w.total) + '</strong></td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="muted" style="font-size:.75rem">' + formula() + '</p>';
    el.innerHTML = html;
  }

  function renderWeekly() {
    const weeks = state.weeks;
    const head = '<thead><tr><th>Team</th>' + weeks.map((w) => '<th>' + esc(weekName(w)) + '</th>').join('') +
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

  function formula() {
    const x = state.scale;
    const times = (n) => (n === 1 ? '' : ' × ' + num(n));
    return 'km = Run × ' + num(x.run) + ' + Virtual cycle' + times(x.virtualCycle) + ' + Outdoor cycle' + times(x.outdoorCycle) + ' + Swim × ' + num(x.swim) +
      ' + Strength sessions × ' + num(x.strength) + ' + Charms − Hexes. Weeks run Sunday to Saturday.';
  }

  function renderStatus() {
    $('last-update').textContent = state.lastFetch ? 'Updated ' + new Date(state.lastFetch).toLocaleString() : 'Not updated yet';
    const banner = $('error-banner');
    banner.hidden = !state.lastError;
    if (state.lastError) banner.textContent = 'Last spreadsheet refresh failed: ' + state.lastError.message;
    const warn = $('check-banner');
    const bad = state.validation.mismatches;
    warn.hidden = !bad.length;
    if (bad.length) {
      warn.textContent = '⚠️ ' + bad.length + (bad.length === 1 ? ' total doesn\'t' : ' totals don\'t') +
        ' match the spreadsheet\'s calculated columns: ' +
        bad.map((m) => m.team + ' (' + (m.which === 'week' ? 'weekly' : 'challenge') + ': sheet ' + num(m.sheet) + ', calculated ' + num(m.ours) + ')').join('; ');
    }
    $('weekly-note').textContent = formula();
  }

  // Scrolls at a steady ~70 px/s whatever the message length or screen width.
  function sizeMessage() {
    const box = document.querySelector('.marquee');
    const text = $('message-text');
    if (!box.clientWidth) return;
    text.style.setProperty('--scroll-duration', ((box.clientWidth + text.scrollWidth) / 70).toFixed(1) + 's');
  }

  function renderMessage() {
    const text = (state.message || '').trim();
    const banner = $('message-banner');
    if (banner.hidden === !!text) {
      banner.hidden = !text;
      map.invalidateSize(); // the banner changes the map's height
    }
    // Only touch the text when it changes, so the scroll doesn't restart every refresh.
    if ($('message-text').textContent !== text) {
      $('message-text').textContent = text;
      banner.title = text;
      sizeMessage();
    }
  }

  function render() {
    renderMessage();
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

  window.addEventListener('resize', sizeMessage);
  loadRoute().then(loadState);
  setInterval(loadState, 60 * 1000);
})();
