// Hidden prizes on the map: faint snowflakes in a few far-flung spots. The
// first person to click each one gets that spot's code, worth extra km, which
// they give to the organiser. Codes never appear in the page; the server only
// hands each one to its first finder.

const crypto = require('crypto');

// A code that's easy to read out: no 0/O or 1/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (prefix) => prefix + '-' + Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

// Make sure every hiding spot has a prize. A new code for a spot (from its
// environment variable) starts a new hunt there. Returns true if anything changed.
function ensurePrizes(data, spots) {
  let changed = false;
  // Before there were several spots, the one prize was saved as data.northPole.
  if (data.northPole) {
    data.prizes = { ...data.prizes, 'north-pole': data.northPole };
    delete data.northPole;
    changed = true;
  }
  data.prizes = data.prizes || {};
  for (const spot of spots) {
    const prize = data.prizes[spot.id];
    if (!prize || (spot.code && prize.code !== spot.code)) {
      data.prizes[spot.id] = { code: spot.code || randomCode(spot.prefix), claimedAt: null };
      changed = true;
    }
  }
  return changed;
}

// The first call for a spot wins its code; later calls are told it's gone.
function claimPrize(data, spots, id, now = new Date()) {
  const spot = spots.find((s) => s.id === id);
  if (!spot) return null;
  ensurePrizes(data, spots);
  const prize = data.prizes[id];
  if (prize.claimedAt) return { found: false, claimedAt: prize.claimedAt, km: spot.km };
  prize.claimedAt = now.toISOString();
  return { found: true, code: prize.code, km: spot.km };
}

// What the page needs to place the snowflakes: never the codes.
const publicSpots = (spots) => spots.map(({ id, name, lat, lon, km }) => ({ id, name, lat, lon, km }));

module.exports = { ensurePrizes, claimPrize, publicSpots };
