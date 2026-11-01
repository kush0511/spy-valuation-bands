export type Quote = {
  symbol: '^GSPC';
  price: number;
  time: number;
  fetchedAt: string;
  regularSessionEnd?: number;
};
const DAY = 86_400_000;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validQuote(value: unknown, nowMs = Date.now()): value is Quote {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  const fetched = typeof q.fetchedAt === 'string' ? Date.parse(q.fetchedAt) : NaN;
  return q.symbol === '^GSPC' && finite(q.price) && q.price > 0 && finite(q.time) && q.time > 0
    && q.time <= nowMs + 60_000 && nowMs - q.time <= 7 * DAY
    && Number.isFinite(fetched) && fetched <= nowMs + 60_000 && fetched >= q.time - 60_000
    && (q.regularSessionEnd === undefined || (finite(q.regularSessionEnd) && q.regularSessionEnd > 0));
}

export function parseYahooQuote(value: unknown, nowMs = Date.now()): Quote {
  const chart = (value as { chart?: { error?: unknown; result?: { meta?: Record<string, unknown> }[] } })?.chart;
  const meta = chart?.result?.[0]?.meta;
  if (chart?.error || !meta || meta.symbol !== '^GSPC' || meta.instrumentType !== 'INDEX'
    || !finite(meta.regularMarketTime) || !finite(meta.regularMarketPrice)) throw new Error('Invalid SPX quote response');
  const session = meta.currentTradingPeriod as { regular?: { end?: unknown } } | undefined;
  const quote: Quote = {
    symbol: '^GSPC', price: meta.regularMarketPrice, time: meta.regularMarketTime * 1000,
    fetchedAt: new Date(nowMs).toISOString(),
    ...(finite(session?.regular?.end) ? { regularSessionEnd: session.regular.end * 1000 } : {}),
  };
  if (!validQuote(quote, nowMs)) throw new Error('Invalid or stale SPX quote');
  return quote;
}

export function quoteEligible(quote: unknown, snapshotDate: string, nowMs = Date.now()): quote is Quote {
  // Daily EPS snapshot has only a date, not an intraday publication timestamp.
  const snapshotTime = Date.parse(`${snapshotDate}T00:00:00Z`);
  return Number.isFinite(snapshotTime) && validQuote(quote, nowMs) && quote.time >= snapshotTime;
}

export function quoteStatus(quote: Quote, nowMs = Date.now()): 'latest quote' | 'last close' | 'aged quote' {
  // This describes the recorded session, not whether a new session is open now.
  if (quote.regularSessionEnd && quote.time >= quote.regularSessionEnd - 60_000 && nowMs >= quote.regularSessionEnd) return 'last close';
  return nowMs - quote.time > 3_600_000 ? 'aged quote' : 'latest quote';
}
