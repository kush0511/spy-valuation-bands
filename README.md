# SPX Valuation Desk

A responsive S&P 500 research desk built with React, Vite and Lightweight Charts.

## Explore

- Calendar-based 1M, 3M, 6M, YTD, 1Y (default), 3Y and All ranges, anchored to the latest available market observation.
- Stable 16×–26× earnings scenarios in two-point increments. Hovering, date scrubbing and selecting a scenario preserve the chart instance and visible range.
- Desktop inspection beside the chart; compact, touch-friendly controls and inspection below the chart on phones.
- Hover for temporary inspection; use the date slider or arrow controls to retain a date. Latest clears the selection. Keyboard users can focus the slider and use arrow keys, Home and End.
- Age is measured against today's UTC date, even on an old deployment. More than four calendar days shows a delayed-data warning; this is a conservative age threshold, not an exchange holiday calendar.

## Data and refresh

`scripts/update-data.mjs` fetches StreetStats daily data into `src/data/valuation-data.json`:

- `spx`: S&P 500 index level (not SPY ETF price)
- `eps`: next-twelve-month operating earnings estimate
- `pe`: forward P/E

Band level = EPS × P/E multiple. Scenarios are not fair-value estimates or price targets.

The updater has bounded requests and rejects malformed/duplicate dates, invalid values, future dates, source regression, undersized datasets and data more than seven days old. Failed fetches/validation leave the prior snapshot untouched and fail the workflow.

The latest-price overlay is separate from historical rows. `scripts/update-quote.mjs` obtains Yahoo Finance's S&P 500 **index** (`^GSPC`, not SPY ETF) price and observation timestamp and publishes `public/latest-quote.json`. Current estimated forward P/E is that index price divided by the latest dated StreetStats NTM EPS. Historical charts and earnings are never rewritten by intraday quotes. The quote time and EPS date remain separate.

Yahoo's no-key chart endpoint is unofficial and does not provide browser CORS access. Fetching happens in the existing GitHub Actions workflow; the browser reads a same-origin public JSON artifact, without a third-party proxy or credentials. This is **scheduled latest-available data, not a continuous live feed**. Quote refresh is requested every 20 minutes on weekdays in a conservative 13:00–22:59 UTC window covering US market hours across daylight-saving changes. GitHub scheduling, builds and CDN propagation can add delay. The displayed quote observation timestamp is authoritative, not the fetch time. Weekends retain the last session quote. Invalid, future, over-seven-day-old or earlier-than-EPS-date quotes are rejected by the UI.

Daily EPS/history refresh remains at 01:18 UTC Tuesday–Saturday, plus pushes to main and manual dispatch. Intraday quote-only schedules do not repeatedly request the full StreetStats history. Quote-fetch failures recover the prior published artifact or repository seed without changing its observation time or fetched timestamp; the UI ages or rejects it. Source errors are visible in the workflow warnings. The daily EPS updater still fails visibly if its validation fails.

After validation/build, daily/push/manual runs commit actual refreshed data and fetch provenance to main before deploying. Intraday runs deploy artifacts **without creating commits**. Daily data commits supply activity needed to avoid GitHub's 60-day inactivity shutdown and use the built-in GITHUB_TOKEN, so they do not recursively trigger push deployments. No PAT, API key or extra service is required. Main must allow workflow contents-write and data commits; branch protection can block them. Sustained source/workflow failures require attention.

If the schedule was already disabled, reactivate it once:

```bash
gh workflow enable pages.yml
gh workflow run pages.yml --ref main
```

GitHub schedules can be delayed; the displayed market observation date is authoritative.

## Development and checks

```bash
npm ci
npm run update-data
node scripts/update-quote.mjs
npm test
npm run lint
npm run build
npm run dev
```

PRs run data/range regression tests, lint and build. Main deployments run the same checks against the freshly fetched dataset.

### Mobile quote display

The latest quote value and timestamp sit above the historical chart, outside its canvas. No horizontal quote guide or filled price tag covers the historical series at any viewport size. Historical inspection and Latest reset continue to use their respective dated observations.
