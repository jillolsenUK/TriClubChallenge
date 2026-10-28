// A hidden prize at the North Pole on the map: the first person to click it
// gets a code worth extra km, which they give to the organiser. The code never
// appears in the page; the server only hands it to the first finder.

const crypto = require('crypto');

// A code that's easy to read out: no 0/O or 1/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => 'POLE-' + Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

// Make sure the store has a prize. A new NORTH_POLE_CODE starts a new hunt.
function ensurePrize(data, config) {
  const wanted = config.northPoleCode;
  if (!data.northPole || (wanted && data.northPole.code !== wanted)) {
    data.northPole = { code: wanted || randomCode(), claimedAt: null };
    return true;
  }
  return false;
}

// The first call wins the code; later calls are told it's gone.
function claimPrize(data, config, now = new Date()) {
  ensurePrize(data, config);
  const prize = data.northPole;
  if (prize.claimedAt) return { found: false, claimedAt: prize.claimedAt, km: config.northPoleKm };
  prize.claimedAt = now.toISOString();
  return { found: true, code: prize.code, km: config.northPoleKm };
}

module.exports = { ensurePrize, claimPrize };
