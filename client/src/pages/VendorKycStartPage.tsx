import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, Files, ListChecks } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Banner from '../components/Banner';
import Button from '../components/Button';
import KycVerificationForm, { type KycVerificationFiles, type KycVerificationValues } from '../components/KycVerificationForm';
import { getVerificationPrefill, startVendorKycVerification, type VerificationPrefill } from '../services/kyc.service';
import { apiErrorMessage } from '../utils/serverValidation';
import './VendorKycStartPage.css';

// Starts KYC verification for one vendor as a full page, not a popup: the
// form is long enough to deserve its own scroll and headline, and success
// lands directly in the pending queue for review.
const VendorKycStartPage: React.FC = () => {
  const { id: vendorId } = useParams();
  const navigate = useNavigate();
  const [prefill, setPrefill] = useState<VerificationPrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!vendorId) return;
    let active = true;
    getVerificationPrefill(vendorId)
      .then(data => { if (active) { setPrefill(data); setError(''); } })
      .catch(err => { if (active) setError(apiErrorMessage(err, 'Could not load this vendor.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [vendorId]);

  async function submit(values: KycVerificationValues, files: KycVerificationFiles) {
    if (!vendorId) return;
    setSubmitting(true);
    setFormError('');
    try {
      await startVendorKycVerification(vendorId, values, {
        citizenshipDoc: files.citizenship,
        panVatDoc: files.panVat,
        businessCertDoc: files.businessCert,
      });
      navigate('/vendors?tab=kyc');
    } catch (err) {
      setFormError(apiErrorMessage(err, 'Could not start verification.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!vendorId) {
    return (
      <div className="kyc-start-page">
        <PageHeader title="Start KYC verification" subtitle="No vendor selected." onBack={() => navigate('/vendors')} />
        <Link to="/vendors">Back to vendors</Link>
      </div>
    );
  }

  return (
    <div className="kyc-start-page">
      <PageHeader
        title="Start KYC verification"
        subtitle={
          prefill
            ? `${prefill.profile.onlineBusinessName} · Review the on-file details, fill the gaps, and submit.`
            : 'Loading vendor details…'
        }
        onBack={() => navigate('/vendors')}
      />

      {loading && (
        <div className="kyc-start-loading" aria-busy="true" aria-label="Loading vendor details">
          <div className="kyc-surface" aria-hidden="true">
            <div className="kyc-skeleton kyc-skeleton-line" />
            <div className="kyc-skeleton kyc-skeleton-block" />
            <div className="kyc-skeleton kyc-skeleton-block kyc-skeleton-short" />
          </div>
          <div className="kyc-surface" aria-hidden="true">
            <div className="kyc-skeleton kyc-skeleton-line" />
            <div className="kyc-skeleton kyc-skeleton-block kyc-skeleton-short" />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="kyc-surface kyc-state-card">
          <Banner tone="danger">{error}</Banner>
          <div className="kyc-state-actions">
            <Button variant="secondary" onClick={() => navigate('/vendors')}>Back to vendors</Button>
          </div>
        </div>
      )}

      {!loading && !error && prefill && (prefill.hasApprovedKyc || prefill.pendingApplication) && (
        <section className="kyc-surface kyc-state-card" aria-label="Verification state">
          <Banner tone={prefill.hasApprovedKyc ? 'success' : 'warning'}>
            {prefill.hasApprovedKyc
              ? 'This vendor is already KYC verified — nothing to start.'
              : 'This vendor already has a verification under review.'}
          </Banner>
          <p className="kyc-state-text">
            <Link to="/vendors?tab=kyc">Open KYC Applications</Link> to review it.
          </p>
          <div className="kyc-state-actions">
            <Button variant="secondary" onClick={() => navigate('/vendors')}>Back to vendors</Button>
          </div>
        </section>
      )}

      {!loading && !error && prefill && !prefill.hasApprovedKyc && !prefill.pendingApplication && (
        <div className="kyc-start-layout">
          <section className="kyc-surface" aria-label="Verification form">
            <KycVerificationForm
              initial={prefill.profile}
              docsOnFile={prefill.docsOnFile}
              emailLocked={false}
              submitting={submitting}
              error={formError}
              submitLabel="Start verification"
              onSubmit={(values, files) => void submit(values, files)}
              onCancel={() => navigate('/vendors')}
            />
          </section>

          <aside className="kyc-start-aside" aria-label="Vendor summary">
            <section className="kyc-surface kyc-aside-card" aria-label="Vendor on file">
              <h2 className="kyc-aside-title"><Building2 size={16} aria-hidden="true" /> Vendor on file</h2>
              <dl className="kyc-aside-facts">
                <div><dt>Business</dt><dd>{prefill.profile.onlineBusinessName || '—'}</dd></div>
                <div><dt>Contact</dt><dd>{prefill.profile.businessContact || '—'}</dd></div>
                <div><dt>Pickup</dt><dd>{prefill.profile.pickupLocation || '—'}</dd></div>
                <div><dt>Owner</dt><dd>{prefill.profile.ownerName || '—'}</dd></div>
              </dl>
            </section>

            <section className="kyc-surface kyc-aside-card" aria-label="Documents on file">
              <h2 className="kyc-aside-title"><Files size={16} aria-hidden="true" /> Documents on file</h2>
              <ul className="kyc-doc-list">
                <li>
                  <span className={`kyc-doc-dot${prefill.docsOnFile.citizenship ? ' is-on-file' : ''}`} aria-hidden="true" />
                  <span>Citizenship</span>
                  <span className="kyc-doc-status">{prefill.docsOnFile.citizenship ? 'On file' : 'Required'}</span>
                </li>
                <li>
                  <span className={`kyc-doc-dot${prefill.docsOnFile.panVat ? ' is-on-file' : ''}`} aria-hidden="true" />
                  <span>PAN / VAT</span>
                  <span className="kyc-doc-status">{prefill.docsOnFile.panVat ? 'On file' : 'Not on file'}</span>
                </li>
                <li>
                  <span className={`kyc-doc-dot${prefill.docsOnFile.businessCert ? ' is-on-file' : ''}`} aria-hidden="true" />
                  <span>Business certificate</span>
                  <span className="kyc-doc-status">{prefill.docsOnFile.businessCert ? 'On file' : 'Not on file'}</span>
                </li>
              </ul>
              <p className="kyc-aside-hint">Uploading a file replaces the on-file copy.</p>
            </section>

            <section className="kyc-surface kyc-aside-card" aria-label="What happens next">
              <h2 className="kyc-aside-title"><ListChecks size={16} aria-hidden="true" /> What happens next</h2>
              <ol className="kyc-next-list">
                <li>Submit sends this to the <strong>KYC Applications</strong> queue.</li>
                <li>A reviewer approves or rejects it.</li>
                <li>Approval unlocks vouchers and payouts.</li>
              </ol>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
};

export default VendorKycStartPage;
