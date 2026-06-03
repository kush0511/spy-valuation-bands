import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  ExternalLink,
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
  type Time,
} from 'lightweight-charts'
import valuationData from './data/valuation-data.json'
import './App.css'

const BAND_SLOT_COUNT = 6
const DEFAULT_PERIOD = '18M'
const BAND_ANIMATION_MS = 260

const COLORS = {
  spx: '#4f8cff',
  ink: '#e7edf6',
  grid: 'rgba(148, 163, 184, 0.10)',
  bands: ['#ef5f67', '#f2c94c', '#00c805', '#f2994a', '#26c6da', '#8ab4f8'],
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
  return Math.max(
    0,
    rows.findIndex((row) => row.date >= target),
  )
}

function nearestMultiple(pe: number) {
  return Math.max(1, Math.round(pe))
}

function adaptiveMultiples(pe: number) {
  const nearest = nearestMultiple(pe)
  const start = Math.max(1, nearest - 3)

  return Array.from({ length: BAND_SLOT_COUNT }, (_, index) => start + index)
}

function colorForSlot(index: number) {
  return COLORS.bands[Math.max(0, Math.min(index, COLORS.bands.length - 1))]
}

function colorForMultiple(multiple: number, multiples: number[]) {
  return colorForSlot(Math.max(0, multiples.indexOf(multiple)))
}

function lineWidthForBand(pe: number, activeBand: number): 1 | 2 | 3 {
  if (pe === activeBand) {
    return 3
  }

  if (Math.abs(pe - activeBand) === 1) {
    return 2
  }

  return 1
}

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3
}

function interpolateBandData(start: LineData[], target: LineData[], progress: number) {
  return target.map((point, index) => ({
    time: point.time,
    value: Number(start[index]?.value ?? point.value) + (point.value - Number(start[index]?.value ?? point.value)) * progress,
  }))
}

function normalizeRows(data: DataFile) {
  return data.rows.map((row) => ({
    ...row,
    time: row.date as Time,
  }))
}

type ValuationChartProps = {
  rows: ChartDatum[]
  period: PeriodOption
  selectedIndex: number
  activeBand: number
  bandMultiples: number[]
  onSelectIndex: (index: number) => void
}

