import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { bannerImageUrl, getActiveBanners, type Banner } from '../../services/banners.service';
import '../Modal.css';
import './VendorNoticeBanner.css';

const MODAL_DISMISSED_KEY = 'pm-notice-dismissed-modal-ids';
const PERMANENT_DISMISSED_KEY = 'pm-notice-dismissed-permanent-ids';

function readDismissed(storage: Storage, key: string): Set<string> {
  try {
    const raw = storage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markDismissed(storage: Storage, key: string, id: string) {
  const dismissed = readDismissed(storage, key);
  dismissed.add(id);
  try {
    storage.setItem(key, JSON.stringify([...dismissed]));
  } catch {
    // Storage unavailable (private mode, quota) — the banner just reappears
    // next load, which is a fine fallback for a non-critical notice.
  }
}

const BannerArt: React.FC<{ banner: Banner; className: string }> = ({ banner, className }) => {
  const img = <img src={bannerImageUrl(banner.id, banner.imagePath)} alt={banner.name} className={className} />;
  return banner.linkUrl ? (
    <a href={banner.linkUrl} target="_blank" rel="noopener noreferrer" className="vendor-notice-link">
      {img}
    </a>
  ) : (
    img
  );
};

/**
 * The vendor's two notice surfaces, driven by one fetch: a `modal` banner
 * interrupts once per browser until dismissed (tracked in localStorage — no
 * "seen" state lives on the server, see banners.service.ts), and a
 * `permanent` banner stays visible inline for the rest of this tab session
 * once dismissed (sessionStorage), reappearing on the vendor's next visit.
 *
 * Renders nothing while loading, on a failed fetch, or when nothing is
 * active — a notice going missing must never take the dashboard down with it.
 */
const VendorNoticeBanner: React.FC = () => {
  const [permanent, setPermanent] = useState<Banner | null>(null);
  const [modal, setModal] = useState<Banner | null>(null);

  useEffect(() => {
    let active = true;
    getActiveBanners()
      .then(({ modal: modalBanner, permanent: permanentBanner }) => {
        if (!active) return;
        if (permanentBanner && !readDismissed(sessionStorage, PERMANENT_DISMISSED_KEY).has(permanentBanner.id)) {
          setPermanent(permanentBanner);
        }
        if (modalBanner && !readDismissed(localStorage, MODAL_DISMISSED_KEY).has(modalBanner.id)) {
          setModal(modalBanner);
        }
      })
      .catch(() => {
        // Non-fatal; the dashboard has its own job to do.
      });
    return () => {
      active = false;
    };
  }, []);

  const dismissPermanent = () => {
    if (!permanent) return;
    markDismissed(sessionStorage, PERMANENT_DISMISSED_KEY, permanent.id);
    setPermanent(null);
  };

  const dismissModal = () => {
    if (!modal) return;
    markDismissed(localStorage, MODAL_DISMISSED_KEY, modal.id);
    setModal(null);
  };

  return (
    <>
      {permanent && (
        <div className="vendor-notice-hero">
          <BannerArt banner={permanent} className="vendor-notice-hero-img" />
          <button
            type="button"
            className="vendor-notice-close"
            onClick={dismissPermanent}
            aria-label="Dismiss notice"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={dismissModal}>
          <div className="vendor-notice-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="vendor-notice-close"
              onClick={dismissModal}
              aria-label="Dismiss notice"
            >
              <X size={15} />
            </button>
            <BannerArt banner={modal} className="vendor-notice-modal-img" />
          </div>
        </div>
      )}
    </>
  );
};

export default VendorNoticeBanner;
