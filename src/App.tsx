import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  ExternalLink,
  TrendingUp,
} from 'lucide-react'
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import valuationData from './data/valuation-data.json'
import './App.css'

const BAND_MULTIPLES = [18, 19, 20, 21, 22, 23] as const
const DEFAULT_PERIOD = '18M'

const COLORS = {
  spx: '#4f8cff',
  ink: '#e7edf6',
  grid: 'rgba(148, 163, 184, 0.12)',
  bands: {
    18: '#ef5f67',
    19: '#f2c94c',
    20: '#00c805',
    21: '#f2994a',
    22: '#26c6da',
    23: '#8ab4f8',
  },
} as const

type BandMultiple = (typeof BAND_MULTIPLES)[number]

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
  bands: Record<BandMultiple, number>
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

function asLineData(rows: ChartDatum[], valueForRow: (row: ChartDatum) => number) {
  return rows.map((row) => ({ time: row.time, value: valueForRow(row) }))
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
  return Math.max(
    0,
    rows.findIndex((row) => row.date >= target),
  )
}

function nearestBand(pe: number) {
  return BAND_MULTIPLES.reduce((best, next) =>
    Math.abs(next - pe) < Math.abs(best - pe) ? next : best,
  )
}

function lineWidthForBand(pe: BandMultiple, activeBand: BandMultiple): 1 | 2 | 3 {
  if (pe === activeBand) {
    return 3
  }

  if (pe === 20 || pe === 21) {
    return 2
  }

  return 1
}

function normalizeRows(data: DataFile) {
  return data.rows.map((row) => ({
    ...row,
    time: row.date as Time,
    bands: BAND_MULTIPLES.reduce(
      (bands, multiple) => ({
        ...bands,
        [multiple]: row.eps * multiple,
      }),
      {} as Record<BandMultiple, number>,
    ),
  }))
}

type ValuationChartProps = {
  rows: ChartDatum[]
  period: PeriodOption
  selectedIndex: number
  activeBand: BandMultiple
  onSelectIndex: (index: number) => void
}

function ValuationChart({
  rows,
  period,
  selectedIndex,
  activeBand,
  onSelectIndex,
}: ValuationChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const spxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandSeriesRef = useRef<Map<BandMultiple, ISeriesApi<'Line'>>>(new Map())
  const indexByTime = useMemo(() => new Map(rows.map((row, index) => [String(row.time), index])), [rows])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1017' },
        textColor: '#a9b4c2',
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
        borderVisible: false,
        entireTextOnly: true,
        scaleMargins: {
          top: 0.08,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderVisible: false,
        rightOffset: 16,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(231, 237, 246, 0.34)',
          labelBackgroundColor: COLORS.ink,
          style: LineStyle.Solid,
          width: 1,
        },
        horzLine: {
          color: 'rgba(79, 140, 255, 0.55)',
          labelBackgroundColor: COLORS.spx,
          style: LineStyle.Dashed,
          width: 1,
        },
      },
      handleScroll: {
        horzTouchDrag: true,
        mouseWheel: true,
        pressedMouseMove: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisDoubleClickReset: true,
        axisPressedMouseMove: false,
        mouseWheel: true,
        pinch: true,
      },
    })

    chartRef.current = chart
    bandSeriesRef.current = new Map()

    BAND_MULTIPLES.forEach((multiple) => {
      const series = chart.addSeries(LineSeries, {
        color: COLORS.bands[multiple],
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        lineWidth: multiple === 20 || multiple === 21 ? 2 : 1,
        priceLineVisible: false,
        title: `${multiple}x`,
      })

      series.setData(asLineData(rows, (row) => row.bands[multiple]) as LineData[])
      bandSeriesRef.current.set(multiple, series)
    })

    const spxSeries = chart.addSeries(LineSeries, {
      color: COLORS.spx,
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerRadius: 5,
      lastValueVisible: false,
      lineWidth: 4,
      priceLineVisible: false,
      title: 'S&P 500',
    })

    spxSeries.setData(asLineData(rows, (row) => row.spx) as LineData[])
    spxSeriesRef.current = spxSeries

    const handleCrosshairMove = (params: MouseEventParams<Time>) => {
      if (!params.time) {
        return
      }

      const index = indexByTime.get(String(params.time))

      if (index !== undefined) {
        onSelectIndex(index)
      }
    }

    const selectFromCoordinate = (clientX: number) => {
      const { left } = container.getBoundingClientRect()
      const time = chart.timeScale().coordinateToTime(clientX - left)

      if (!time) {
        return
      }

      const index = indexByTime.get(String(time))

      if (index !== undefined) {
        onSelectIndex(index)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      selectFromCoordinate(event.clientX)
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches.item(0)

      if (touch) {
        selectFromCoordinate(touch.clientX)
      }
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)
    container.addEventListener('pointerdown', handlePointerMove)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('touchmove', handleTouchMove, { passive: true })

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect

      chart.applyOptions({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(320, Math.floor(height)),
      })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      container.removeEventListener('pointerdown', handlePointerMove)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('touchmove', handleTouchMove)
      chart.remove()
      chartRef.current = null
      spxSeriesRef.current = null
      bandSeriesRef.current = new Map()
    }
  }, [indexByTime, onSelectIndex, rows])

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
    const chart = chartRef.current
    const spxSeries = spxSeriesRef.current
    const row = rows[selectedIndex]

    if (!chart || !spxSeries || !row) {
      return
    }

    chart.setCrosshairPosition(row.spx, row.time, spxSeries)
  }, [rows, selectedIndex])

  useEffect(() => {
    bandSeriesRef.current.forEach((series, multiple) => {
      series.applyOptions({
        lineWidth: lineWidthForBand(multiple, activeBand),
      })
    })
  }, [activeBand])

  return <div ref={containerRef} className="chart-canvas" aria-label="S&P 500 valuation bands chart" />
}

