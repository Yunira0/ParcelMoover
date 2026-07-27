import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DashboardTrendDay } from '../../services/orders.service';
import './VendorOrdersTrendChart.css';

interface VendorOrdersTrendChartProps {
  data: DashboardTrendDay[];
  loading?: boolean;
}

// Fallback used before the body has been measured (SSR / first paint).
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 200;
const PADDING_LEFT = 28;
const PADDING_RIGHT = 8;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 24;
const TICK_COUNT = 4;

const niceMax = (value: number) => {
  if (value <= 0) return TICK_COUNT;
  const step = Math.ceil(value / TICK_COUNT);
  return step * TICK_COUNT;
};

// The three series plotted, in draw order. Total Orders is the widest scale, so
// it also anchors the y-axis; Delivered/Returned read against it.
const SERIES = [
  { key: 'totalOrders', label: 'Total Orders', barClass: 'vendor-orders-trend-chart-bar-total' },
  { key: 'delivered', label: 'Delivered', barClass: 'vendor-orders-trend-chart-bar-delivered' },
  { key: 'returned', label: 'Returned', barClass: 'vendor-orders-trend-chart-bar-returned' },
] as const;

const DAY_FULL: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

const VendorOrdersTrendChart: React.FC<VendorOrdersTrendChartProps> = ({ data, loading = false }) => {
  // Size the viewBox off the body's real pixels so it maps 1:1 to the rendered
  // box. A fixed viewBox stretched with preserveAspectRatio="none" distorted
  // everything non-uniformly - oval dots, uneven line thickness, stretched tick
  // numbers - because the column is wider than 320px.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const CHART_WIDTH = size.w;
  const CHART_HEIGHT = size.h;
  const plotWidth = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const maxValue = niceMax(Math.max(1, ...data.flatMap((d) => SERIES.map((s) => d[s.key]))));

  const slotW = data.length > 0 ? plotWidth / data.length : 0;
  const xFor = (index: number) => PADDING_LEFT + slotW / 2 + index * slotW;
  const yFor = (value: number) => PADDING_TOP + plotHeight - (value / maxValue) * plotHeight;

  const sortedData = useMemo(() =>
    [...data].sort((a, b) => new Date(a.date).getDay() - new Date(b.date).getDay()),
  [data]);

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => Math.round((maxValue / TICK_COUNT) * i));

  return (
    <div className="vendor-orders-trend-chart">
      <div className="vendor-orders-trend-chart-header">
        <h3 className="section-title">Orders Trend</h3>
        <div className="vendor-orders-trend-chart-legend">
          {SERIES.map((s) => (
            <span key={s.key} className="vendor-orders-trend-chart-legend-item">
              <span className={`vendor-orders-trend-chart-legend-dot ${s.barClass}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="vendor-orders-trend-chart-body" ref={bodyRef}>
      {loading || data.length === 0 ? (
        <div className="vendor-orders-trend-chart-empty">{loading ? 'Loading...' : 'No data yet'}</div>
      ) : (
        <svg
          className="vendor-orders-trend-chart-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING_LEFT}
                x2={CHART_WIDTH - PADDING_RIGHT}
                y1={yFor(tick)}
                y2={yFor(tick)}
                className="vendor-orders-trend-chart-grid"
              />
              <text x={PADDING_LEFT - 6} y={yFor(tick) + 3} className="vendor-orders-trend-chart-tick" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}

          {sortedData.map((d, index) => {
            const cx = xFor(index);
            const nVis = SERIES.length;
            const singleBarW = nVis > 0 ? slotW * 0.7 / nVis : 0;
            const totalBarsW = singleBarW * nVis;
            return SERIES.map((s, si) => {
              const val = d[s.key];
              const barH = (val / maxValue) * plotHeight;
              const barY = PADDING_TOP + plotHeight - barH;
              return (
                <rect
                  key={`${s.key}-${index}`}
                  x={cx - totalBarsW / 2 + si * singleBarW}
                  y={barY}
                  width={singleBarW}
                  height={barH}
                  className={`${s.barClass}`}
                  rx={2}
                />
              );
            });
          })}

          {sortedData.map((d, index) => (
            <text key={`label-${index}`} x={xFor(index)} y={CHART_HEIGHT - 6} className="vendor-orders-trend-chart-day" textAnchor="middle">
              {DAY_FULL[d.day.toLowerCase()] || d.day}
            </text>
          ))}
        </svg>
      )}
      </div>
    </div>
  );
};

export default VendorOrdersTrendChart;
