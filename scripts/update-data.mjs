import { mkdir, writeFile } from 'node:fs/promises'

const API_ROOT = 'https://streetstats.finance'
const OUT_FILE = new URL('../src/data/valuation-data.json', import.meta.url)
const IDS = ['Date', 'SPX', 'ntmE', 'ntmPE']

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 600))
      }
    }
  }

  throw lastError
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeRows(rows) {
  return rows
    .map((row) => ({
      date: String(row.Date).slice(0, 10),
      spx: toNumber(row.SPX),
      eps: toNumber(row.ntmE),
      pe: toNumber(row.ntmPE),
    }))
    .filter((row) => row.date && row.spx && row.eps && row.pe)
}

const { token } = await fetchJson(`${API_ROOT}/api/token`)
const query = IDS.map((id) => `id=${encodeURIComponent(id)}`).join('&')
const rows = normalizeRows(
  await fetchJson(`${API_ROOT}/api/daily/columns?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }),
)

if (rows.length < 1000) {
  throw new Error(`Unexpectedly small valuation dataset: ${rows.length} rows`)
}

const latest = rows.at(-1)
const payload = {
  generatedAt: new Date().toISOString(),
  asOf: latest.date,
  rowCount: rows.length,
  fields: {
    spx: 'S&P 500 index level',
    eps: 'Next-twelve-month S&P 500 operating earnings estimate per index share',
    pe: 'Forward 12-month price/earnings ratio',
  },
  source: {
    name: 'StreetStats daily valuation API',
    url: 'https://streetstats.finance/valuation/market',
    note: 'StreetStats describes these values as calculated from S&P 500 index price and aggregated bottom-up S&P 500 trailing and forward earnings.',
  },
  rows,
}

await mkdir(new URL('../src/data/', import.meta.url), { recursive: true })
await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`)

console.log(
  `Wrote ${rows.length.toLocaleString('en-US')} valuation rows through ${latest.date}.`,
)
