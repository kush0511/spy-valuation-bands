import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  BarChart3,
  ExternalLink,
} from 'lucide-react'
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from 'lightweight-charts'
import valuationData from './data/valuation-data.json'
import './App.css'

const BAND_SLOT_COUNT = 6
const DEFAULT_PERIOD = '18M'

const COLORS = {
  spx: '#6ea2ff',
  ink: '#edf4ff',
  chartBg: '#070b10',
  grid: 'rgba(139, 154, 174, 0.14)',
  bands: ['#ff6678', '#f2c84b', '#27d65b', '#ffad4d', '#39d6e8', '#a8c8ff'],
  mutedBands: [
    'rgba(255, 102, 120, 0.62)',
    'rgba(242, 200, 75, 0.66)',
    'rgba(39, 214, 91, 0.72)',
    'rgba(255, 173, 77, 0.76)',
    'rgba(57, 214, 232, 0.72)',
    'rgba(168, 200, 255, 0.66)',
  ],
} as const

type RawDatum = {
  date: string
  spx: number
  eps: number
  pe: number
}

type DataFile = {
  generatedAt: string
  asOf: string
  rowCount: number
  source: {
    name: string
    url: string
    note: string
  }
  rows: RawDatum[]
}

type ChartDatum = RawDatum & {
  time: Time
}

type PeriodOption = {
  id: string
  label: string
  days?: number
  start?: string
}

const PERIODS: PeriodOption[] = [
  { id: '1M', label: '1M', days: 31 },
  { id: '3M', label: '3M', days: 93 },
  { id: '6M', label: '6M', days: 186 },
  { id: 'YTD', label: 'YTD', start: `${valuationData.asOf.slice(0, 4)}-01-01` },
  { id: '18M', label: '2025+', start: '2025-01-01' },
  { id: 'ALL', label: 'All' },
]

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const signedPercentFormatter = new Intl.NumberFormat('en-US', {
  signDisplay: 'always',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function toDisplayDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}

function toMonth(date: string) {
  return monthFormatter.format(new Date(`${date}T00:00:00Z`))
}

function formatIndex(value: number) {
  return numberFormatter.format(Math.round(value))
}

function formatMoney(value: number) {
  return `$${decimalFormatter.format(value)}`
}

function formatPercent(value: number) {
  return `${signedPercentFormatter.format(value)}%`
}

function formatMultiple(value: number) {
  return `${decimalFormatter.format(value)}x`
}

function asLineData(rows: ChartDatum[], valueForRow: (row: ChartDatum) => number) {
  return rows.map((row) => ({ time: row.time, value: valueForRow(row) }))
}

function bandDataForMultiple(rows: ChartDatum[], multiple: number) {
  return asLineData(rows, (row) => row.eps * multiple) as LineData[]
}

function getPeriodStartIndex(rows: ChartDatum[], period: PeriodOption) {
  if (!period.days && !period.start) {
    return 0
  }

  const latest = rows.at(-1)

  if (!latest) {
    return 0
  }

  const targetDate = period.start
    ? new Date(`${period.start}T00:00:00Z`)
    : new Date(new Date(`${latest.date}T00:00:00Z`).getTime() - Number(period.days) * 86_400_000)

  const target = targetDate.toISOString().slice(0, 10)
  const index = rows.findIndex((row) => row.date >= target)

  return index === -1 ? 0 : index
}

function nearestMultiple(pe: number) {
  return Math.max(1, Math.round(pe))
}

function adaptiveMultiples(pe: number) {
  const nearest = nearestMultiple(pe)
  const start = Math.max(1, nearest - 3)

  return Array.from({ length: BAND_SLOT_COUNT }, (_, index) => start + index)
}

function colorForSlot(index: number, active = false) {
  const safeIndex = Math.max(0, Math.min(index, COLORS.bands.length - 1))

  return active ? COLORS.bands[safeIndex] : COLORS.mutedBands[safeIndex]
}

function colorForMultiple(multiple: number, multiples: number[]) {
  return COLORS.bands[Math.max(0, multiples.indexOf(multiple))]
}

function lineWidthForBand(multiple: number, activeBand: number): 1 | 2 | 3 {
  if (multiple === activeBand) {
    return 3
  }

  if (Math.abs(multiple - activeBand) === 1) {
    return 2
  }

  return 1
}

function normalizeRows(data: DataFile) {
  return data.rows.map((row) => ({
    ...row,
    time: row.date as Time,
  }))
}

function toneForValue(value: number) {
  if (value > 0) {
    return 'positive'
  }

  if (value < 0) {
    return 'negative'
  }

  return 'neutral'
}

type ValuationChartProps = {
  rows: ChartDatum[]
  period: PeriodOption
  activeBand: number
  bandMultiples: number[]
}

function ValuationChart({
  rows,
  period,
  activeBand,
  bandMultiples,
}: ValuationChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const spxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const bandMultiplesKey = bandMultiples.join(',')

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    const compact = container.clientWidth < 620
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: COLORS.chartBg },
        textColor: '#9fabba',
        fontSize: compact ? 11 : 12,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      localization: {
        priceFormatter: (price: number) => formatIndex(price),
      },
      rightPriceScale: {
        borderColor: 'rgba(139, 154, 174, 0.22)',
        entireTextOnly: true,
        scaleMargins: {
          top: 0.08,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: 'rgba(139, 154, 174, 0.22)',
        rightOffset: compact ? 2 : 8,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: false,
      },
      crosshair: {
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: {
        horzTouchDrag: false,
        mouseWheel: false,
        pressedMouseMove: false,
        vertTouchDrag: false,
      },
      handleScale: {
        axisDoubleClickReset: false,
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false,
      },
    })

    chartRef.current = chart
    bandSeriesRef.current = []

    bandMultiples.forEach((multiple, index) => {
      const series = chart.addSeries(LineSeries, {
        color: colorForSlot(index, multiple === activeBand),
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        lineWidth: lineWidthForBand(multiple, activeBand),
        priceLineVisible: false,
        title: '',
      })

      series.setData(bandDataForMultiple(rows, multiple))
      bandSeriesRef.current[index] = series
    })

    const spxLineWidth: 3 | 4 = compact ? 3 : 4
    const spxSeries = chart.addSeries(LineSeries, {
      color: COLORS.spx,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineWidth: spxLineWidth,
      priceLineVisible: false,
      title: '',
    })

    spxSeries.setData(asLineData(rows, (row) => row.spx) as LineData[])
    spxSeriesRef.current = spxSeries

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const isCompact = width < 620
      const nextLineWidth: 3 | 4 = isCompact ? 3 : 4

      chart.applyOptions({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(300, Math.floor(height)),
        layout: {
          fontSize: isCompact ? 11 : 12,
        },
        timeScale: {
          rightOffset: isCompact ? 2 : 8,
        },
      })

      spxSeriesRef.current?.applyOptions({
        lineWidth: nextLineWidth,
      })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      spxSeriesRef.current = null
      bandSeriesRef.current = []
    }
  }, [activeBand, bandMultiples, bandMultiplesKey, rows])

  useEffect(() => {
    const chart = chartRef.current
    const latest = rows.at(-1)

    if (!chart || !latest) {
      return
    }

    const fromIndex = getPeriodStartIndex(rows, period)
    chart.timeScale().setVisibleRange({
      from: rows[fromIndex].time,
      to: latest.time,
    })
  }, [period, rows])

  useEffect(() => {
    bandSeriesRef.current.forEach((series, index) => {
      const multiple = bandMultiples[index]

      if (!multiple) {
        return
      }

      series.applyOptions({
        color: colorForSlot(index, multiple === activeBand),
        lineWidth: lineWidthForBand(multiple, activeBand),
        title: '',
      })
    })
  }, [activeBand, bandMultiples, bandMultiplesKey])

  return (
    <div className="chart-shell">
      <div className="chart-legend" aria-label="Displayed valuation multiples">
        <span className="legend-item legend-spx">
          <span style={{ '--legend-color': COLORS.spx } as CSSProperties} />
          S&P 500
        </span>
        {bandMultiples.map((multiple, index) => (
          <span
            key={multiple}
            className={activeBand === multiple ? 'legend-item is-active' : 'legend-item'}
          >
            <span style={{ '--legend-color': COLORS.bands[index] } as CSSProperties} />
            {multiple}x
          </span>
        ))}
      </div>
      <div ref={containerRef} className="chart-canvas" aria-label="S&P 500 valuation bands chart" />
    </div>
  )
}

