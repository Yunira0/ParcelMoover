import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, RotateCcw, ClipboardList, Send, Route, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { DashboardSummary } from '../services/orders.service';
import './NeedsAttention.css';

interface NeedsAttentionProps {
  sla: DashboardSummary['sla'];
  loading?: boolean;
}

type Tone = 'danger' | 'warning' | 'brand';

interface Item {
  key: string;
  count: number;
  label: string;
  hint: string;
  to: string;
  tone: Tone;
  icon: React.ReactNode;
}

// Surfaces only SLA breaches — orders that have sat in a status longer than the
// hours configured on the SLA settings screen. Each row links to the screen
// where that work is cleared. Thresholds are managed at /sla (super admin).
const NeedsAttention: React.FC<NeedsAttentionProps> = ({ sla, loading = false }) => {
  // "past 24h SLA" when a threshold is configured, otherwise a generic label.
  const past = (hours: number | null, fallback: string) =>
    hours != null ? `past ${hours}h SLA` : fallback;

  const allItems: Item[] = [
    {
      key: 'pickups',
      count: sla.overduePickup,
      label: 'Pickup SLA breached',
      hint: past(sla.pickupHours, 'past pickup SLA'),
      to: '/pickup',
      tone: 'warning',
      icon: <ClipboardList size={18} />,
    },
    {
      key: 'deliveries',
      count: sla.overdueDelivery,
      label: 'Delivery SLA breached',
      hint: past(sla.deliveryHours, 'past delivery SLA'),
      to: '/dispatch',
      tone: 'danger',
      icon: <Send size={18} />,
    },
    {
      key: 'transit',
      count: sla.overdueTransit,
      label: 'Transit SLA breached',
      hint: past(sla.transitHours, 'past transit SLA'),
      to: '/oov',
      tone: 'warning',
      icon: <Route size={18} />,
    },
    {
      key: 'remarks',
      count: sla.overdueRemarks,
      label: 'Remarks SLA breached',
      hint: sla.remarksHours != null ? `awaiting reply · ${sla.remarksHours}h SLA` : 'awaiting a reply',
      to: '/remarks',
      tone: 'brand',
      icon: <MessageSquare size={18} />,
    },
    {
      key: 'returns',
      count: sla.overdueReturn,
      label: 'Return SLA breached',
      hint: past(sla.returnHours, 'past return SLA'),
      to: '/return',
      tone: 'danger',
      icon: <RotateCcw size={18} />,
    },
  ];
  const items = allItems.filter((item) => item.count > 0);

  return (
    <section className="needs-attention" aria-label="Needs attention">
      <div className="needs-attention-header">
        <h3 className="section-title">Needs attention</h3>
      </div>

      {loading ? (
        <p className="needs-attention-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="needs-attention-clear">
          <CheckCircle2 size={18} /> Nothing needs attention right now.
        </p>
      ) : (
        <ul className="needs-attention-list">
          {items.map((item) => (
            <li key={item.key}>
              <Link to={item.to} className="needs-attention-item">
                <span className={`needs-attention-sev needs-attention-sev-${item.tone}`}>
                  {item.icon}
                </span>
                <span className="needs-attention-label">
                  {item.label}
                  <span className="needs-attention-hint">{item.count.toLocaleString()} {item.hint}</span>
                </span>
                <ArrowRight size={16} className="needs-attention-go" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default NeedsAttention;
