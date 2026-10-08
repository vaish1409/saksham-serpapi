'use strict';

/**
 * Live job-market demand, from SerpApi's Google Jobs engine.
 *
 * demand.js is a hand-made sketch of how common each trade is in each state.
 * This layer checks it against real, recent job listings and hands the
 * recommender a *snapshot* with the same interface (level / note / topTrades)
 * plus liveInfo(), so recommend() stays a pure function: the same profile and
 * the same snapshot always give the same answer.
 *
 * Design rules
 *  - Additive. No key, SERPAPI_ENABLED=false, an unknown state, a timeout, a
 *    quota error or a database error all fall back to the static table.
 *  - Raise-only blending. Live listings can lift a trade's level (1..3) but
 *    never lower it, because Google Jobs under-represents informal work such as
 *    farming, dairy and handicraft; a thin result is not proof of low demand.
 *  - Frugal. At most a few trades per request, cached per (state, trade) for
 *    several days, concurrent identical lookups share one call, and a monthly
 *    budget stops spending before the free tier runs out.
 *  - Never slow. The request waits at most SERPAPI_DEADLINE_MS; anything still
 *    running keeps going in the background and warms the cache for next time.
 */
const demand = require('./demand');
const { searchJobs } = require('../serpapi/client');

const CAP = 10; // Google Jobs returns at most 10 listings per page, so 10 means "10 or more"

// Search wording per trade. Keys must match vocab.js TRADES.
const TRADE_QUERIES = {
  farming: 'agriculture farm worker',
  dairy: 'dairy farm worker',
  weaving: 'handloom weaver',
  tailoring: 'tailor',
  construction: 'construction worker mason',
  electrical: 'electrician',
  solar: 'solar technician',
  plumbing: 'plumber',
  mechanic: 'auto mechanic',
  driving: 'driver',
  beauty: 'beautician',
  cooking: 'cook kitchen helper',
  handicraft: 'handicraft artisan',
  leather: 'leather footwear worker',
  retail: 'retail sales executive',
  computer: 'data entry operator',
  caregiving: 'caregiver attendant',
  housekeeping: 'housekeeping staff',
  labour: 'helper labourer',
};

/** listings on the first page -> demand level 1 (low) .. 3 (high) */
const levelFromCount = (n) => (n >= 8 ? 3 : n >= 4 ? 2 : 1);

const DAY = 24 * 60 * 60 * 1000;
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);

// resolves when the promise settles OR the time is up, whichever is first
const withDeadline = (promise, ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    promise.then(
      () => { clearTimeout(t); resolve(); },
      () => { clearTimeout(t); resolve(); },
    );
  });

