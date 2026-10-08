/**
 * One real SerpApi call, to confirm your key and the response shape work.
 * Costs 1 search credit.
 *
 *   npm run check:serpapi                    # tailor jobs in Bihar
 *   npm run check:serpapi -- electrician Kerala
 */
require('dotenv').config();
const { searchJobs } = require('../src/serpapi/client');
const { TRADE_QUERIES, levelFromCount } = require('../src/livelihood/liveDemand');

(async () => {
  const [tradeArg = 'tailoring', state = 'Bihar'] = process.argv.slice(2);
  const words = TRADE_QUERIES[tradeArg] || tradeArg;
  const query = `${words} jobs in ${state}`;
  if (!process.env.SERPAPI_API_KEY) {
    console.error('SERPAPI_API_KEY is not set. Add it to backend/.env first.');
    process.exit(1);
  }
  console.log(`Searching Google Jobs via SerpApi: "${query}" ...`);
  try {
    const { count, sample } = await searchJobs({ query, apiKey: process.env.SERPAPI_API_KEY });
    console.log(`OK. ${count} listing(s) on page one -> demand level ${levelFromCount(count)} (1 low, 2 steady, 3 high)`);
    sample.forEach((j, i) => console.log(`  ${i + 1}. ${j.title} | ${j.company} | ${j.via}`));
    if (count === 0) console.log('  No listings. Try a different trade or state; this is not an error.');
  } catch (err) {
    console.error(`FAILED (${err.kind}): ${err.message}`);
    process.exit(1);
  }
})();
