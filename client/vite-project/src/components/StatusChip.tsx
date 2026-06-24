import React from 'react';
import './StatusChip.css';

export type StatusChipTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';
export type StatusChipVariant = 'outline' | 'solid';

interface StatusChipProps {
  tone: StatusChipTone;
  /** "outline" = thin currentColor border, sentence-case (order/dispatch/return statuses). "solid" = bold uppercase pill, no border (settlement/active status). */
  variant?: StatusChipVariant;
  className?: string;
  children: React.ReactNode;
}

const StatusChip: React.FC<StatusChipProps> = ({ tone, variant = 'outline', className, children }) => (
  <span className={`status-chip status-chip-${variant} status-chip-${tone}${className ? ` ${className}` : ''}`}>
    {children}
  </span>
);

export default StatusChip;
