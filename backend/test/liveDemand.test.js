'use strict';
// Run with: npm test   (Node 18+, no database and no network needed)
const test = require('node:test');
const assert = require('node:assert/strict');

const { searchJobs } = require('../src/serpapi/client');
const { createLiveDemand, levelFromCount, TRADE_QUERIES } = require('../src/livelihood/liveDemand');
const { createMemoryStore } = require('../src/livelihood/liveStore');
const { recommend } = require('../src/livelihood/recommend');
const demand = require('../src/livelihood/demand');
const { TRADES } = require('../src/livelihood/vocab');

const quiet = { warn() {} };
const jobs = (n) => Array.from({ length: n }, (_, i) => ({ title: `Job ${i}`, company_name: `Co ${i}`, via: 'via Test' }));
const okResponse = (n) => ({ ok: true, status: 200, json: async () => ({ jobs_results: jobs(n) }) });

// a person from Bihar who wants a computer course; computer is only "low" (1) in the static Bihar row
const person = {
  state: 'Bihar', age: 22, education: 'class12', gender: 'female', category: 'sc',
  interests: ['computer'], currentActivity: [], familyOccupation: ['farming'], localWork: ['farming'],
  travel: 'local', employmentPreference: 'wage', physicalConstraint: false, skipped: [], notes: {},
};

function make(over = {}) {
  const calls = [];
  const ld = createLiveDemand({
    apiKey: 'test-key',
    enabled: true,
    store: createMemoryStore(),
    search: async ({ query }) => { calls.push(query); return { count: 10, sample: [{ title: 'Data Entry Operator', company: 'Acme', via: 'via Test' }] }; },
    logger: quiet,
    deadlineMs: 500,
    ...over,
  });
  return { ld, calls };
}

test('every trade has a search query', () => {
  for (const t of Object.keys(TRADES)) assert.ok(TRADE_QUERIES[t], `missing query for ${t}`);
});

test('levelFromCount thresholds', () => {
  assert.equal(levelFromCount(0), 1);
  assert.equal(levelFromCount(3), 1);
  assert.equal(levelFromCount(4), 2);
  assert.equal(levelFromCount(7), 2);
  assert.equal(levelFromCount(8), 3);
  assert.equal(levelFromCount(10), 3);
});

// ---------- client ----------
test('client: parses listings and sends the expected request', async () => {
  let url;
  const out = await searchJobs({ query: 'tailor jobs in Bihar', apiKey: 'k', fetchImpl: async (u) => { url = u; return okResponse(5); } });
  assert.equal(out.count, 5);
  assert.equal(out.sample.length, 3);
  assert.deepEqual(out.sample[0], { title: 'Job 0', company: 'Co 0', via: 'via Test' });
  assert.match(url, /engine=google_jobs/);
  assert.match(url, /gl=in/);
  assert.match(url, /q=tailor\+jobs\+in\+Bihar/);
});

test('client: "no results" is an empty result, not a failure', async () => {
  const out = await searchJobs({ query: 'x', apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: "Google hasn't returned any results for this query." }) }) });
  assert.deepEqual(out, { count: 0, sample: [] });
});

