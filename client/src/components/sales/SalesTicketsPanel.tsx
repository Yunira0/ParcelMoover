import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTickets } from '../../services/tickets.service';
import './SalesTicketsPanel.css';

const SalesTicketsPanel: React.FC = () => {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ open: 0, pending: 0, closed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      getTickets({ status: 'open', pageSize: 1 }),
      getTickets({ status: 'pending', pageSize: 1 }),
      getTickets({ status: 'closed', pageSize: 1 }),
    ])
      .then(([open, pending, closed]) => {
        if (!active) return;
        setCounts({
          open: open.meta?.total ?? 0,
          pending: pending.meta?.total ?? 0,
          closed: closed.meta?.total ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const display = (v: number) => (loading ? '—' : v.toLocaleString());

  const rows: { label: string; value: string; tone: 'warning' | 'info' | 'success' }[] = [
    { label: 'Open', value: display(counts.open), tone: 'warning' },
    { label: 'Pending', value: display(counts.pending), tone: 'info' },
    { label: 'Closed', value: display(counts.closed), tone: 'success' },
  ];

  return (
    <div className="sales-tickets-panel">
      <div className="sales-tickets-panel-header">
        <span className="sales-tickets-panel-title">Ticket Queue</span>
        <button type="button" className="sales-tickets-panel-link" onClick={() => navigate('/tickets')}>
          View all
        </button>
      </div>
      <div className="sales-tickets-panel-rows">
        {rows.map(({ label, value, tone }) => (
          <div key={label} className="sales-tickets-panel-row">
            <span className="sales-tickets-panel-label">{label}</span>
            <span className={`sales-tickets-panel-value sales-tickets-panel-value--${tone}`}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SalesTicketsPanel;
