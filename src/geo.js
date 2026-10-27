const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;

function haversineKm([lat1, lon1], [lat2, lon2]) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

// Position along a route ({points: [[lat, lon, cumKm], ...], totalKm}) after
// travelling `km`. Clamped to the start/finish.
function positionAt(route, km) {
  const pts = route.points;
  if (km <= 0) return [pts[0][0], pts[0][1]];
  if (km >= route.totalKm) return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][2] <= km) lo = mid;
    else hi = mid;
  }
  const [aLat, aLon, aKm] = pts[lo];
  const [bLat, bLon, bKm] = pts[hi];
  const t = bKm > aKm ? (km - aKm) / (bKm - aKm) : 0;
  return [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t];
}

module.exports = { haversineKm, positionAt };
