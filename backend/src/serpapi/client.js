'use strict';

/**
 * Minimal SerpApi client (Google Jobs engine only).
 *
 * No extra dependency: Node 18+ ships a global fetch. The API key is sent as a
 * query parameter (that is how SerpApi works) but is never logged and is
 * scrubbed from every error message this module throws.
 *
 * SERPAPI_ENDPOINT exists only so tests can point at a local fake server.
 */
const DEFAULT_ENDPOINT = 'https://serpapi.com/search.json';

class SerpApiError extends Error {
  constructor(message, { status = null, kind = 'error' } = {}) {
    super(message);
    this.name = 'SerpApiError';
    this.status = status;
    // 'auth' | 'quota' | 'timeout' | 'network' | 'error'
    this.kind = kind;
  }
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

function buildUrl({ query, apiKey, endpoint }) {
  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: query,
    gl: 'in', // India
    hl: 'en',
    google_domain: 'google.co.in',
    api_key: apiKey,
  });
  return `${endpoint}?${params.toString()}`;
}

/**
 * One Google Jobs search. Resolves to { count, sample } where
 *   count  = number of listings on the first page (Google returns at most 10)
 *   sample = up to 3 { title, company, via } so the UI can show real evidence
 * Rejects with SerpApiError.
 */
async function searchJobs({
  query,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  endpoint = process.env.SERPAPI_ENDPOINT || DEFAULT_ENDPOINT,
}) {
  if (!apiKey) throw new SerpApiError('SERPAPI_API_KEY is not set', { kind: 'auth' });
  if (!query) throw new SerpApiError('Empty search query');
  if (typeof fetchImpl !== 'function') throw new SerpApiError('fetch is not available (Node 18+ required)');

  const scrub = (msg) => String(msg).split(apiKey).join('***');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetchImpl(buildUrl({ query, apiKey, endpoint }), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new SerpApiError('SerpApi request timed out', { kind: 'timeout' });
    throw new SerpApiError('Could not reach SerpApi', { kind: 'network' });
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null; // non-JSON body; handled below
  }

  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'quota' : 'error';
    const detail = body && body.error ? `: ${scrub(body.error)}` : '';
    throw new SerpApiError(`SerpApi returned HTTP ${res.status}${detail}`, { status: res.status, kind });
  }

  if (body && body.error) {
    const msg = scrub(body.error);
    // "Google hasn't returned any results for this query." is a normal empty result, not a failure.
    if (/hasn'?t returned any results|no results/i.test(msg)) return { count: 0, sample: [] };
    const kind = /api key/i.test(msg) ? 'auth' : /run out of searches|plan|limit|quota/i.test(msg) ? 'quota' : 'error';
    throw new SerpApiError(`SerpApi error: ${msg}`, { kind });
  }

  const jobs = body && Array.isArray(body.jobs_results) ? body.jobs_results : [];
  return {
    count: jobs.length,
    sample: jobs.slice(0, 3).map((j) => ({
      title: clip(j.title, 80),
      company: clip(j.company_name, 60),
      via: clip(j.via, 40),
    })),
  };
}

module.exports = { searchJobs, SerpApiError, buildUrl };
