import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Lock, LockOpen } from 'lucide-react';
import StatusChip, { type StatusChipTone } from '../../components/StatusChip';
import './Accounting.css';

// The chips and banners every Finance screen repeats, expressed once against the
// design system. Each tab was hand-rolling its own badge markup; these are all
// <StatusChip> underneath, so a posted entry looks like every other success
// state in the app. Figure formatting lives beside this in ./format.

const ENTRY_STATUS_TONE: Record<string, StatusChipTone> = {
  posted: 'success',
  recorded: 'success',
  voided: 'danger',
};

/** A journal entry or expense: posted/recorded, or voided. */
export const EntryStatusChip: React.FC<{ status: string }> = ({ status }) => (
  <StatusChip tone={ENTRY_STATUS_TONE[status] ?? 'neutral'}>{status}</StatusChip>
);

/** An accounting period: open for hand-written entries, or closed. */
export const PeriodStatusChip: React.FC<{ status: string }> = ({ status }) => (
  <StatusChip tone={status === 'closed' ? 'neutral' : 'info'}>
    {status === 'closed' ? <Lock size={11} /> : <LockOpen size={11} />}
    <span style={{ marginLeft: 4 }}>{status}</span>
  </StatusChip>
);

/** Rider / Vendor / Staff, next to a person's name. */
export const PartyChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <StatusChip tone="info">{children}</StatusChip>
);

const BANNER_ICON = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
  success: CheckCircle2,
} as const;

/** An explanatory or error note above the figures it applies to. */
export const Banner: React.FC<{
  tone: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const Icon = BANNER_ICON[tone];
  return (
    <div className={`acc-banner acc-banner-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} />
      <span>{children}</span>
    </div>
  );
};