function App() {
  const dataFile = valuationData as DataFile
  const rows = useMemo(() => normalizeRows(dataFile), [dataFile])
  const latest = rows.at(-1) ?? rows[0]
  const [periodId, setPeriodId] = useState(DEFAULT_PERIOD)
  const [requestedActiveBand, setRequestedActiveBand] = useState<number | null>(null)
  const period = PERIODS.find((option) => option.id === periodId) ?? PERIODS[0]
  const visibleStartIndex = getPeriodStartIndex(rows, period)
  const visibleRows = rows.slice(visibleStartIndex)
  const periodStart = visibleRows[0] ?? latest
  const latestNearestBand = nearestMultiple(latest.pe)
  const bandMultiples = useMemo(() => adaptiveMultiples(latestNearestBand), [latestNearestBand])
  const activeBand =
    requestedActiveBand !== null && bandMultiples.includes(requestedActiveBand)
      ? requestedActiveBand
      : latestNearestBand
  const activeBandLevel = latest.eps * activeBand
  const activeBandDelta = latest.spx - activeBandLevel
  const activeBandDeltaPercent = (activeBandDelta / activeBandLevel) * 100
  const statusLabel = `${activeBandDelta >= 0 ? 'Above' : 'Below'} ${activeBand}x`
  const peValues = visibleRows.map((row) => row.pe)
  const peMin = Math.min(...peValues)
  const peMax = Math.max(...peValues)
  const spxChange = ((latest.spx - periodStart.spx) / periodStart.spx) * 100
  const epsChange = ((latest.eps - periodStart.eps) / periodStart.eps) * 100
  const dateRangeLabel = `${toMonth(periodStart.date)} to ${toMonth(latest.date)}`
  const bandLevels = bandMultiples.map((multiple) => ({
    multiple,
    value: latest.eps * multiple,
  })).reverse()

  const handlePeriodChange = (nextPeriod: string) => {
    setPeriodId(nextPeriod)
  }

  return (
    <main className="app-shell">
      <header className="market-header" aria-labelledby="page-title">
        <div className="header-top">
          <div className="title-block">
            <div className="ticker-line">
              <span className="ticker-pill">SPX</span>
              <span className="as-of">As of {toDisplayDate(latest.date)}</span>
            </div>
            <h1 id="page-title">Forward P/E Bands</h1>
          </div>
          <div className={activeBandDelta >= 0 ? 'status-pill is-rich' : 'status-pill is-cheap'}>
            {statusLabel}
          </div>
        </div>

        <div className="metric-strip" aria-label="Latest valuation stats">
          <MetricItem
            label="S&P 500"
            value={formatIndex(latest.spx)}
            detail={`${formatPercent(spxChange)} in view`}
            tone={toneForValue(spxChange)}
          />
          <MetricItem
            label="Forward P/E"
            value={formatMultiple(latest.pe)}
            detail={`${decimalFormatter.format(peMin)}-${decimalFormatter.format(peMax)}x range`}
          />
          <MetricItem
            label="NTM EPS"
            value={formatMoney(latest.eps)}
            detail={`${formatPercent(epsChange)} in view`}
            tone={toneForValue(epsChange)}
          />
          <MetricItem
            label={`${activeBand}x level`}
            value={formatIndex(activeBandLevel)}
            detail={`${formatIndex(activeBandDelta)} / ${formatPercent(activeBandDeltaPercent)}`}
            tone={toneForValue(activeBandDelta)}
          />
        </div>
      </header>

      <section className="chart-stage" aria-label="Valuation chart">
        <div className="period-bar">
          <div className="period-buttons" role="group" aria-label="Chart time period">
            {PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={periodId === option.id}
                className={periodId === option.id ? 'is-active' : ''}
                onClick={() => handlePeriodChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="range-note">{dateRangeLabel}</div>
        </div>

        <div className="workspace-grid">
          <div className="chart-wrap">
            <ValuationChart
              rows={rows}
              period={period}
              activeBand={activeBand}
              bandMultiples={bandMultiples}
            />
          </div>

          <aside className="view-summary" aria-label="Visible range summary">
            <div className="summary-head">
              <div>
                <span>In View</span>
                <h2>{dateRangeLabel}</h2>
              </div>
              <small>{visibleRows.length} rows</small>
            </div>

            <div className="band-distance">
              <span>{statusLabel}</span>
              <strong>{formatPercent(activeBandDeltaPercent)}</strong>
              <small>{formatIndex(activeBandDelta)} points vs {activeBand}x</small>
            </div>

            <div className="summary-grid">
              <Readout label="Start SPX" value={formatIndex(periodStart.spx)} />
              <Readout label="End SPX" value={formatIndex(latest.spx)} />
              <Readout label="Start EPS" value={formatMoney(periodStart.eps)} />
              <Readout label="End EPS" value={formatMoney(latest.eps)} />
              <Readout label="Low P/E" value={formatMultiple(peMin)} />
              <Readout label="High P/E" value={formatMultiple(peMax)} />
            </div>
          </aside>
        </div>

        <div className="band-ladder" aria-label="Valuation band levels">
          <div className="ladder-title">
            <BarChart3 aria-hidden="true" size={17} />
            Latest EPS Band Levels
          </div>
          <div className="ladder-buttons">
            {bandLevels.map(({ multiple, value }) => (
              <button
                key={multiple}
                type="button"
                aria-pressed={activeBand === multiple}
                className={activeBand === multiple ? 'is-active' : ''}
                style={{ '--band-color': colorForMultiple(multiple, bandMultiples) } as CSSProperties}
                onClick={() => setRequestedActiveBand(multiple)}
              >
                <span>{multiple}x</span>
                <strong>{formatIndex(value)}</strong>
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="source-band" aria-label="Data source">
        <div>
          <div className="source-title">
            <Activity aria-hidden="true" size={17} />
            Data and Formula
          </div>
          <p>
            Band level = NTM EPS estimate x selected P/E multiple. Source:{' '}
            <a href={dataFile.source.url} target="_blank" rel="noreferrer">
              {dataFile.source.name}
              <ExternalLink aria-hidden="true" size={14} />
            </a>
            . Data generated {toDisplayDate(dataFile.generatedAt.slice(0, 10))}; latest market row{' '}
            {toDisplayDate(dataFile.asOf)}.
          </p>
        </div>
        <p className="disclaimer">Educational research view only. Not investment advice.</p>
      </footer>
    </main>
  )
}

function MetricItem({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  return (
    <div className="metric-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={`tone-${tone}`}>{detail}</small>
    </div>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default App
