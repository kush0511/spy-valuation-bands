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

GitHub Pages refreshes at 01:18 UTC Tuesday–Saturday (after US weekday trading), on pushes to main and on manual dispatch. After validation and build, the workflow commits the refreshed snapshot and its fetch timestamp to main before deploying. These real snapshot commits supply the repository activity needed to avoid GitHub's 60-day inactivity shutdown. They use the built-in GITHUB_TOKEN, so they do not recursively trigger push deployments. No PAT, empty commits or extra service is required. Main must allow the workflow's contents-write permission and data commits; branch protection can block them, in which case the job fails visibly. Sustained source/workflow failures still require attention.

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
npm test
npm run lint
npm run build
npm run dev
```

PRs run data/range regression tests, lint and build. Main deployments run the same checks against the freshly fetched dataset.
