import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, RotateCcw, ClipboardList, Send, Route, ArrowRight, CheckCircle2, Building2 } from 'lucide-react';
import type { DashboardSummary, SlaStatusBreach, SlaValleySplit } from '../services/orders.service';
import { ORDER_STATUS_LABELS } from '../utils/orderStatus';
import './NeedsAttention.css';

interface NeedsAttentionProps {
  sla: DashboardSummary['sla'];
  loading?: boolean;
}

type Tone = 'danger' | 'warning' | 'brand';

/** One separately clickable part of a row (e.g. the inside-valley half). */
interface ItemSide {
  key: string;
  label: string;
  count: number;
  details: SlaStatusBreach[];
}

interface Item {
  key: string;
  count: number;
  label: string;
  hint: string;
  to: string;
  tone: Tone;
  icon: React.ReactNode;
  /** Per-status split of `count`, shown under the hint. Empty for remarks,
   *  which aren't a parcel status and so have nothing to break down. */
  details?: SlaStatusBreach[];
  /** When set, the row is one box holding these parts, each its own link. */
  sides?: ItemSide[];
}

const detailText = (details: SlaStatusBreach[]) =>
  details
    .map((d) => `${d.count.toLocaleString()} past ${ORDER_STATUS_LABELS[d.status] || d.status}`)
    .join(' · ');

// Surfaces only SLA breaches — orders that have sat in a status longer than the
// hours configured on the SLA settings screen. Each row links to the screen
// where that work is cleared. Thresholds are managed at /sla (super admin).
const NeedsAttention: React.FC<NeedsAttentionProps> = ({ sla, loading = false }) => {
  // "past 24h SLA" when a threshold is configured, otherwise a generic label.
  const past = (hours: number | null, fallback: string) =>
    hours != null ? `past ${hours}h SLA` : fallback;

  // Delivery is split by the destination's valley, shown as two clickable parts
  // of one row: inside valley (both sides of the ring road) and outside valley
  // (every other destination). Only the parts with breaches are listed, and
  // without a split (e.g. a summary still in the server cache) the row stays a
  // single combined link. Pickup is deliberately NOT split - it is worked by
  // the origin branch's own riders, so one count is the whole story there.
  const valleySides = (key: string, split: SlaValleySplit | undefined): ItemSide[] | undefined =>
    split
      ? [
          { key: `${key}-inside`, label: 'Inside valley delivery', count: split.insideValley.count, details: split.insideValley.breaches },
          { key: `${key}-outside`, label: 'Outside valley delivery', count: split.outsideValley.count, details: split.outsideValley.breaches },
        ].filter((side) => side.count > 0)
      : undefined;

  const allItems: Item[] = [
    {
      key: 'pickups',
      count: sla.overduePickup,
      label: 'Pickup SLA breached',
      hint: past(sla.pickupHours, 'past pickup SLA'),
      to: '/pickup',
      tone: 'warning',
      icon: <ClipboardList size={18} />,
      details: sla.pickupBreaches,
    },
    {
      key: 'deliveries',
      count: sla.overdueDelivery,
      label: 'Delivery SLA breached',
      hint: past(sla.deliveryHours, 'past delivery SLA'),
      to: '/dispatch',
      tone: 'danger',
      icon: <Send size={18} />,
      details: sla.deliveryBreaches,
      sides: valleySides('deliveries', sla.deliveryByValley),
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
      // Not a parcel status: COD collected on delivered parcels that the branch
      // has not yet put on a settlement. Links to the branch COD screen where
      // the statement is raised.
      key: 'branch-cod',
      count: sla.overdueBranchCod,
      label: 'Branch COD SLA breached',
      hint: sla.branchCodHours != null
        ? `unsettled · ${sla.branchCodHours}h SLA · Rs. ${sla.overdueBranchCodAmount.toLocaleString()}`
        : `unsettled · Rs. ${sla.overdueBranchCodAmount.toLocaleString()}`,
      to: '/branches/billing?tab=branches',
      tone: 'danger',
      icon: <Building2 size={18} />,
    },
    {
      key: 'returns',
      count: sla.overdueReturn,
      label: 'Return SLA breached',
      hint: past(sla.returnHours, 'past return SLA'),
      to: '/return',
      tone: 'danger',
      icon: <RotateCcw size={18} />,
      details: sla.returnBreaches,
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
              {item.sides && item.sides.length > 0 ? (
                <div className="needs-attention-item">
                  <span className={`needs-attention-sev needs-attention-sev-${item.tone}`}>
                    {item.icon}
                  </span>
                  <span className="needs-attention-label">
                    {item.label}
                    <span className="needs-attention-sides">
                      {item.sides.map((side) => (
                        <Link
                          key={side.key}
                          to={item.to}
                          className="needs-attention-side"
                          aria-label={`${item.label}, ${side.label}: ${side.count} ${item.hint}`}
                        >
                          <span className="needs-attention-side-body">
                            <span className="needs-attention-side-title">{side.label}</span>
                            <span className="needs-attention-hint">{side.count.toLocaleString()} {item.hint}</span>
                            {side.details.length > 0 && (
                              <span className="needs-attention-detail">{detailText(side.details)}</span>
                            )}
                          </span>
                          <ArrowRight size={16} className="needs-attention-go" />
                        </Link>
                      ))}
                    </span>
                  </span>
                </div>
              ) : (
                <Link to={item.to} className="needs-attention-item">
                  <span className={`needs-attention-sev needs-attention-sev-${item.tone}`}>
                    {item.icon}
                  </span>
                  <span className="needs-attention-label">
                    {item.label}
                    <span className="needs-attention-hint">{item.count.toLocaleString()} {item.hint}</span>
                    {item.details && item.details.length > 0 && (
                      <span className="needs-attention-detail">{detailText(item.details)}</span>
                    )}
                  </span>
                  <ArrowRight size={16} className="needs-attention-go" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default NeedsAttention;
