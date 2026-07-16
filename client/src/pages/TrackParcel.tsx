import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, MapPin, ArrowRight, AlertCircle, PackageSearch } from 'lucide-react';
import TrackSearchBox from '../components/TrackSearchBox';
import StatusChip from '../components/StatusChip';
import { trackParcelPublic, type PublicTracking } from '../services/orders.service';
import { getPublicStatusLabel, getPublicStatusTone } from '../utils/publicParcelStatus';
import './TrackParcel.css';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

const SERVICE_LABELS: Record<string, string> = {
  home_delivery: 'Home Delivery',
  branch_delivery: 'Branch Delivery',
};

const TrackParcel: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>(trackingId ? 'loading' : 'idle');
  const [data, setData] = useState<PublicTracking | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Adjust state during render (not in the effect below) when the tracking ID
  // in the URL changes - including clearing back to none. This is the
  // React-recommended way to reset state off a changing prop without an extra
  // render pass; see https://react.dev/learn/you-might-not-need-an-effect
  const [trackedFor, setTrackedFor] = useState(trackingId);
  if (trackingId !== trackedFor) {
    setTrackedFor(trackingId);
    setState(trackingId ? 'loading' : 'idle');
    setData(null);
    setErrorMessage('');
  }

  useEffect(() => {
    if (!trackingId) return;

    let cancelled = false;

    trackParcelPublic(trackingId)
      .then((response) => {
        if (cancelled) return;
        setData(response.data);
        setState('success');
      })
      .catch((error) => {
        if (cancelled) return;
        const status = error?.response?.status;
        if (status === 429) {
          setErrorMessage('Too many attempts. Please wait a minute and try again.');
        } else if (status === 400) {
          setErrorMessage("That doesn't look like a valid tracking ID. Double-check and try again.");
        } else if (status === 404) {
          setErrorMessage("We couldn't find a parcel with that tracking ID.");
        } else {
          setErrorMessage('Something went wrong while looking that up. Please try again.');
        }
        setData(null);
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [trackingId]);

  return (
    <div className="track-page">
      <section className="track-page-header">
        <h1>Track your parcel</h1>
        <p>Enter the tracking ID from your receipt or SMS to see where it is right now.</p>
        <TrackSearchBox variant="page" initialValue={trackingId || ''} className="track-page-search" />
      </section>

      <section className="track-page-result">
        {state === 'idle' && (
          <div className="track-empty">
            <PackageSearch size={40} strokeWidth={1.5} />
            <p>Your parcel's status and timeline will show up here.</p>
          </div>
        )}

        {state === 'loading' && (
          <div className="track-loading" aria-live="polite" aria-busy="true">
            <div className="track-skeleton-line track-skeleton-wide" />
            <div className="track-skeleton-line track-skeleton-narrow" />
            <div className="track-skeleton-block" />
          </div>
        )}

        {state === 'error' && (
          <div className="track-error" role="alert">
            <AlertCircle size={28} strokeWidth={1.5} />
            <p>{errorMessage}</p>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/track')}>
              Try another ID
            </button>
          </div>
        )}

        {state === 'success' && data && (
          <div className="track-result">
            <div className="track-result-summary">
              <div className="track-result-id">
                <Package size={18} />
                <span>{data.trackingId}</span>
              </div>
              <StatusChip tone={getPublicStatusTone(data.status)} variant="solid">
                {getPublicStatusLabel(data.status)}
              </StatusChip>
            </div>

            <div className="track-result-route">
              <div className="track-result-place">
                <span className="track-result-place-label">From</span>
                <span className="track-result-place-value">{data.origin || 'Not specified'}</span>
              </div>
              <ArrowRight size={16} className="track-result-route-arrow" aria-hidden="true" />
              <div className="track-result-place">
                <span className="track-result-place-label">To</span>
                <span className="track-result-place-value">{data.destination || 'Not specified'}</span>
              </div>
            </div>

            <dl className="track-result-meta">
              <div>
                <dt>Service</dt>
                <dd>{SERVICE_LABELS[data.serviceType] || data.serviceType}</dd>
              </div>
              <div>
                <dt>Pieces</dt>
                <dd>{data.pieces}</dd>
              </div>
              <div>
                <dt>Booked</dt>
                <dd>{data.createdAt}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{data.lastUpdatedAt}</dd>
              </div>
            </dl>

            <ol className="track-timeline">
              {data.statusHistory.map((entry, index) => (
                <li key={`${entry.status}-${entry.createdAt}-${index}`} className={index === 0 ? 'is-latest' : ''}>
                  <span className="track-timeline-dot" aria-hidden="true" />
                  <div className="track-timeline-body">
                    <span className="track-timeline-status">{getPublicStatusLabel(entry.status)}</span>
                    <span className="track-timeline-meta">
                      {entry.location && (
                        <>
                          <MapPin size={12} /> {entry.location} ·{' '}
                        </>
                      )}
                      {entry.createdAt}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </div>
  );
};

export default TrackParcel;