test('client: auth and quota errors are classified, and the key never leaks', async () => {
  await assert.rejects(
    searchJobs({ query: 'x', apiKey: 'SECRETKEY', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid API key SECRETKEY' }) }) }),
    (e) => e.kind === 'auth' && !e.message.includes('SECRETKEY'),
  );
  await assert.rejects(
    searchJobs({ query: 'x', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate' }) }) }),
    (e) => e.kind === 'quota',
  );
});

test('client: timeout becomes a timeout error', async () => {
  const hang = (_u, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(searchJobs({ query: 'x', apiKey: 'k', fetchImpl: hang, timeoutMs: 20 }), (e) => e.kind === 'timeout');
});

// ---------- fallbacks ----------
test('no key: static table, and recommend() output is identical to calling it with no options', async () => {
  const { ld, calls } = make({ apiKey: '' });
  const snap = await ld.snapshotFor(person);
  assert.equal(snap.meta.enabled, false);
  assert.equal(snap.meta.reason, 'no-key');
  assert.equal(calls.length, 0);
  assert.deepEqual(recommend(person, 'en', { demand: snap }), recommend(person, 'en'));
});

test('disabled and unknown state also fall back without calling SerpApi', async () => {
  const a = make({ enabled: false });
  assert.equal((await a.ld.snapshotFor(person)).meta.reason, 'disabled');
  const b = make();
  assert.equal((await b.ld.snapshotFor({ ...person, state: 'Atlantis' })).meta.reason, 'unknown-state');
  assert.equal((await b.ld.snapshotFor({})).meta.reason, 'unknown-state');
  assert.equal(a.calls.length + b.calls.length, 0);
});

// ---------- blending ----------
test('live listings raise a low static level (and are shown as evidence)', async () => {
  const { ld } = make();
  assert.equal(demand.level('Bihar', 'computer'), 1); // static: low
  const snap = await ld.snapshotFor(person);
  assert.equal(snap.level('Bihar', 'computer'), 3);
  const info = snap.liveInfo('Bihar', 'computer');
  assert.equal(info.count, 10);
  assert.equal(info.capped, true);
  assert.equal(info.source, 'Google Jobs via SerpApi');
});

test('raise-only: a thin live result never lowers a high static level', async () => {
  const { ld } = make({ search: async () => ({ count: 0, sample: [] }) });
  const snap = await ld.snapshotFor({ ...person, interests: ['farming'] });
  assert.equal(demand.level('Bihar', 'farming'), 3);
  assert.equal(snap.level('Bihar', 'farming'), 3);
});

test('topTrades matches the static list when there is no live data, and promotes live trades otherwise', async () => {
  const none = make({ search: async () => ({ count: 0, sample: [] }) });
  const s0 = await none.ld.snapshotFor(person);
  assert.deepEqual(s0.topTrades('Bihar', 3), demand.topTrades('Bihar', 3));
  // Uttarakhand has only two "high" trades statically, so a trade with 10 live listings earns the third slot.
  // (On a tie, static trades keep their place: live evidence adds to the table, it never pushes static knowledge out.)
  const live = make({ search: async ({ query }) => ({ count: /data entry/.test(query) ? 10 : 0, sample: [] }) });
  const uk = { ...person, state: 'Uttarakhand' };
  const s1 = await live.ld.snapshotFor(uk);
  assert.ok(!demand.topTrades('Uttarakhand', 3).some((x) => x.trade === 'computer'));
  assert.ok(s1.topTrades('Uttarakhand', 3).some((x) => x.trade === 'computer'), 'computer (10 live listings) should be promoted');
});

// ---------- frugality ----------
test('cache: the second request for the same person does not call SerpApi again', async () => {
  const { ld, calls } = make();
  const first = await ld.snapshotFor(person);
  const n = calls.length;
  assert.ok(n >= 1 && n <= 4);
  const second = await ld.snapshotFor(person);
  assert.equal(calls.length, n);
  assert.equal(second.meta.cache, n);
  assert.equal(first.meta.live, n);
});

test('concurrent identical requests share one SerpApi call per trade', async () => {
  const sent = [];
  const { ld } = make({ search: async ({ query }) => { sent.push(query); await new Promise((r) => setTimeout(r, 30)); return { count: 5, sample: [] }; } });
  await Promise.all([ld.snapshotFor(person), ld.snapshotFor(person), ld.snapshotFor(person)]);
  assert.ok(sent.length >= 1);
  assert.equal(sent.length, new Set(sent).size, 'no query was sent twice');
});

test('monthly budget stops spending; the rest falls back to the static table', async () => {
  const { ld, calls } = make({ monthlyBudget: 2 });
  const snap = await ld.snapshotFor(person);
  assert.equal(calls.length, 2);
  assert.ok(snap.meta.missing >= 1);
  assert.equal((await ld.status()).usedThisMonth, 2);
});

test('budget exhausted: an old cached result is still used (stale) instead of nothing', async () => {
  const store = createMemoryStore();
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await store.set('Bihar', 'computer', { query: 'q', count: 9, sample: [], fetchedAt: old });
  const { ld, calls } = make({ store, monthlyBudget: 0 });
  const snap = await ld.snapshotFor(person);
  assert.equal(calls.length, 0);
  assert.equal(snap.liveInfo('Bihar', 'computer').from, 'stale');
  assert.equal(snap.level('Bihar', 'computer'), 3);
});

// ---------- never slow, never broken ----------
test('deadline: a slow SerpApi does not hold the request, and the late result still warms the cache', async () => {
  const store = createMemoryStore();
  const { ld } = make({ store, deadlineMs: 20, search: async () => { await new Promise((r) => setTimeout(r, 80)); return { count: 9, sample: [] }; } });
  const t0 = Date.now();
  const snap = await ld.snapshotFor({ ...person, interests: ['computer'], familyOccupation: [], localWork: [] });
  assert.ok(Date.now() - t0 < 70, 'returned at the deadline, not after the slow call');
  assert.equal(snap.level('Bihar', 'computer'), demand.level('Bihar', 'computer')); // static for now
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await store.get('Bihar', 'computer')).count, 9); // cache warmed in the background
});

test('an auth error pauses SerpApi calls and the app keeps working on the static table', async () => {
  let n = 0;
  const { ld } = make({ search: async () => { n += 1; const e = new Error('bad key'); e.kind = 'auth'; throw e; } });
  const first = await ld.snapshotFor(person);
  assert.equal(first.liveInfo('Bihar', 'computer'), null);
  const before = n;
  const second = await ld.snapshotFor(person);
  assert.equal(second.meta.reason, 'paused-after-error');
  assert.equal(n, before);
  assert.deepEqual(recommend(person, 'en', { demand: second }), recommend(person, 'en'));
});

test('a broken cache never breaks the request', async () => {
  const broken = { get: async () => { throw new Error('db down'); }, set: async () => { throw new Error('db down'); }, reserve: async () => { throw new Error('db down'); }, usage: async () => { throw new Error('db down'); } };
  const { ld } = make({ store: broken });
  const snap = await ld.snapshotFor(person);
  assert.equal(snap.level('Bihar', 'computer'), 1); // static
  assert.ok(recommend(person, 'en', { demand: snap }).recommendations.length >= 0);
});

// ---------- recommender ----------
test('recommend: live evidence shows up as a plain sentence and in local.live, and results are deterministic', async () => {
  const { ld } = make();
  const snap = await ld.snapshotFor(person);
  const a = recommend(person, 'en', { demand: snap });
  const b = recommend(person, 'en', { demand: snap });
  assert.deepEqual(a, b);

  const computer = a.recommendations.find((r) => r.course.trades.includes('computer'));
  assert.ok(computer, 'a computer course should be recommended');
  assert.ok(computer.reasons.some((x) => /10\+ job listings for .* were found in Bihar/.test(x)), computer.reasons.join(' | '));
  assert.equal(computer.local.live.count, 10);

  const hi = recommend(person, 'hi', { demand: snap });
  assert.ok(hi.recommendations.some((r) => r.reasons.some((x) => x.includes('नौकरी की सूचियाँ'))));
});

test('recommend: without options nothing changes (no live fields at all)', () => {
  const r = recommend(person, 'en');
  r.recommendations.forEach((rec) => assert.equal('live' in rec.local, false));
});
