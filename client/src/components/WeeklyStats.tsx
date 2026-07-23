import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Info, Calendar } from 'lucide-react';
import type { DashboardTrendDay } from '../services/orders.service';
import { toBsDate, toBsDateLabel } from '../utils/nepaliDate';
import './WeeklyStats.css';

interface WeeklyStatsProps {
  data: DashboardTrendDay[];
  loading: boolean;
  period: 7 | 30;
  onPeriodChange: (period: 7 | 30) => void;
}

type FilterKey = 'all' | 'total' | 'picked' | 'delivered' | 'returned';

interface SeriesDef {
  key: FilterKey;
  label: string;
  dataKey: 'totalOrders' | 'pickedUp' | 'delivered' | 'returned';
  color: string;
  dotClass: string;
}

// Colors reuse the same status tokens CODSettlement uses (success/warning/
// info) rather than one-off hex values, so "green means delivered" reads the
// same way across the app. SVG presentation attributes resolve CSS custom
// properties same as any other CSS value.
const SERIES: SeriesDef[] = [
  { key: 'total', label: 'Total Order', dataKey: 'totalOrders', color: 'var(--color-background-warning-default)', dotClass: 'total' },
  { key: 'picked', label: 'Picked Up', dataKey: 'pickedUp', color: 'var(--color-info-text)', dotClass: 'picked' },
  { key: 'delivered', label: 'Delivered', dataKey: 'delivered', color: 'var(--color-success-default)', dotClass: 'delivered' },
  { key: 'returned', label: 'Returned', dataKey: 'returned', color: 'var(--color-danger-default)', dotClass: 'returned' },
];

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'total', label: 'Order' },
  { key: 'picked', label: 'Pickup' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'returned', label: 'Returned' },
];

// Fallback used before the container has been measured (SSR / first paint).
const DEFAULT_W = 700;
const DEFAULT_H = 300;
const PAD = { top: 16, right: 12, bottom: 24, left: 34 };

// Round the top of the y-axis up to a readable step (5/10/20/50/100...) so
// gridlines land on whole numbers instead of an arbitrary max-value fraction.
function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const residual = value / magnitude;
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return step * magnitude;
}

const formatDayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return { dow: '', md: '' };
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    // BS month/day for the axis tick (e.g. "04/06"), falling back to empty.
    md: (toBsDate(d).slice(5) || '').replace('-', '/'),
  };
};

