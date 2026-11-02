// Hidden prizes on the map: small snowflakes in a few far-flung spots. The
// first person (or first few, see `winners`) to click each one gets a code,
// worth extra km, which they give to the organiser. Codes never appear in the
// page; the server only hands them to the finders.

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
      data.prizes[spot.id] = { code: spot.code || randomCode(spot.prefix), claimedAt: null, claims: [] };
      changed = true;
    }
  }
  return changed;
}

// The first `spot.winners` callers for a spot each win a code: the spot's code
// itself when there's one winner, otherwise the code with the finder's number
// (e.g. "NorthPole50-LetsGo-2"), so the organiser can tell winners apart.
// Later callers are told they've all gone. `remembered` is the code the
// caller's browser was given before: if it's one of this spot's current codes,
// that's a finder coming back, so they see it again.
function claimPrize(data, spots, id, now = new Date(), remembered = '') {
  const spot = spots.find((s) => s.id === id);
  if (!spot) return null;
  ensurePrizes(data, spots);
  const prize = data.prizes[id];
  const winners = spot.winners || 1;
  // Prizes saved before there could be several winners only recorded claimedAt.
  if (!prize.claims) prize.claims = prize.claimedAt ? [{ code: prize.code, at: prize.claimedAt }] : [];
  const reply = (claim, again) => ({
    found: true,
    code: claim.code,
    km: spot.km,
    finder: prize.claims.indexOf(claim) + 1,
    winners,
    ...(again ? { again: true } : {}),
  });

  const mine = remembered && prize.claims.find((c) => c.code === remembered);
  if (mine) return reply(mine, true);
  if (prize.claims.length >= winners) {
    return { found: false, claimedAt: prize.claims[prize.claims.length - 1].at, km: spot.km, winners };
  }
  const n = prize.claims.length + 1;
  const claim = { code: winners === 1 ? prize.code : `${prize.code}-${n}`, at: now.toISOString() };
  prize.claims.push(claim);
  prize.claimedAt = prize.claimedAt || claim.at;
  return reply(claim);
}

// What the page needs to place the snowflakes: never the codes.
const publicSpots = (spots) => spots.map(({ id, name, lat, lon, km, zoom, winners }) => ({ id, name, lat, lon, km, zoom, winners }));

module.exports = { ensurePrizes, claimPrize, publicSpots };
