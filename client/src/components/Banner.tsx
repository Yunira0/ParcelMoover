import React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import './Banner.css';

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

const BANNER_ICON = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
  success: CheckCircle2,
} as const;

/**
 * An explanatory or error note above the thing it applies to.
 *
 * Lives in components/ because it is not an accounting idea. It started as a
 * helper inside pages/accounting/ui.tsx and ended up being imported by the
 * vendor COD screens, which is a page's stylesheet quietly becoming a shared
 * primitive — the sort of thing that makes a vendor-side restyle change an
 * admin screen.
 *
 * `danger` is announced to screen readers; the other tones are context the
 * reader will reach on their way down the page, and interrupting for those
 * would make the useful announcement easier to ignore.
 */
const Banner: React.FC<{ tone: BannerTone; children: React.ReactNode }> = ({ tone, children }) => {
  const Icon = BANNER_ICON[tone];
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={16} />
      <span>{children}</span>
    </div>
  );
};

export default Banner;
