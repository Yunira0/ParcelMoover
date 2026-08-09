import React from 'react';
import { CheckCircle2, X } from 'lucide-react';
import './ConfirmBanner.css';

interface ConfirmBannerProps {
  title: string;
  meta?: string;
  onDismiss?: () => void;
}

// A scoped, on-page acknowledgment for a money-moving action that just
// completed (payment recorded, settlement reverted/cancelled) - reuses the
// visual language SettlementPayPage already built for its "payment recorded"
// step rather than introducing a global toast system the app doesn't have.
const ConfirmBanner: React.FC<ConfirmBannerProps> = ({ title, meta, onDismiss }) => (
  <div className="confirm-banner" role="status">
    <span className="confirm-banner-badge">
      <CheckCircle2 size={20} />
    </span>
    <div className="confirm-banner-text">
      <div className="confirm-banner-title">{title}</div>
      {meta && <div className="confirm-banner-meta">{meta}</div>}
    </div>
    {onDismiss && (
      <button type="button" className="confirm-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <X size={15} />
      </button>
    )}
  </div>
);

export default ConfirmBanner;
