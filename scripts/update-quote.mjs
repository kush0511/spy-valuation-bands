import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseYahooQuote, validQuote } from '../src/lib/quote.ts';

const URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1m&range=1d';
const DEPLOYED = 'https://kush0511.github.io/spy-valuation-bands/latest-quote.json';
const OUT = new globalThis.URL('../public/latest-quote.json', import.meta.url);

export async function fetchQuote(fetchImpl = fetch, nowMs = Date.now()) {
  const response = await fetchImpl(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Quote HTTP ${response.status}`);
  return parseYahooQuote(await response.json(), nowMs);
}

export async function refreshQuote({ fetchImpl = fetch, output = OUT, nowMs = Date.now() } = {}) {
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* first publish */ }
  let quote, failure;
  try { quote = await fetchQuote(fetchImpl, nowMs); } catch (error) { failure = error; }

  // Always compare against the published artifact, even when Yahoo succeeds.
  // Intraday deployments do not commit, so the daily repository seed can be older.
  let recovered = false;
  try {
    const response = await fetchImpl(DEPLOYED, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const deployed = await response.json();
      if (validQuote(deployed, nowMs) && (!validQuote(previous, nowMs) || deployed.time >= previous.time)) {
        previous = deployed;
        recovered = true;
      }
    }
  } catch { /* provider success or repository seed remains usable */ }

  if (quote && validQuote(previous, nowMs) && quote.time < previous.time) {
    failure = new Error('Quote timestamp regressed behind the newest known observation');
    quote = null;
  }
  if (quote) {
    await mkdir(new globalThis.URL('./', output), { recursive: true });
    await writeFile(output, `${JSON.stringify(quote, null, 2)}\n`);
    console.log(`Saved SPX ${quote.price} observed ${new Date(quote.time).toISOString()}.`);
    return { updated: true, quote };
  }
  // Never update provenance after a failure. The client will age/reject the old quote.
  if (!previous) throw failure || new Error('No index quote available');
  if (recovered) {
    await mkdir(new globalThis.URL('./', output), { recursive: true });
    await writeFile(output, `${JSON.stringify(previous, null, 2)}\n`);
  }
  console.warn(`::warning::Quote refresh failed; retaining prior timestamp: ${failure?.message || 'Unavailable'}`);
  return { updated: false, quote: previous };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await refreshQuote();
