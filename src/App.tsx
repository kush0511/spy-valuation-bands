import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  ExternalLink,
  Activity,
} from "lucide-react";
import {
  ColorType,
  CrosshairMode,
  TickMarkType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import data from "./data/valuation-data.json";
import {
  ageInDays,
  MULTIPLES,
  PERIODS,
  periodStart,
  type Datum,
  type Period,
} from "./lib/valuation";
import "./App.css";

const rows: Datum[] = data.rows;
const latest = rows[rows.length - 1];
const rowIndex = new Map(rows.map((row, index) => [row.date, index]));
const COLORS = [
  "#779a9a",
  "#78b5aa",
  "#b6c78e",
  "#d6b17a",
  "#b396b8",
  "#889fc6",
];
const num = (n: number, digits = 0) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${num(n, 1)}%`;
const change = (a: number, b: number) => (a / b - 1) * 100;
const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function timeKey(time: Time) {
  return typeof time === "string"
    ? time
    : typeof time === "number"
      ? new Date(time * 1000).toISOString().slice(0, 10)
      : `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function Chart({
  start,
  activeBand,
  selectedIndex,
  onInspect,
}: {
  start: number;
  activeBand: number;
  selectedIndex: number | null;
  onInspect: (index: number | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bandsRef = useRef<ISeriesApi<"Line">[]>([]);
  const spotRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Create the canvas once. Inspection and scenario selection never replace it.
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#111d25" },
        textColor: "#94a5af",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#22313a" } },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 60,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
        minBarSpacing: 0.001,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const date = new Date(`${timeKey(time)}T00:00:00Z`);
          if (type === TickMarkType.Year) return String(date.getUTCFullYear());
          return date.toLocaleDateString("en-US", {
            month: "short",
            ...(type === TickMarkType.Month ? {} : { day: "numeric" }),
            timeZone: "UTC",
          });
        },
      },
      localization: { priceFormatter: (value: number) => num(value) },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { visible: false, labelVisible: false },
        vertLine: { color: "#72858e", labelBackgroundColor: "#30434c" },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    bandsRef.current = MULTIPLES.map((multiple, i) => {
      const series = chart.addSeries(LineSeries, {
        color: COLORS[i],
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(
        rows.map((row) => ({
          time: row.date as Time,
          value: row.eps * multiple,
        })),
      );
      return series;
    });
    const spot = chart.addSeries(LineSeries, {
      color: "#edf3ef",
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerRadius: 4,
    });
    spot.setData(
      rows.map((row) => ({ time: row.date as Time, value: row.spx })),
    );
    spotRef.current = spot;
    const inspect = (event: { time?: Time }) => {
      const key = event.time ? timeKey(event.time) : null;
      onInspect(key ? (rowIndex.get(key) ?? null) : null);
    };
    chart.subscribeCrosshairMove(inspect);
    const describeRange = (range: { from: Time; to: Time } | null) => {
      if (range)
        container.current?.setAttribute(
          "aria-description",
          `Visible dates: ${timeKey(range.from)} to ${timeKey(range.to)}`,
        );
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(describeRange);
    return () => {
      chart.unsubscribeCrosshairMove(inspect);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(describeRange);
      chart.remove();
      chartRef.current = null;
      spotRef.current = null;
      bandsRef.current = [];
    };
  }, [onInspect]);

  useEffect(() => {
    chartRef.current?.timeScale().setVisibleRange({
      from: rows[start].date as Time,
      to: latest.date as Time,
    });
  }, [start]);

  useEffect(() => {
    bandsRef.current.forEach((series, i) =>
      series.applyOptions({
        color: `${COLORS[i]}${MULTIPLES[i] === activeBand ? "ff" : "88"}`,
        lineWidth: MULTIPLES[i] === activeBand ? 2 : 1,
      }),
    );
  }, [activeBand]);

  useEffect(() => {
    if (selectedIndex === null) chartRef.current?.clearCrosshairPosition();
    else if (spotRef.current) {
      const row = rows[selectedIndex];
      chartRef.current?.setCrosshairPosition(
        row.spx,
        row.date as Time,
        spotRef.current,
      );
    }
  }, [selectedIndex]);

  return (
    <div
      className="chart-canvas"
      ref={container}
      role="img"
      aria-label="S&P 500 index and forward earnings valuation bands. Use the date slider below to inspect values without a pointer."
    />
  );
}

function App() {
  const [period, setPeriod] = useState<Period>("1Y");
  const [activeBand, setActiveBand] = useState(20);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const start = useMemo(() => periodStart(rows, period), [period]);
  const focusIndex = Math.max(
    start,
    hoverIndex ?? selectedIndex ?? rows.length - 1,
  );
  const focused = rows[focusIndex];
  const first = rows[start];
  const age = ageInDays(latest.date, now);
  const stale = age > 4;
  const level = focused.eps * activeBand;
  const gap = change(focused.spx, level);
  const inspect = useCallback(
    (index: number | null) => setHoverIndex(index),
    [],
  );
  const rangeStats = useMemo(() => {
    const values = rows.slice(start).map((row) => row.pe);
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [start]);
  const selectDate = (index: number) => {
    setHoverIndex(null);
    setSelectedIndex(index);
  };

  return (
    <main className="desk">
      <header className="masthead">
        <a href="./" className="brand" aria-label="SPX valuation desk home">
          <span className="brand-mark">
            <Activity size={21} />
          </span>
          <span>
            MARKET / <b>RESEARCH</b>
          </span>
        </a>
        <div className={`data-status ${stale ? "is-stale" : ""}`}>
          <span />
          {stale
            ? `Data delayed · ${age} days old`
            : `Market data · ${dateLabel(latest.date)}`}
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">S&P 500 · FORWARD EARNINGS</p>
          <h1>S&P 500 valuation</h1>
          <p className="intro-copy">
            Price in the context of forward earnings.
          </p>
        </div>
        <span className="instrument">
          SPX <ArrowUpRight size={19} />
        </span>
      </section>

      {stale && (
        <div className="stale-notice" role="status">
          The latest available market row is {dateLabel(latest.date)}. This
          snapshot is {age} calendar days old; the refresh or source may be
          delayed.
        </div>
      )}

      <section className="metrics" aria-label="Latest market snapshot">
        <div className="metric">
          <span>S&P 500 INDEX</span>
          <strong>{num(latest.spx, 2)}</strong>
          <small
            className={
              change(latest.spx, first.spx) >= 0 ? "positive" : "negative"
            }
          >
            {pct(change(latest.spx, first.spx))}
            <em> over selected range</em>
          </small>
        </div>
        <div className="metric">
          <span>FORWARD P/E</span>
          <strong>
            {num(latest.pe, 2)}
            <i>×</i>
          </strong>
          <small>
            {num(rangeStats.min, 1)}–{num(rangeStats.max, 1)}×<em> range</em>
          </small>
        </div>
        <div className="metric">
          <span>NTM EPS</span>
          <strong>
            <i>$</i>
            {num(latest.eps, 2)}
          </strong>
          <small
            className={
              change(latest.eps, first.eps) >= 0 ? "positive" : "negative"
            }
          >
            {pct(change(latest.eps, first.eps))}
            <em> over selected range</em>
          </small>
        </div>
        <div className="metric snapshot">
          <span>LATEST OBSERVATION</span>
          <strong>{dateLabel(latest.date)}</strong>
          <small>
            {age === 0 ? "Today" : `${age} calendar days ago`}
            <em> · daily data</em>
          </small>
        </div>
      </section>

      <section className="workspace" aria-label="Valuation explorer">
        <div className="plot-panel">
          <div className="chart-heading">
            <div>
              <h2>Price & valuation bands</h2>
              <p>Index level at a given forward P/E</p>
            </div>
            <span className="chart-unit">INDEX POINTS</span>
          </div>
          <div className="chart-toolbar">
            <div className="periods" role="group" aria-label="Chart timeframe">
              {PERIODS.map((option) => (
                <button
                  key={option}
                  aria-pressed={period === option}
                  onClick={() => {
                    setPeriod(option);
                    setSelectedIndex(null);
                    setHoverIndex(null);
                  }}
                >
                  {option === "ALL" ? "All" : option}
                </button>
              ))}
            </div>
            <span className="range-label">
              {dateLabel(first.date)} — {dateLabel(latest.date)}
            </span>
          </div>
          <div className="legend">
            <span className="spot-key">
              <i />
              S&P 500
            </span>
            {MULTIPLES.map((multiple, index) => (
              <button
                key={multiple}
                style={{ "--band": COLORS[index] } as CSSProperties}
                aria-label={`Highlight ${multiple} times earnings`}
                aria-pressed={activeBand === multiple}
                onClick={() => setActiveBand(multiple)}
              >
                <i />
                {multiple}×
              </button>
            ))}
          </div>
          <Chart
            start={start}
            activeBand={activeBand}
            selectedIndex={selectedIndex}
            onInspect={inspect}
          />
          <div className="date-scrubber">
            <div className="scrubber-caption">
              <label htmlFor="date-slider">
                Explore a date <span>· {dateLabel(focused.date)}</span>
              </label>
              <button
                className="latest-button"
                onClick={() => {
                  setSelectedIndex(null);
                  setHoverIndex(null);
                }}
                disabled={selectedIndex === null && hoverIndex === null}
              >
                <RotateCcw size={13} /> Latest
              </button>
            </div>
            <div className="scrubber-track">
              <button
                aria-label="Previous observation"
                disabled={focusIndex <= start}
                onClick={() => selectDate(focusIndex - 1)}
              >
                <ArrowLeft size={15} />
              </button>
              <input
                id="date-slider"
                type="range"
                min={start}
                max={rows.length - 1}
                value={focusIndex}
                aria-valuetext={`${dateLabel(focused.date)}, S&P 500 ${num(focused.spx, 2)}, forward P/E ${num(focused.pe, 2)}`}
                onChange={(event) => selectDate(Number(event.target.value))}
              />
              <button
                aria-label="Next observation"
                disabled={focusIndex >= rows.length - 1}
                onClick={() => selectDate(focusIndex + 1)}
              >
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <aside className="inspector" aria-label="Selected date valuation">
          <div className="inspector-heading">
            <p className="eyebrow">
              {focusIndex === rows.length - 1
                ? "LATEST OBSERVATION"
                : "HISTORICAL OBSERVATION"}
            </p>
            <h2>{dateLabel(focused.date)}</h2>
            <div className="observation">
              <span>
                SPX <b>{num(focused.spx, 2)}</b>
              </span>
              <span>
                P/E <b>{num(focused.pe, 2)}×</b>
              </span>
            </div>
          </div>
          <div className="scenario">
            <span className="eyebrow">AT {activeBand}× FORWARD EARNINGS</span>
            <strong>{num(level)}</strong>
            <p>
              The index is{" "}
              <b>
                {num(Math.abs(gap), 1)}% {gap >= 0 ? "above" : "below"}
              </b>{" "}
              this level.
            </p>
            <span className="scenario-formula">
              ${num(focused.eps, 2)} EPS × {activeBand}
            </span>
          </div>
          <div className="ladder">
            <div className="ladder-heading">
              <h3>Compare multiples</h3>
              <span>vs. index</span>
            </div>
            {MULTIPLES.map((multiple, index) => (
              <button
                key={multiple}
                aria-pressed={activeBand === multiple}
                onClick={() => setActiveBand(multiple)}
                style={{ "--band": COLORS[index] } as CSSProperties}
              >
                <span>
                  <i />
                  {multiple}×
                </span>
                <b>{num(focused.eps * multiple)}</b>
                <small>
                  {pct(change(focused.eps * multiple, focused.spx))}
                </small>
              </button>
            ))}
          </div>
          <p className="inspector-note">
            Each band is an earnings scenario, not a price target. Select a
            multiple to highlight it on the chart.
          </p>
        </aside>
      </section>

      <footer>
        <div>
          <span className="eyebrow">READING THE CHART</span>
          <p>
            Band level = next-twelve-month EPS × P/E multiple. The white line is
            the S&P 500 index; the colored lines hold each multiple constant as
            earnings estimates change.
          </p>
        </div>
        <div>
          <a href={data.source.url} target="_blank" rel="noreferrer">
            StreetStats data <ExternalLink size={12} />
          </a>
          <p>
            Fetched {dateLabel(data.generatedAt.slice(0, 10))}. Market
            observation {dateLabel(latest.date)}. Educational use only.
          </p>
        </div>
      </footer>
    </main>
  );
}
export default App;