const formatRangeLabel = (data: DashboardTrendDay[]) => {
  if (data.length === 0) return '';
  const start = new Date(data[0]!.date);
  const end = new Date(data[data.length - 1]!.date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${toBsDateLabel(start)} - ${toBsDateLabel(end)}`;
};

const WeeklyStats: React.FC<WeeklyStatsProps> = ({ data, loading, period, onPeriodChange }) => {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Drive the SVG viewBox off the container's real pixel size so it maps 1:1 to
  // the rendered box. A fixed viewBox stretched with preserveAspectRatio="none"
  // distorted everything non-uniformly - oval dots, uneven line thickness,
  // squished axis numbers - because the card is far wider/taller than 700x260.
  const chartRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const CHART_W = size.w;
  const CHART_H = size.h;

  const visibleSeries = activeFilter === 'all' ? SERIES : SERIES.filter((s) => s.key === activeFilter);

  // Scaled to whichever series are actually on screen, not the full set - a
  // single-series filter (e.g. "Delivered") used to keep the axis pinned to
  // Total Order's much larger scale, flattening the isolated line to an
  // unreadable sliver at the bottom of the chart.
  const yMax = useMemo(() => {
    const maxVal = Math.max(1, ...data.flatMap((d) => visibleSeries.map((s) => d[s.dataKey])));
    return niceCeiling(maxVal);
  }, [data, visibleSeries]);

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const n = data.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const xAt = (i: number) => PAD.left + (n > 1 ? i * xStep : innerW / 2);
  const yAt = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const linePath = (dataKey: SeriesDef['dataKey']) =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(d[dataKey])}`).join(' ');

  // Show every tick for 7 days; thin out to ~6 labels for 30 to avoid collisions.
  const labelStride = n <= 10 ? 1 : Math.ceil(n / 6);

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipLeftPct = hoverIndex !== null ? (xAt(hoverIndex) / CHART_W) * 100 : 0;
  const tooltipFlip = tooltipLeftPct > 65;

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const idx = n > 1 ? Math.round((relX - PAD.left) / xStep) : 0;
    setHoverIndex(Math.min(n - 1, Math.max(0, idx)));
  };

  return (
    <div className="weekly-stats">
      <div className="weekly-stats-header">
        <div className="title-with-info">
          <h3>Weekly Stats</h3>
          <button type="button" className="info-trigger" aria-label="About this chart" aria-describedby="weekly-stats-info">
            <Info size={16} />
            <span className="info-tooltip" role="tooltip" id="weekly-stats-info">
              Order volume by day for the selected range. Use the filters below to isolate a single
              stage - the chart rescales to that stage's own numbers.
            </span>
          </button>
        </div>

        <div className="stats-controls">
          <div className="period-tabs">
            <button
              className={`period-tab ${period === 7 ? 'active' : ''}`}
              onClick={() => onPeriodChange(7)}
              disabled={loading}
            >
              7D
            </button>
            <button
              className={`period-tab ${period === 30 ? 'active' : ''}`}
              onClick={() => onPeriodChange(30)}
              disabled={loading}
            >
              30D
            </button>
          </div>

          <div className="date-picker">
            <span>{formatRangeLabel(data) || '—'}</span>
            <Calendar size={16} style={{ color: 'var(--color-text-caption)' }} />
          </div>
        </div>
      </div>

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-tab ${activeFilter === f.key ? 'active' : ''}`}
            onClick={() => setActiveFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="legend">
        {SERIES.map((s) => (
          <div
            key={s.key}
            className={`legend-item ${activeFilter !== 'all' && activeFilter !== s.key ? 'legend-item-dim' : ''}`}
          >
            <span className={`legend-dot ${s.dotClass}`}></span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="graph-placeholder">
        <div className="chart-area" ref={chartRef}>
          {loading && data.length === 0 ? (
            <div className="chart-loading">Loading chart…</div>
          ) : n === 0 ? (
            <div className="chart-loading">No data for this range.</div>
          ) : (
            <>
              <svg
                className="chart-svg"
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                role="img"
                aria-label="Weekly order trend chart"
              >
                {gridLines.map((g) => {
                  const y = PAD.top + innerH - g * innerH;
                  return (
                    <g key={g}>
                      <line
                        x1={PAD.left}
                        x2={CHART_W - PAD.right}
                        y1={y}
                        y2={y}
                        className="chart-gridline"
                      />
                      <text x={PAD.left - 6} y={y} className="chart-axis-label" textAnchor="end" dy="3">
                        {Math.round(g * yMax)}
                      </text>
                    </g>
                  );
                })}

                {hoverIndex !== null && (
                  <line
                    x1={xAt(hoverIndex)}
                    x2={xAt(hoverIndex)}
                    y1={PAD.top}
                    y2={CHART_H - PAD.bottom}
                    className="chart-crosshair"
                  />
                )}

                {/* Always render every series and toggle visibility with a class
                    (same pattern as the legend's dim state) rather than adding/
                    removing SVG nodes - lets the filter change crossfade instead
                    of snapping the line in and out. */}
                {SERIES.map((s) => (
                  <path
                    key={s.key}
                    d={linePath(s.dataKey)}
                    className={`chart-line ${visibleSeries.includes(s) ? '' : 'chart-line-hidden'}`}
                    stroke={s.color}
                  />
                ))}

                {SERIES.map((s) =>
                  data.map((d, i) => (
                    <circle
                      key={`${s.key}-${i}`}
                      cx={xAt(i)}
                      cy={yAt(d[s.dataKey])}
                      r={hoverIndex === i ? 4 : 2.5}
                      fill={s.color}
                      className={`chart-point ${visibleSeries.includes(s) ? '' : 'chart-point-hidden'}`}
                    />
                  )),
                )}

                <rect
                  x={PAD.left}
                  y={PAD.top}
                  width={innerW}
                  height={innerH}
                  fill="transparent"
                  pointerEvents="all"
                  onMouseMove={handleMove}
                  onMouseLeave={() => setHoverIndex(null)}
                />
              </svg>

              {hovered && (
                <div
                  className="chart-tooltip"
                  style={{
                    left: `${tooltipLeftPct}%`,
                    transform: tooltipFlip ? 'translateX(-100%)' : 'none',
                  }}
                >
                  <div className="chart-tooltip-date">
                    {new Date(hovered.date).toLocaleDateString('en-US', { weekday: 'short' })}
                    {', '}
                    {toBsDateLabel(hovered.date)}
                  </div>
                  {visibleSeries.map((s) => (
                    <div key={s.key} className="chart-tooltip-row">
                      <span className={`legend-dot ${s.dotClass}`}></span>
                      <span className="chart-tooltip-label">{s.label}</span>
                      <span className="chart-tooltip-value">{hovered[s.dataKey].toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="chart-labels">
          {data.map((d, i) => {
            const show = i % labelStride === 0 || i === n - 1;
            const { dow, md } = show ? formatDayLabel(d.date) : { dow: '', md: '' };
            return (
              <div className="chart-label" key={d.date}>
                <span>{dow}</span>
                <span>{md}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WeeklyStats;
