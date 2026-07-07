import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  Activity,
  BarChart3,
  CalendarDays,
  ExternalLink,
  Gauge,
  RefreshCcw,
  Target,
  TrendingUp,
} from 'lucide-react'
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import valuationData from './data/valuation-data.json'
import './App.css'

const BAND_SLOT_COUNT = 6
const DEFAULT_PERIOD = '18M'
const DAY_IN_MS = 86_400_000

const COLORS = {
  spx: '#8fb8ff',
  ink: '#f2f7ff',
  chartBg: '#071015',
  grid: 'rgba(195, 210, 225, 0.14)',
  bands: ['#e55365', '#f2b84b', '#20bf6b', '#ff985a', '#37c2d6', '#b7ccff'],
  mutedBands: [
    'rgba(229, 83, 101, 0.58)',
    'rgba(242, 184, 75, 0.62)',
    'rgba(32, 191, 107, 0.68)',
    'rgba(255, 152, 90, 0.64)',
    'rgba(55, 194, 214, 0.62)',
    'rgba(183, 204, 255, 0.58)',
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

type Tone = 'positive' | 'negative' | 'neutral'

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

function pluralizeDay(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`
}

function dayDelta(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime()
  const to = new Date(`${toDate}T00:00:00Z`).getTime()

  return Math.max(0, Math.round((to - from) / DAY_IN_MS))
}

function timeToDate(time: Time | undefined) {
  if (!time) {
    return null
  }

  if (typeof time === 'string') {
    return time
  }

  if (typeof time === 'number') {
    return new Date(time * 1000).toISOString().slice(0, 10)
  }

  return [
    time.year,
    String(time.month).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ].join('-')
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
    : new Date(new Date(`${latest.date}T00:00:00Z`).getTime() - Number(period.days) * DAY_IN_MS)

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

function toneForValue(value: number): Tone {
  if (value > 0) {
    return 'positive'
  }

  if (value < 0) {
    return 'negative'
  }

  return 'neutral'
}

function toneForValuationGap(delta: number): Tone {
  if (delta > 0) {
    return 'negative'
  }

  if (delta < 0) {
    return 'positive'
  }

  return 'neutral'
}

function valuationStatus(delta: number, multiple: number) {
  return `${delta >= 0 ? 'Above' : 'Below'} ${multiple}x`
}

function railPosition(value: number, min: number, max: number) {
  if (max === min) {
    return 50
  }

  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

type ValuationChartProps = {
  rows: ChartDatum[]
  period: PeriodOption
  activeBand: number
  bandMultiples: number[]
  focusDate: string
  onFocusDate: (date: string) => void
}

function ValuationChart({
  rows,
  period,
  activeBand,
  bandMultiples,
  focusDate,
  onFocusDate,
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
        textColor: '#a9b8c8',
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
        borderColor: 'rgba(195, 210, 225, 0.18)',
        entireTextOnly: true,
        scaleMargins: {
          top: 0.08,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: 'rgba(195, 210, 225, 0.18)',
        rightOffset: compact ? 2 : 8,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: false,
      },
      crosshair: {
        vertLine: {
          visible: true,
          labelVisible: true,
          color: 'rgba(242, 247, 255, 0.32)',
          labelBackgroundColor: '#17212b',
        },
        horzLine: {
          visible: true,
          labelVisible: true,
          color: 'rgba(242, 247, 255, 0.18)',
          labelBackgroundColor: '#17212b',
        },
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
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: compact ? 4 : 5,
      lastValueVisible: false,
      lineWidth: spxLineWidth,
      priceLineVisible: false,
      title: '',
    })

    spxSeries.setData(asLineData(rows, (row) => row.spx) as LineData[])
    spxSeriesRef.current = spxSeries

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const date = timeToDate(param.time)

      if (date) {
        onFocusDate(date)
      }
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)

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
        crosshairMarkerRadius: isCompact ? 4 : 5,
      })
    })

    resizeObserver.observe(container)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      spxSeriesRef.current = null
      bandSeriesRef.current = []
    }
  }, [activeBand, bandMultiples, bandMultiplesKey, onFocusDate, rows])

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

  useEffect(() => {
    const chart = chartRef.current
    const series = spxSeriesRef.current
    const focused = rows.find((row) => row.date === focusDate)

    if (!chart || !series || !focused) {
      return
    }

    chart.setCrosshairPosition(focused.spx, focused.time, series)
  }, [focusDate, rows])

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
  const rowByDate = useMemo(() => new Map(rows.map((row) => [row.date, row])), [rows])
  const latest = rows.at(-1) ?? rows[0]
  const [periodId, setPeriodId] = useState(DEFAULT_PERIOD)
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const [requestedActiveBand, setRequestedActiveBand] = useState<number | null>(null)
  const period = PERIODS.find((option) => option.id === periodId) ?? PERIODS[0]
  const visibleStartIndex = getPeriodStartIndex(rows, period)
  const visibleRows = rows.slice(visibleStartIndex)
  const periodStart = visibleRows[0] ?? latest
  const focusCandidate = focusDate ? rowByDate.get(focusDate) : null
  const focusedRow = focusCandidate && focusCandidate.date >= periodStart.date ? focusCandidate : latest
  const isLatestFocus = focusedRow.date === latest.date
  const hasDormantFocus = focusDate !== null && focusDate !== latest.date
  const focusNearestBand = nearestMultiple(focusedRow.pe)
  const bandMultiples = useMemo(() => adaptiveMultiples(focusNearestBand), [focusNearestBand])
  const activeBand =
    requestedActiveBand !== null && bandMultiples.includes(requestedActiveBand)
      ? requestedActiveBand
      : focusNearestBand
  const focusBandLevel = focusedRow.eps * activeBand
  const focusBandDelta = focusedRow.spx - focusBandLevel
  const focusBandDeltaPercent = (focusBandDelta / focusBandLevel) * 100
  const focusStatusLabel = valuationStatus(focusBandDelta, activeBand)
  const latestNearestBand = nearestMultiple(latest.pe)
  const latestBandLevel = latest.eps * latestNearestBand
  const latestBandDelta = latest.spx - latestBandLevel
  const latestBandDeltaPercent = (latestBandDelta / latestBandLevel) * 100
  const latestStatusLabel = valuationStatus(latestBandDelta, latestNearestBand)
  const latestStatusTone = latestBandDelta >= 0 ? 'rich' : 'cheap'
  const peValues = visibleRows.map((row) => row.pe)
  const peMin = Math.min(...peValues)
  const peMax = Math.max(...peValues)
  const spxChange = ((latest.spx - periodStart.spx) / periodStart.spx) * 100
  const epsChange = ((latest.eps - periodStart.eps) / periodStart.eps) * 100
  const dateRangeLabel = `${toMonth(periodStart.date)} to ${toMonth(latest.date)}`
  const generatedDate = dataFile.generatedAt.slice(0, 10)
  const sourceLagDays = dayDelta(dataFile.asOf, generatedDate)
  const freshnessLabel =
    sourceLagDays === 0 ? 'same-day market row' : `${pluralizeDay(sourceLagDays)} source lag`
  const bandLevels = bandMultiples
    .map((multiple, index) => {
      const value = focusedRow.eps * multiple

      return {
        multiple,
        value,
        color: COLORS.bands[index],
        deltaPercent: ((value - focusedRow.spx) / focusedRow.spx) * 100,
      }
    })
    .reverse()
  const railMin = Math.min(focusedRow.spx, focusBandLevel)
  const railMax = Math.max(focusedRow.spx, focusBandLevel)
  const railPadding = Math.max((railMax - railMin) * 0.18, focusedRow.spx * 0.01)
  const railDomainMin = railMin - railPadding
  const railDomainMax = railMax + railPadding
  const spotPosition = railPosition(focusedRow.spx, railDomainMin, railDomainMax)
  const bandPosition = railPosition(focusBandLevel, railDomainMin, railDomainMax)
  const railLeft = Math.min(spotPosition, bandPosition)
  const railWidth = Math.abs(spotPosition - bandPosition)

  const handleFocusDate = useCallback(
    (date: string) => {
      if (!rowByDate.has(date)) {
        return
      }

      setFocusDate((current) => (current === date ? current : date))
    },
    [rowByDate],
  )

  const handleResetFocus = useCallback(() => {
    setFocusDate(null)
    setRequestedActiveBand(null)
  }, [])

  return (
    <main className="app-shell">
      <section className="chart-stage" aria-labelledby="page-title">
        <div className="desk-toolbar">
          <div className="desk-identity">
            <div className="eyebrow-row">
              <span className="ticker-pill">SPX</span>
              <span>Forward earnings valuation</span>
            </div>
            <h1 id="page-title">SPX Valuation Desk</h1>
          </div>

          <div className="toolbar-cluster">
            <div className={`latest-inline is-${latestStatusTone}`} aria-label="Latest valuation read">
              <span>Latest</span>
              <strong>
                {latestStatusLabel} by {formatPercent(latestBandDeltaPercent)}
              </strong>
              <small>{toDisplayDate(latest.date)}</small>
            </div>

            <div className="period-buttons" role="group" aria-label="Chart time period">
              {PERIODS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={periodId === option.id}
                  className={periodId === option.id ? 'is-active' : ''}
                  onClick={() => setPeriodId(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="toolbar-meta">
              <span>{dateRangeLabel}</span>
              <button
                type="button"
                className="reset-focus"
                onClick={handleResetFocus}
                disabled={isLatestFocus && !hasDormantFocus && requestedActiveBand === null}
                title="Return to latest row"
              >
                <RefreshCcw aria-hidden="true" size={15} />
                Latest
              </button>
            </div>
          </div>
        </div>

        <div className="chart-wrap">
          <ValuationChart
            rows={rows}
            period={period}
            activeBand={activeBand}
            bandMultiples={bandMultiples}
            focusDate={focusedRow.date}
            onFocusDate={handleFocusDate}
          />
        </div>
      </section>

      <section className="analysis-board" aria-label="Valuation details">
        <aside className="focus-panel" aria-label="Focused valuation readout">
          <div className="focus-head">
            <div>
              <span>{isLatestFocus ? 'Latest Focus' : 'Historical Focus'}</span>
              <h2>{toDisplayDate(focusedRow.date)}</h2>
            </div>
            <strong>{formatMultiple(focusedRow.pe)}</strong>
          </div>

          <div className={`distance-panel tone-${toneForValuationGap(focusBandDelta)}`}>
            <span>{focusStatusLabel}</span>
            <strong>{formatPercent(focusBandDeltaPercent)}</strong>
            <small>
              {formatIndex(focusBandDelta)} points vs {activeBand}x fair value
            </small>
          </div>

          <div
            className={`valuation-rail tone-${toneForValuationGap(focusBandDelta)}`}
            style={
              {
                '--spot-position': `${spotPosition}%`,
                '--band-position': `${bandPosition}%`,
                '--rail-left': `${railLeft}%`,
                '--rail-width': `${railWidth}%`,
              } as CSSProperties
            }
          >
            <div className="rail-track" aria-hidden="true">
              <span className="rail-range" />
              <span className="rail-marker is-spot" />
              <span className="rail-marker is-band" />
            </div>
            <div className="rail-labels">
              <span>
                <small>SPX</small>
                {formatIndex(focusedRow.spx)}
              </span>
              <span>
                <small>{activeBand}x Level</small>
                {formatIndex(focusBandLevel)}
              </span>
            </div>
          </div>
        </aside>

        <section className="metric-strip" aria-label="Latest valuation stats">
          <MetricItem
            icon={<TrendingUp aria-hidden="true" size={18} />}
            label="S&P 500"
            value={formatIndex(latest.spx)}
            detail={`${formatPercent(spxChange)} in view`}
            tone={toneForValue(spxChange)}
          />
          <MetricItem
            icon={<Gauge aria-hidden="true" size={18} />}
            label="Forward P/E"
            value={formatMultiple(latest.pe)}
            detail={`${decimalFormatter.format(peMin)}-${decimalFormatter.format(peMax)}x in view`}
          />
          <MetricItem
            icon={<Target aria-hidden="true" size={18} />}
            label="NTM EPS"
            value={formatMoney(latest.eps)}
            detail={`${formatPercent(epsChange)} in view`}
            tone={toneForValue(epsChange)}
          />
          <MetricItem
            icon={<CalendarDays aria-hidden="true" size={18} />}
            label="Data Freshness"
            value={toDisplayDate(dataFile.asOf)}
            detail={freshnessLabel}
          />
        </section>

        <div className="summary-grid">
          <Readout label="Start SPX" value={formatIndex(periodStart.spx)} />
          <Readout label="End SPX" value={formatIndex(latest.spx)} />
          <Readout label="Focus EPS" value={formatMoney(focusedRow.eps)} />
          <Readout label="Focus P/E" value={formatMultiple(focusedRow.pe)} />
          <Readout label="Low P/E" value={formatMultiple(peMin)} />
          <Readout label="High P/E" value={formatMultiple(peMax)} />
        </div>

        <div className="band-ladder" aria-label="Valuation band levels">
          <div className="ladder-title">
            <BarChart3 aria-hidden="true" size={17} />
            Focus Band Levels
          </div>
          <div className="ladder-buttons">
            {bandLevels.map(({ multiple, value, deltaPercent, color }) => (
              <button
                key={multiple}
                type="button"
                aria-pressed={activeBand === multiple}
                className={activeBand === multiple ? 'is-active' : ''}
                style={{ '--band-color': color } as CSSProperties}
                onClick={() => setRequestedActiveBand(multiple)}
              >
                <span>{multiple}x</span>
                <strong>{formatIndex(value)}</strong>
                <small>{formatPercent(deltaPercent)}</small>
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
            . Data generated {toDisplayDate(generatedDate)}; latest market row{' '}
            {toDisplayDate(dataFile.asOf)}.
          </p>
        </div>
        <p className="disclaimer">Educational research view only. Not investment advice.</p>
      </footer>
    </main>
  )
}

function MetricItem({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  tone?: Tone
}) {
  return (
    <div className="metric-item">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
      </div>
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
