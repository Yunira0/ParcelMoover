import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isVendorSide } from '../utils/auth';
import {
  getActiveVendorNotices,
  dismissVendorNotice,
  type VendorNoticeWithDismissed,
} from '../services/vendorNotices.service';
import './VendorNoticePopup.css';

// Fetches on every mount of DashboardLayout - i.e. every fresh portal open
// (login, reopening in a new tab), not on every in-app navigation, since
// DashboardLayout stays mounted across route changes within one SPA session.
// A plain refresh (F5) also remounts DashboardLayout but must NOT re-show the
// banner, so a sessionStorage flag (scoped to this browser tab, cleared when
// the tab closes) gates the fetch: set once per tab, surviving reloads, but
// absent again in a brand-new tab. Whether a notice reappears *across*
// sessions is driven by the server's persisted `dismissed` flag (see
// vendor_notice_dismissals) - a vendor who hasn't dismissed a notice still
// sees it the next time they open the portal in a fresh tab.
const SESSION_SEEN_KEY = 'vendorNoticePopupSeen';

const VendorNoticePopup: React.FC = () => {
  const [notices, setNotices] = useState<VendorNoticeWithDismissed[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!isVendorSide()) return;

    if (sessionStorage.getItem(SESSION_SEEN_KEY)) {
      setLoading(false);
      return;
    }
    sessionStorage.setItem(SESSION_SEEN_KEY, '1');

    let cancelled = false;

    (async () => {
      try {
        const res = await getActiveVendorNotices();
        if (cancelled) return;
        if (res?.success && res.data?.length) {
          setNotices(res.data.filter((n) => !n.dismissed));
        }
      } catch {
        // Silent — popup is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const currentNotice = notices[currentIndex];

  const handleDismiss = async () => {
    if (!currentNotice || dismissing) return;

    if (currentNotice.isDismissable) {
      setDismissing(true);
      try {
        await dismissVendorNotice(currentNotice.id);
      } catch {
        // Still advance even if API fails — don't block the user
      } finally {
        setDismissing(false);
      }
    }

    if (currentIndex < notices.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setNotices([]);
    }
  };

  // Don't render if not vendor, loading, or no notices
  if (loading || !currentNotice) return null;

  return (
    <div className="vnp-overlay" onClick={currentNotice.isDismissable ? handleDismiss : undefined}>
      <div className="vnp-card" onClick={(e) => e.stopPropagation()}>
        <img className="vnp-banner" src={currentNotice.imageUrl} alt={currentNotice.title} />

        {currentNotice.isDismissable && (
          <button
            className="vnp-close"
            onClick={handleDismiss}
            disabled={dismissing}
            aria-label="Dismiss notice"
          >
            <X size={16} />
          </button>
        )}

        {notices.length > 1 && (
          <span className="vnp-counter">{currentIndex + 1} / {notices.length}</span>
        )}
      </div>
    </div>
  );
};

export default VendorNoticePopup;
