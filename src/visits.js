// A plain site-visit counter: one number per day and a running total. Nothing
// about the visitor is stored (no IP address, cookies, browser details or
// anything kept on their device), so it counts visits, not people.

const { localDate } = require('./weeks');

// Azure's "Always On" pings, health checks and search-engine crawlers aren't visits.
const NOT_A_PERSON = /alwayson|healthcheck|readyforrequest|bot\b|bot\/|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python-requests|node-fetch/i;

function isVisit(req) {
  if (req.method !== 'GET') return false;
  if (NOT_A_PERSON.test(req.get('user-agent') || '')) return false;
  // A real page load asks for HTML; prefetches and link previews say so in a header.
  if (!/text\/html/.test(req.get('accept') || '')) return false;
  if (/prefetch|prerender/i.test(req.get('purpose') || req.get('sec-purpose') || '')) return false;
  return true;
}

function countVisit(data, now, timeZone) {
  const v = (data.visits = data.visits || { total: 0, days: {} });
  const day = localDate(now, timeZone);
  v.total += 1;
  v.days[day] = (v.days[day] || 0) + 1;
}

// The total, today's count and the last `days` days, newest first.
function visitSummary(data, now, timeZone, days = 30) {
  const v = data.visits || { total: 0, days: {} };
  const recent = Object.keys(v.days).sort().reverse().slice(0, days);
  return {
    total: v.total,
    today: v.days[localDate(now, timeZone)] || 0,
    days: Object.fromEntries(recent.map((d) => [d, v.days[d]])),
  };
}

module.exports = { isVisit, countVisit, visitSummary };
