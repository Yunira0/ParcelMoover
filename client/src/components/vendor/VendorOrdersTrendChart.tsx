import React from 'react';
import type { DashboardTrendDay } from '../../services/orders.service';
import './VendorOrdersTrendChart.css';

interface VendorOrdersTrendChartProps {
  data: DashboardTrendDay[];
  loading?: boolean;
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 200;
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
  { key: 'totalOrders', label: 'Total Orders', lineClass: 'vendor-orders-trend-chart-line-total', dotClass: 'vendor-orders-trend-chart-dot-total' },
  { key: 'delivered', label: 'Delivered', lineClass: 'vendor-orders-trend-chart-line-delivered', dotClass: 'vendor-orders-trend-chart-dot-delivered' },
  { key: 'returned', label: 'Returned', lineClass: 'vendor-orders-trend-chart-line-returned', dotClass: 'vendor-orders-trend-chart-dot-returned' },
] as const;

const VendorOrdersTrendChart: React.FC<VendorOrdersTrendChartProps> = ({ data, loading = false }) => {
  const plotWidth = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const maxValue = niceMax(Math.max(1, ...data.flatMap((d) => SERIES.map((s) => d[s.key]))));

  const xFor = (index: number) =>
    data.length > 1
      ? PADDING_LEFT + (index / (data.length - 1)) * plotWidth
      : PADDING_LEFT + plotWidth / 2;
  const yFor = (value: number) => PADDING_TOP + plotHeight - (value / maxValue) * plotHeight;

  const toPoints = (key: (typeof SERIES)[number]['key']) =>
    data.map((d, index) => `${xFor(index)},${yFor(d[key])}`).join(' ');

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => Math.round((maxValue / TICK_COUNT) * i));

  return (
    <div className="vendor-orders-trend-chart">
      <div className="vendor-orders-trend-chart-header">
        <h3 className="section-title">Orders Trend</h3>
        <div className="vendor-orders-trend-chart-legend">
          {SERIES.map((s) => (
            <span key={s.key} className="vendor-orders-trend-chart-legend-item">
              <span className={`vendor-orders-trend-chart-legend-dot ${s.dotClass}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {loading || data.length === 0 ? (
        <div className="vendor-orders-trend-chart-empty">{loading ? 'Loading...' : 'No data yet'}</div>
      ) : (
        <svg
          className="vendor-orders-trend-chart-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
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

          {SERIES.map((s) => (
            <polyline key={s.key} points={toPoints(s.key)} className={s.lineClass} />
          ))}

          {data.map((d, index) => (
            <g key={d.date}>
              {SERIES.map((s) => (
                <circle key={s.key} cx={xFor(index)} cy={yFor(d[s.key])} r={3} className={s.dotClass} />
              ))}
              <text x={xFor(index)} y={CHART_HEIGHT - 6} className="vendor-orders-trend-chart-day" textAnchor="middle">
                {d.day.toLowerCase()}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};

export default VendorOrdersTrendChart;
