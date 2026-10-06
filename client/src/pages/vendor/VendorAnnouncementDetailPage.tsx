import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Phone, Globe, HelpCircle } from 'lucide-react';
import { toBsDateLabel } from '../../utils/nepaliDate';
import { PHONE_DISPLAY, PHONE_TEL } from '../../constants/contact';
import { getActiveAnnouncement, type Announcement } from '../../services/announcements.service';
import './VendorAnnouncementDetailPage.css';

// Same brand URL printed on shipping labels (see utils/printLabels.ts) — kept
// in sync there rather than duplicated as a constant, since this is the only
// other place it appears.
const PORTAL_URL = 'portal.parcelmoover.com';

/**
 * A single announcement rendered as a full official notice page (not a
 * modal or a narrow card): a ParcelMoover letterhead up top, the notice
 * itself, and a closing contact block — the kind of thing a vendor might
 * screenshot or reopen later, not a quick glance-and-dismiss.
 */
const VendorAnnouncementDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    getActiveAnnouncement(id)
      .then(setAnnouncement)
      .catch(() => setError('Failed to load this announcement.'))
      .finally(() => setLoading(false));
  }, [id]);

  const posted = announcement ? toBsDateLabel(announcement.createdAt) : '';
  const updated = announcement ? toBsDateLabel(announcement.updatedAt) : '';
  const showUpdated = announcement && updated !== posted;

  return (
    <div className="vandp-page">
      <button type="button" className="vandp-back" onClick={() => navigate('/vendor/announcements')}>
        <ArrowLeft size={16} /> Back to Announcements
      </button>

      <div className="vandp-notice">
        <div className="vandp-letterhead">
          <img src="/brand/logo-icon.png" alt="" className="vandp-letterhead-mark" />
          <span className="vandp-letterhead-word">
            Parcel<span className="vandp-letterhead-accent">Moover</span>
          </span>
        </div>

        {loading ? (
          <p className="vandp-muted">Loading announcement…</p>
        ) : error ? (
          <p className="vandp-error">{error}</p>
        ) : !announcement ? (
          <p className="vandp-muted">This announcement is no longer available.</p>
        ) : (
          <>
            <div className="vandp-content">
              <h1 className="vandp-title">{announcement.title}</h1>
              <div className="vandp-meta">
                <span>Posted: {posted}</span>
                {showUpdated && <span>Updated: {updated}</span>}
              </div>
              <p className="vandp-body">{announcement.body}</p>
            </div>

            <div className="vandp-footer">
              <div className="vandp-footer-contact">
                <a href={PHONE_TEL} className="vandp-footer-item">
                  <Phone size={14} /> {PHONE_DISPLAY}
                </a>
                <span className="vandp-footer-item">
                  <Globe size={14} /> {PORTAL_URL}
                </span>
              </div>
              <Link to="/tickets" className="vandp-footer-help">
                <HelpCircle size={14} /> Need help with this? Raise a ticket
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VendorAnnouncementDetailPage;
