import React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import './StatCard.css';

/** Money has a direction, and the figure should read as positive or negative at
 *  a glance rather than only after the label is read. */
export type StatCardTone = 'default' | 'positive' | 'negative' | 'muted';

interface StatCardProps {
  /** Omit on cards that sit in a dense row of figures, where a column of icons
   *  is noise rather than a cue (the accounting summaries). */
  icon?: LucideIcon;
  label: string;
  value: string | number;
  /** One line under the figure explaining what it is counting. */
  hint?: React.ReactNode;
  tone?: StatCardTone;
  /** When set, the card becomes a link to the page holding the detail behind the number. */
  to?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon: Icon, label, value, hint, tone = 'default', to }) => {
  const content = (
    <>
      {Icon && (
        <div className="stat-icon-wrapper">
          <Icon className="stat-icon" size={24} />
        </div>
      )}
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className={`stat-value${tone === 'default' ? '' : ` stat-value-${tone}`}`}>{value}</span>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className="stat-card stat-card-link" aria-label={`${label}: ${value} — view details`}>
        {content}
      </Link>
    );
  }

  return <div className="stat-card">{content}</div>;
};

export default StatCard;
