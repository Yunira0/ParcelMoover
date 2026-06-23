import React from 'react';
import { Info, Calendar } from 'lucide-react';
import './WeeklyStats.css';

const WeeklyStats: React.FC = () => {
  return (
    <div className="weekly-stats">
      <div className="weekly-stats-header">
        <div className="title-with-info">
          <h3>Weekly Stats</h3>
          <Info size={16} style={{ color: 'var(--color-text-caption)' }} />
        </div>
        
        <div className="stats-controls">
          <div className="period-tabs">
            <button className="period-tab active">7D</button>
            <button className="period-tab">30D</button>
          </div>
          
          <div className="date-picker">
            <span>20 May - 26 May, 2026</span>
            <Calendar size={16} style={{ color: 'var(--color-text-caption)' }} />
          </div>
        </div>
      </div>
      
      <div className="filter-tabs">
        <button className="filter-tab active">All</button>
        <button className="filter-tab">Order</button>
        <button className="filter-tab">Pickup</button>
        <button className="filter-tab">Delivered</button>
        <button className="filter-tab">Returned</button>
      </div>
      
      <div className="legend">
        <div className="legend-item">
          <span className="legend-dot total"></span>
          <span>Total Order</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot picked"></span>
          <span>Picked Up</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot delivered"></span>
          <span>Delivered</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot returned"></span>
          <span>Returned</span>
        </div>
      </div>
      
      <div className="graph-placeholder">
        {/* Graphs and bargraphs left blank as requested */}
        <div className="empty-chart-area">
          {/* Chart would go here */}
        </div>
        
        <div className="chart-labels">
          <div className="chart-label"><span>SUN</span><span>02-04</span></div>
          <div className="chart-label"><span>MON</span><span>02-05</span></div>
          <div className="chart-label"><span>TUE</span><span>02-06</span></div>
          <div className="chart-label"><span>WED</span><span>02-07</span></div>
          <div className="chart-label"><span>THU</span><span>02-08</span></div>
          <div className="chart-label"><span>FRI</span><span>02-09</span></div>
          <div className="chart-label"><span>SAT</span><span>02-10</span></div>
        </div>
      </div>
    </div>
  );
};

export default WeeklyStats;