function ValuationChart({
  rows,
  period,
  selectedIndex,
  activeBand,
  bandMultiples,
  onSelectIndex,
}: ValuationChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const spxSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bandSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const currentBandMultiplesRef = useRef<number[]>(bandMultiples)
  const initialBandMultiplesRef = useRef<number[]>(bandMultiples)
  const initialActiveBandRef = useRef<number>(activeBand)
  const renderedBandDataRef = useRef<LineData[][]>([])
  const animationFrameRef = useRef<number | null>(null)
  const indexByTime = useMemo(() => new Map(rows.map((row, index) => [String(row.time), index])), [rows])
  const bandMultiplesKey = bandMultiples.join(',')

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
        background: { type: ColorType.Solid, color: '#080d13' },
        textColor: '#a9b4c2',
        fontSize: container.clientWidth < 620 ? 11 : 12,
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
        rightOffset: container.clientWidth < 620 ? 4 : 14,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(231, 237, 246, 0.34)',
          labelBackgroundColor: COLORS.ink,
          labelVisible: false,
          style: LineStyle.Solid,
          width: 1,
        },
        horzLine: {
          color: 'rgba(79, 140, 255, 0.30)',
          labelBackgroundColor: COLORS.spx,
          labelVisible: false,
          style: LineStyle.Dashed,
          visible: false,
          width: 1,
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
    currentBandMultiplesRef.current = initialBandMultiplesRef.current

    initialBandMultiplesRef.current.forEach((multiple, index) => {
      const series = chart.addSeries(LineSeries, {
        color: colorForSlot(index),
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        lineWidth: lineWidthForBand(multiple, initialActiveBandRef.current),
        priceLineVisible: false,
        title: `${multiple}x`,
      })

      const data = bandDataForMultiple(rows, multiple)
      series.setData(data)
      renderedBandDataRef.current[index] = data
      bandSeriesRef.current[index] = series
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

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        return
      }

      selectFromCoordinate(event.clientX)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return
      }

      selectFromCoordinate(event.clientX)
    }

    container.addEventListener('pointerdown', handlePointerDown, { passive: true })
    container.addEventListener('pointermove', handlePointerMove, { passive: true })

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const compact = width < 620

      chart.applyOptions({
        width: Math.max(320, Math.floor(width)),
        height: Math.max(320, Math.floor(height)),
        layout: {
          fontSize: compact ? 11 : 12,
        },
        timeScale: {
          rightOffset: compact ? 4 : 14,
        },
      })

      spxSeriesRef.current?.applyOptions({
        lineWidth: compact ? 3 : 4,
      })
    })

    resizeObserver.observe(container)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      resizeObserver.disconnect()
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      chart.remove()
      chartRef.current = null
      spxSeriesRef.current = null
      bandSeriesRef.current = []
      renderedBandDataRef.current = []
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
    bandSeriesRef.current.forEach((series, index) => {
      const multiple = bandMultiples[index]

      if (!multiple) {
        return
      }

      series.applyOptions({
        color: colorForSlot(index),
        lineWidth: lineWidthForBand(multiple, activeBand),
        title: `${multiple}x`,
      })
    })
  }, [activeBand, bandMultiples, bandMultiplesKey])

  useEffect(() => {
    const series = bandSeriesRef.current

    if (series.length === 0) {
      return undefined
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const targetData = bandMultiples.map((multiple) => bandDataForMultiple(rows, multiple))
    const startData =
      renderedBandDataRef.current.length === targetData.length
        ? renderedBandDataRef.current
        : currentBandMultiplesRef.current.map((multiple) => bandDataForMultiple(rows, multiple))
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion) {
      targetData.forEach((data, index) => series[index]?.setData(data))
      renderedBandDataRef.current = targetData
      currentBandMultiplesRef.current = bandMultiples
      return undefined
    }

    const startedAt = performance.now()
    let lastFrameAt = 0

    const tick = (now: number) => {
      const elapsed = now - startedAt
      const progress = easeOutCubic(Math.min(1, elapsed / BAND_ANIMATION_MS))

      if (now - lastFrameAt > 24 || progress === 1) {
        const nextRenderedData = targetData.map((target, index) =>
          interpolateBandData(startData[index] ?? target, target, progress),
        )

        nextRenderedData.forEach((data, index) => series[index]?.setData(data))
        renderedBandDataRef.current = nextRenderedData
        lastFrameAt = now
      }

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(tick)
      } else {
        targetData.forEach((data, index) => series[index]?.setData(data))
        renderedBandDataRef.current = targetData
        currentBandMultiplesRef.current = bandMultiples
        animationFrameRef.current = null
      }
    }

    animationFrameRef.current = requestAnimationFrame(tick)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [bandMultiples, bandMultiplesKey, rows])

  return (
    <div className="chart-shell">
      <div className="chart-band-key" aria-label="Displayed valuation multiples">
        <span className="key-item key-spx">
          <span style={{ '--key-color': COLORS.spx } as React.CSSProperties} />
          S&P 500
        </span>
        {bandMultiples.map((multiple, index) => (
          <span
            key={multiple}
            className={activeBand === multiple ? 'key-item key-band is-active' : 'key-item key-band'}
          >
            <span style={{ '--key-color': colorForSlot(index) } as React.CSSProperties} />
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
  const latestIndex = rows.length - 1
  const latest = rows[latestIndex]
  const [periodId, setPeriodId] = useState(DEFAULT_PERIOD)
  const [selectedIndex, setSelectedIndex] = useState(latestIndex)
  const [requestedActiveBand, setRequestedActiveBand] = useState<number | null>(null)
  const period = PERIODS.find((option) => option.id === periodId) ?? PERIODS[0]
  const visibleStartIndex = getPeriodStartIndex(rows, period)
  const periodStart = rows[visibleStartIndex]
  const selected = rows[selectedIndex] ?? latest
  const selectedNearestBand = nearestMultiple(selected.pe)
  const bandMultiples = useMemo(() => adaptiveMultiples(selectedNearestBand), [selectedNearestBand])
  const activeBand =
    requestedActiveBand !== null && bandMultiples.includes(requestedActiveBand)
      ? requestedActiveBand
      : selectedNearestBand
  const selectedBandLevel = selected.eps * activeBand
  const selectedDelta = selected.spx - selectedBandLevel
  const selectedDeltaPercent = (selectedDelta / selectedBandLevel) * 100
  const bandLevels = bandMultiples.map((multiple) => ({
    multiple,
    value: selected.eps * multiple,
  })).reverse()
  const spxChange = ((latest.spx - periodStart.spx) / periodStart.spx) * 100
  const epsChange = ((latest.eps - periodStart.eps) / periodStart.eps) * 100
  const dateRangeLabel = `${toMonth(periodStart.date)} to ${toMonth(latest.date)}`

  const handlePeriodChange = (nextPeriod: string) => {
    setPeriodId(nextPeriod)
    setSelectedIndex(latestIndex)
    setRequestedActiveBand(null)
  }

  const handleSelectIndex = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])

  const handleDateLensChange = (index: number) => {
    setSelectedIndex(index)
  }

  return (
    <main className="app-shell">
      <header className="market-header" aria-labelledby="page-title">
        <div className="title-block">
          <div className="ticker-line">
            <span className="ticker-pill">SPX</span>
            <span className="as-of">As of {toDisplayDate(latest.date)}</span>
          </div>
          <h1 id="page-title">Forward P/E Valuation Bands</h1>
        </div>

        <div className="market-pulse" aria-label="Latest valuation stats">
          <div className="primary-quote">
            <span>S&P 500</span>
            <strong>{formatIndex(latest.spx)}</strong>
            <small>{formatPercent(spxChange)} view</small>
          </div>
          <div className="mini-metrics">
            <MetricItem
              label="Forward P/E"
              value={`${decimalFormatter.format(latest.pe)}x`}
              detail={`Nearest ${nearestMultiple(latest.pe)}x`}
            />
            <MetricItem label="NTM EPS" value={formatMoney(latest.eps)} detail={`${formatPercent(epsChange)} view`} />
          </div>
        </div>
      </header>

      <section className="chart-stage" aria-label="Interactive valuation chart">
        <div className="chart-toolbar">
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

        <div className="chart-grid">
          <div className="chart-wrap">
            <ValuationChart
              rows={rows}
              period={period}
              selectedIndex={selectedIndex}
              activeBand={activeBand}
              bandMultiples={bandMultiples}
              onSelectIndex={handleSelectIndex}
            />
            <label className="date-control">
              <span className="date-control-copy">
                <span>Date</span>
                <strong>{toDisplayDate(selected.date)}</strong>
              </span>
              <input
                type="range"
                min={visibleStartIndex}
                max={latestIndex}
                value={selectedIndex}
                aria-label="Date lens"
                onInput={(event) => handleDateLensChange(Number(event.currentTarget.value))}
                onChange={(event) => handleDateLensChange(Number(event.currentTarget.value))}
              />
            </label>
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
            <div className="lens-grid">
              <Readout label="SPX" value={formatIndex(selected.spx)} />
              <Readout label="NTM EPS" value={formatMoney(selected.eps)} />
              <Readout label="Actual P/E" value={`${decimalFormatter.format(selected.pe)}x`} />
              <Readout label="Nearest" value={`${selectedNearestBand}x`} />
            </div>
          </aside>
        </div>

        <div className="band-ladder" aria-label="Active valuation band levels">
          <div className="ladder-title">
            <BarChart3 aria-hidden="true" size={18} />
            Active Bands
          </div>
          <div className="ladder-buttons">
            {bandLevels.map(({ multiple, value }) => (
              <button
                key={multiple}
                type="button"
                aria-pressed={activeBand === multiple}
                className={activeBand === multiple ? 'is-active' : ''}
                style={{ '--band-color': colorForMultiple(multiple, bandMultiples) } as React.CSSProperties}
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
            <Activity aria-hidden="true" size={18} />
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
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="market-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
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