function App() {
  const dataFile = valuationData as DataFile
  const rows = useMemo(() => normalizeRows(dataFile), [dataFile])
  const latestIndex = rows.length - 1
  const latest = rows[latestIndex]
  const [periodId, setPeriodId] = useState(DEFAULT_PERIOD)
  const [selectedIndex, setSelectedIndex] = useState(latestIndex)
  const [activeBand, setActiveBand] = useState<BandMultiple>(nearestBand(latest.pe))
  const period = PERIODS.find((option) => option.id === periodId) ?? PERIODS[0]
  const visibleStartIndex = getPeriodStartIndex(rows, period)
  const periodStart = rows[visibleStartIndex]
  const selected = rows[selectedIndex] ?? latest
  const selectedBandLevel = selected.bands[activeBand]
  const selectedDelta = selected.spx - selectedBandLevel
  const selectedDeltaPercent = (selectedDelta / selectedBandLevel) * 100
  const selectedNearestBand = nearestBand(selected.pe)
  const latestBandLevels = BAND_MULTIPLES.map((multiple) => ({
    multiple,
    value: latest.bands[multiple],
  })).reverse()
  const spxChange = ((latest.spx - periodStart.spx) / periodStart.spx) * 100
  const epsChange = ((latest.eps - periodStart.eps) / periodStart.eps) * 100

  const handlePeriodChange = (nextPeriod: string) => {
    setPeriodId(nextPeriod)
    setSelectedIndex(latestIndex)
  }

  const handleSelectIndex = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])

  return (
    <main className="app-shell">
      <header className="market-header" aria-labelledby="page-title">
        <div className="brand-row">
          <div>
            <span className="ticker-pill">SPX</span>
            <h1 id="page-title">Forward P/E Valuation Bands</h1>
          </div>
          <div className="as-of">As of {toDisplayDate(latest.date)}</div>
        </div>

        <div className="quote-strip" aria-label="Latest valuation stats">
          <QuoteItem label="S&P 500" value={formatIndex(latest.spx)} change={`${formatPercent(spxChange)} view`} />
          <QuoteItem label="NTM EPS" value={formatMoney(latest.eps)} change={`${formatPercent(epsChange)} view`} />
          <QuoteItem label="Forward P/E" value={`${decimalFormatter.format(latest.pe)}x`} change={`Nearest ${nearestBand(latest.pe)}x`} />
        </div>
      </header>

      <section className="chart-stage" aria-label="Interactive valuation chart">
        <div className="control-strip">
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
          <div className="range-note">
            {toMonth(periodStart.date)} to {toMonth(latest.date)}
          </div>
        </div>

        <div className="chart-grid">
          <div className="chart-wrap">
            <ValuationChart
              rows={rows}
              period={period}
              selectedIndex={selectedIndex}
              activeBand={activeBand}
              onSelectIndex={handleSelectIndex}
            />
          </div>

          <aside className="valuation-lens" aria-label="Valuation lens">
            <div className="lens-head">
              <div>
                <div className="lens-label">Valuation Lens</div>
                <h2>{toDisplayDate(selected.date)}</h2>
              </div>
              <div className={selectedDelta >= 0 ? 'lens-tag is-rich' : 'lens-tag is-cheap'}>
                {selectedDelta >= 0 ? 'Above' : 'Below'} {activeBand}x
              </div>
            </div>
            <div className="lens-grid">
              <Readout label="SPX" value={formatIndex(selected.spx)} />
              <Readout label="NTM EPS" value={formatMoney(selected.eps)} />
              <Readout label="Actual P/E" value={`${decimalFormatter.format(selected.pe)}x`} />
              <Readout label="Nearest" value={`${selectedNearestBand}x`} />
            </div>
            <div className="delta-panel">
              <div>
                <span>{activeBand}x band</span>
                <strong>{formatIndex(selectedBandLevel)}</strong>
              </div>
              <div className={selectedDelta >= 0 ? 'delta-positive' : 'delta-negative'}>
                {selectedDelta >= 0 ? '+' : ''}
                {formatIndex(selectedDelta)} / {formatPercent(selectedDeltaPercent)}
              </div>
            </div>
            <label className="scrubber">
              <span>Date Lens</span>
              <input
                type="range"
                min={visibleStartIndex}
                max={latestIndex}
                value={selectedIndex}
                aria-label="Date lens"
                onInput={(event) => setSelectedIndex(Number(event.currentTarget.value))}
                onChange={(event) => setSelectedIndex(Number(event.currentTarget.value))}
              />
            </label>
          </aside>
        </div>

        <div className="band-ladder" aria-label="Latest valuation band levels">
          <div className="ladder-title">
            <BarChart3 aria-hidden="true" size={18} />
            Latest Bands
          </div>
          <div className="ladder-buttons">
            {latestBandLevels.map(({ multiple, value }) => (
              <button
                key={multiple}
                type="button"
                aria-pressed={activeBand === multiple}
                className={activeBand === multiple ? 'is-active' : ''}
                style={{ '--band-color': COLORS.bands[multiple] } as React.CSSProperties}
                onClick={() => setActiveBand(multiple)}
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
            <TrendingUp aria-hidden="true" size={18} />
            Data and Formula
          </div>
          <p>
            Band level = NTM EPS estimate x P/E multiple. Source:{' '}
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

function QuoteItem({
  label,
  value,
  change,
}: {
  label: string
  value: string
  change: string
}) {
  return (
    <div className="quote-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{change}</small>
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
