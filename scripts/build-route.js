#!/usr/bin/env node
// Converts a GPX track into route/route.json: a simplified polyline with the
// cumulative distance (km) at every kept point. The full-resolution track is
// used for the total distance so simplification doesn't shorten the race.
//
// Usage: node scripts/build-route.js [input.gpx] [output.json]

const fs = require('fs');
const path = require('path');
const { haversineKm } = require('../src/geo');

const input = process.argv[2] || path.join(__dirname, '..', 'route', 'finding-santa.gpx');
const output = process.argv[3] || path.join(__dirname, '..', 'route', 'route.json');

// Keep a point once we've travelled at least this far since the last kept one.
const MIN_SPACING_KM = 0.75;

const gpx = fs.readFileSync(input, 'utf8');
const name = (gpx.match(/<trk>\s*<name>([^<]*)<\/name>/) || gpx.match(/<name>([^<]*)<\/name>/) || [])[1] || 'Route';

const pts = [];
const re = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"/g;
let m;
while ((m = re.exec(gpx))) pts.push([parseFloat(m[1]), parseFloat(m[2])]);
if (pts.length < 2) throw new Error(`No track points found in ${input}`);

const waypoints = [];
const wre = /<wpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g;
while ((m = wre.exec(gpx))) {
  const wname = (m[3].match(/<name>([^<]*)<\/name>/) || [])[1] || '';
  waypoints.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]), name: wname });
}

let total = 0;
let sinceKept = 0;
const points = [[pts[0][0], pts[0][1], 0]];
for (let i = 1; i < pts.length; i++) {
  const d = haversineKm(pts[i - 1], pts[i]);
  total += d;
  sinceKept += d;
  if (sinceKept >= MIN_SPACING_KM || i === pts.length - 1) {
    points.push([+pts[i][0].toFixed(6), +pts[i][1].toFixed(6), +total.toFixed(3)]);
    sinceKept = 0;
  }
}

const route = { name, totalKm: +total.toFixed(3), waypoints, points };
fs.writeFileSync(output, JSON.stringify(route));
console.log(`${name}: ${pts.length} points -> ${points.length}, ${total.toFixed(1)} km -> ${output}`);