function staticProvider(reason) {
  return {
    level: demand.level,
    note: demand.note,
    topTrades: demand.topTrades,
    // no liveInfo on purpose: recommend() output is then byte-for-byte what it was before this feature
    meta: { enabled: false, reason },
  };
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function createLiveDemand({
  apiKey = process.env.SERPAPI_API_KEY,
  enabled = process.env.SERPAPI_ENABLED !== 'false',
  store,
  search = searchJobs,
  now = Date.now,
  cacheDays = numberFromEnv('SERPAPI_CACHE_DAYS', 7),
  monthlyBudget = numberFromEnv('SERPAPI_MONTHLY_BUDGET', 200),
  maxTrades = numberFromEnv('SERPAPI_MAX_TRADES_PER_REQUEST', 4),
  deadlineMs = numberFromEnv('SERPAPI_DEADLINE_MS', 3500),
  staleDays = 30,
  logger = console,
} = {}) {
  if (!store) throw new Error('createLiveDemand needs a store');

  const cacheMs = cacheDays * DAY;
  const staleMs = staleDays * DAY;
  const inflight = new Map(); // "state|trade" -> Promise  (identical lookups share one call)
  const failedUntil = new Map(); // "state|trade" -> timestamp (do not retry a failing lookup straight away)
  let circuitUntil = 0; // after an auth/quota error, stop calling SerpApi for a while

  // Which trades are worth a lookup for THIS person: what they said first, then the state's usual top trades.
  function pickTrades(profile, state) {
    const wanted = [
      ...(profile.interests || []),
      ...(profile.currentActivity || []),
      ...(profile.familyOccupation || []),
      ...(profile.localWork || []),
      ...demand.topTrades(state, 3).map((x) => x.trade),
    ];
    return [...new Set(wanted)].filter((t) => TRADE_QUERIES[t]).slice(0, maxTrades);
  }

  // cached -> else (budget permitting) fetch -> else stale -> else null. Never throws.
  async function resolve(state, trade) {
    const key = `${state}|${trade}`;

    let cached = null;
    try {
      cached = await store.get(state, trade);
    } catch (e) {
      logger.warn('[live-demand] cache read failed:', e.message);
    }
    const age = cached ? now() - new Date(cached.fetchedAt).getTime() : Infinity;
    if (age < cacheMs) return { entry: cached, from: 'cache' };

    const staleOk = cached && age < staleMs ? { entry: cached, from: 'stale' } : null;
    if ((failedUntil.get(key) || 0) > now()) return staleOk;
    if (inflight.has(key)) return (await inflight.get(key)) || staleOk;

    const run = (async () => {
      let allowed = false;
      try {
        allowed = await store.reserve(monthKey(now()), monthlyBudget);
      } catch (e) {
        logger.warn('[live-demand] budget check failed:', e.message);
      }
      if (!allowed) return null;

      const query = `${TRADE_QUERIES[trade]} jobs in ${state}`;
      try {
        const { count, sample } = await search({ query, apiKey });
        const entry = { query, count, sample, fetchedAt: new Date(now()) };
        try {
          await store.set(state, trade, entry);
        } catch (e) {
          logger.warn('[live-demand] cache write failed:', e.message);
        }
        return { entry, from: 'live' };
      } catch (err) {
        const longPause = err.kind === 'auth' || err.kind === 'quota';
        failedUntil.set(key, now() + (longPause ? 30 : 10) * 60 * 1000);
        if (longPause) circuitUntil = now() + 30 * 60 * 1000;
        logger.warn(`[live-demand] "${query}" failed (${err.kind || 'error'}): ${err.message}`);
        return null;
      }
    })().finally(() => inflight.delete(key));

    inflight.set(key, run);
    return (await run) || staleOk;
  }

  function buildProvider(state, requested, snap) {
    const liveLevel = (trade) => {
      const r = snap.get(trade);
      return r ? levelFromCount(r.entry.count) : 0;
    };
    const level = (st, trade) => {
      const base = demand.level(st, trade);
      return st === state ? Math.max(base, liveLevel(trade)) : base;
    };

    const counts = { live: 0, cache: 0, stale: 0 };
    snap.forEach((r) => { counts[r.from] += 1; });

    return {
      level,
      note: demand.note,
      // Same order as the static list when there is no live data; live evidence can promote a trade.
      topTrades(st, n = 3) {
        if (st !== state) return demand.topTrades(st, n);
        const row = demand.DEMAND[state] || {};
        const candidates = [...Object.keys(row), ...[...snap.keys()].filter((t) => !(t in row))];
        return candidates
          .map((trade) => ({ trade, level: level(state, trade) }))
          .sort((a, b) => b.level - a.level)
          .slice(0, n);
      },
      liveInfo(st, trade) {
        if (st !== state) return null;
        const r = snap.get(trade);
        if (!r) return null;
        return {
          count: r.entry.count,
          capped: r.entry.count >= CAP,
          level: levelFromCount(r.entry.count),
          sample: r.entry.sample || [],
          fetchedAt: new Date(r.entry.fetchedAt).toISOString(),
          from: r.from,
          source: 'Google Jobs via SerpApi',
        };
      },
      meta: {
        enabled: true,
        source: 'Google Jobs via SerpApi',
        state,
        requested: requested.length,
        ...counts,
        missing: requested.length - snap.size,
      },
    };
  }

  /** profile -> a demand provider for recommend(). Never throws; worst case it is the static table. */
  async function snapshotFor(profile) {
    try {
      if (!enabled) return staticProvider('disabled');
      if (!apiKey) return staticProvider('no-key');
      if (circuitUntil > now()) return staticProvider('paused-after-error');

      const p = profile || {};
      const state = p.state;
      if (!state || !demand.DEMAND[state]) return staticProvider('unknown-state');

      const trades = pickTrades(p, state);
      const results = new Map();
      const tasks = trades.map((trade) =>
        resolve(state, trade)
          .then((r) => { if (r) results.set(trade, r); })
          .catch(() => {}),
      );
      await withDeadline(Promise.all(tasks), deadlineMs);
      // Copy now: lookups that finish after the deadline must not change this answer mid-request.
      return buildProvider(state, trades, new Map(results));
    } catch (err) {
      logger.warn('[live-demand] snapshot failed, using static table:', err.message);
      return staticProvider('error');
    }
  }

  async function status() {
    let used = null;
    try {
      used = await store.usage(monthKey(now()));
    } catch (_) {
      used = null;
    }
    return {
      enabled: Boolean(enabled && apiKey),
      hasKey: Boolean(apiKey),
      source: 'Google Jobs via SerpApi',
      month: monthKey(now()),
      usedThisMonth: used,
      monthlyBudget,
      cacheDays,
      maxTradesPerRequest: maxTrades,
      pausedAfterError: circuitUntil > now(),
    };
  }

  return { snapshotFor, status };
}

// Process-wide instance, created on first use so .env is already loaded and the DB is only touched when needed.
let instance = null;
function getInstance() {
  if (!instance) {
    const { createSequelizeStore } = require('./liveStore');
    instance = createLiveDemand({ store: createSequelizeStore() });
  }
  return instance;
}
const liveDemand = {
  snapshotFor: (profile) => getInstance().snapshotFor(profile),
  status: () => getInstance().status(),
};

module.exports = { liveDemand, createLiveDemand, levelFromCount, TRADE_QUERIES, CAP };
