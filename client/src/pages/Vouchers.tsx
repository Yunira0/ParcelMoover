import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Banner from '../components/Banner';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import FormField from '../components/FormField';
import Pagination from '../components/Pagination';
import Table from '../components/Table';
import KycVerificationForm, { type KycVerificationFiles, type KycVerificationValues } from '../components/KycVerificationForm';
import VoucherPromo from '../components/VoucherPromo';
import VoucherTermsFields, { defaultVoucherTerms, deriveHiddenTerms, expiryIso } from '../components/vouchers/VoucherTermsFields';
import CampaignDirectory from '../components/vouchers/CampaignDirectory';
import CampaignDetail from '../components/vouchers/CampaignDetail';
import CampaignWizard from '../components/vouchers/CampaignWizard';
import { getCurrentUserRoles } from '../utils/auth';
import { formatCurrency } from '../utils/format';
import { toBsDate } from '../utils/nepaliDate';
import { apiErrorMessage, extractServerFieldErrors } from '../utils/serverValidation';
import {
  claimVoucher, createVoucher, listCampaigns, listMyVouchers, listVouchers, setCampaignStatus, setVoucherActive,
  voucherBenefit,
  type AvailableVoucher, type MyVoucher, type VoucherCampaign, type VoucherOffer,
} from '../services/voucher.service';
import { getMyKycStatus, submitMyKycVerification, type VerificationPrefill } from '../services/kyc.service';
import { downloadVoucherPng, printVoucher } from '../utils/voucherImage';
import '../components/Modal.css';
import './vendor/VendorFinance.css';
import './Vouchers.css';

const isOfferList = (v: unknown): v is { data: VoucherOffer[]; totalPages: number; total: number } =>
  !!v && typeof v === 'object' && 'data' in (v as object) && Array.isArray((v as { data: unknown }).data);

/** Claim lifecycle states mapped onto the design-system chip tones (solid variant at the call sites). */
const CLAIM_TONE: Record<string, StatusChipTone> = {
  claimed: 'success',
  reserved: 'warning',
  used: 'neutral',
};
const claimTone = (state: string): StatusChipTone => CLAIM_TONE[state] ?? 'neutral';

export default function Vouchers() {
  const admin = getCurrentUserRoles().includes('super_admin');
  const [offers, setOffers] = useState<VoucherOffer[]>([]);
  const [available, setAvailable] = useState<AvailableVoucher[]>([]);
  const [mine, setMine] = useState<MyVoucher[]>([]);
  const [kycPrefill, setKycPrefill] = useState<VerificationPrefill | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Claim by code (a scanned slip can prefill it via ?code=)
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(() => (searchParams.get('code') ?? '').toUpperCase().slice(0, 32));
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');

  // Vendor self-service verification — same manually filled form as the
  // staff modal, with the owner email locked to the account.
  const [kycOpen, setKycOpen] = useState(false);
  const [kycSubmitting, setKycSubmitting] = useState(false);
  const [kycFormError, setKycFormError] = useState('');

  async function submitKycVerification(values: KycVerificationValues, files: KycVerificationFiles) {
    setKycSubmitting(true);
    setKycFormError('');
    setNotice('');
    try {
      await submitMyKycVerification(values, {
        citizenshipDoc: files.citizenship,
        panVatDoc: files.panVat,
        businessCertDoc: files.businessCert,
      });
      setKycOpen(false);
      setNotice('KYC verification submitted — our team reviews it shortly.');
      setRevision(v => v + 1);
    } catch (err) {
      setKycFormError(apiErrorMessage(err, 'Could not submit verification.'));
    } finally {
      setKycSubmitting(false);
    }
  }

  // Admin create form
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // The API answers a bad publish with a generic "Validation failed" plus a
  // per-field list. Showing only the former left no way to tell what was wrong.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Campaign directory (bulk-code campaigns for print handouts)
  const [adminView, setAdminView] = useState<'campaigns' | 'standalone'>('campaigns');
  const [campaigns, setCampaigns] = useState<VoucherCampaign[]>([]);
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignTotalPages, setCampaignTotalPages] = useState(1);
  const [campaignTotal, setCampaignTotal] = useState(0);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState('');
  const [campaignRevision, setCampaignRevision] = useState(0);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!admin || adminView !== 'campaigns' || selectedCampaignId) return;
    let cancelled = false;
    setCampaignsError('');
    listCampaigns(campaignPage)
      .then(res => {
        if (cancelled) return;
        setCampaigns(res.data);
        setCampaignTotalPages(res.totalPages);
        setCampaignTotal(res.total);
      })
      .catch(err => { if (!cancelled) setCampaignsError(apiErrorMessage(err, 'Could not load campaigns.')); })
      .finally(() => { if (!cancelled) setCampaignsLoading(false); });
    return () => { cancelled = true; };
  }, [admin, adminView, campaignPage, campaignRevision, selectedCampaignId]);

  async function toggleCampaign(c: VoucherCampaign) {
    setCampaignsError('');
    try {
      await setCampaignStatus(c.id, c.status === 'active' ? 'paused' : 'active');
      setCampaignRevision(v => v + 1);
    } catch (err) {
      setCampaignsError(apiErrorMessage(err, 'Could not update the campaign.'));
    }
  }

  // Vendor-facing voucher for the selected offer: previewed from live data,
  // downloadable as a 1700x800 PNG or printable for a physical handout.
  const [voucher, setVoucher] = useState<VoucherOffer | null>(null);
  const [voucherBusy, setVoucherBusy] = useState<'png' | 'print' | null>(null);
  const [voucherError, setVoucherError] = useState('');

  async function exportVoucher(offer: VoucherOffer, kind: 'png' | 'print') {
    setVoucherBusy(kind);
    setVoucherError('');
    try {
      if (kind === 'png') await downloadVoucherPng(offer);
      else await printVoucher(offer);
    } catch (err) {
      setVoucherError(err instanceof Error ? err.message : 'Could not generate the voucher.');
    } finally {
      setVoucherBusy(null);
    }
  }
  const [form, setForm] = useState({ ...defaultVoucherTerms(), code: '', claimLimit: '100', usesPerVendor: '1' });

  // The form's live counterpart, so every field's effect is visible as it is
  // typed. Blanks stand in as zeroes rather than blowing up the art.
  const previewOffer: VoucherOffer = {
    id: 'preview',
    code: form.code || 'YOURCODE',
    title: form.title || 'Your offer name',
    description: '',
    discountType: form.discountType,
    discountAmount: Number(form.discountAmount) || 0,
    discountPercent: form.discountPercent ? Number(form.discountPercent) : null,
    maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
    minimumCharge: Number(form.minimumCharge) || 0,
    startsAt: new Date().toISOString(),
    expiresAt: form.expiresAt ? expiryIso(form.expiresAt) : new Date().toISOString(),
    claimLimit: 0,
    claimedCount: 0,
    usesPerVendor: Number(form.usesPerVendor) || 1,
    isActive: true,
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (admin) {
        const res = await listVouchers(page);
        if (isOfferList(res)) {
          setOffers(res.data);
          setTotalPages(res.totalPages);
          setTotal(res.total);
        }
      } else {
        const [browse, claimed, kyc] = await Promise.all([
          listVouchers(),
          listMyVouchers(),
          // KYC state is advisory next to the vouchers it gates — a lookup
          // hiccup must not take the offers down with it.
          getMyKycStatus().catch(() => null),
        ]);
        setAvailable(browse as AvailableVoucher[]);
        setMine(claimed);
        setKycPrefill(kyc);
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load vouchers.'));
    } finally {
      setLoading(false);
    }
  }, [admin, page]);

  useEffect(() => { void reload(); }, [reload, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setFieldErrors({});
    setNotice('');
    try {
      const hidden = deriveHiddenTerms(form);
      const created = await createVoucher({
        code: form.code,
        title: form.title,
        description: hidden.description,
        discountType: form.discountType,
        ...(form.discountType === 'fixed'
          ? { discountAmount: Number(form.discountAmount) }
          : { discountPercent: Number(form.discountPercent), ...(form.maxDiscount ? { maxDiscount: Number(form.maxDiscount) } : {}) }),
        ...(form.minimumCharge ? { minimumCharge: Number(form.minimumCharge) } : {}),
        startsAt: hidden.startsAt,
        expiresAt: expiryIso(form.expiresAt),
        claimLimit: Number(form.claimLimit),
        usesPerVendor: Number(form.usesPerVendor) || 1,
      });
      setNotice(`Voucher ${created.code} published.`);
      setForm({ ...defaultVoucherTerms(), code: '', claimLimit: '100', usesPerVendor: '1' });
      setRevision(v => v + 1);
    } catch (err) {
      const detail = extractServerFieldErrors(err, {
        // Fields the form derives rather than asks for — name the visible
        // input that feeds them, so the message still points somewhere real.
        description: 'title',
        startsAt: 'expiresAt',
      });
      setFieldErrors(detail?.fieldErrors ?? {});
      setFormError(detail?.summary ?? apiErrorMessage(err, 'Could not publish the voucher.'));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(offer: VoucherOffer) {
    setNotice('');
    setError('');
    try {
      await setVoucherActive(offer.id, !offer.isActive);
      setRevision(v => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the voucher.'));
    }
  }

  async function claim(voucherId?: string) {
    const value = (voucherId ? available.find(v => v.id === voucherId)?.code : code) || '';
    if (!value.trim()) {
      setClaimError('Enter a voucher code first.');
      return;
    }
    setClaiming(true);
    setClaimError('');
    setNotice('');
    try {
      const claimed = await claimVoucher(voucherId ? { voucherId } : { code: value.trim() });
      setNotice(`Voucher ${claimed.voucher.code} claimed — pick it while creating your next order.`);
      setCode('');
      setRevision(v => v + 1);
    } catch (err) {
      setClaimError(apiErrorMessage(err, 'Could not claim this voucher.'));
    } finally {
      setClaiming(false);
    }
  }

  const offerColumns = [
    {
      header: 'CODE / TITLE',
      accessor: (o: VoucherOffer) => (
        <div>
          <strong>{o.code}</strong>
          <div className="vouchers-cell-sub">{o.title}</div>
        </div>
      ),
    },
    { header: 'OFFER', accessor: (o: VoucherOffer) => voucherBenefit(o) },
    { header: 'MIN. CHARGE', accessor: (o: VoucherOffer) => formatCurrency(o.minimumCharge) },
    { header: 'WINDOW', accessor: (o: VoucherOffer) => `${toBsDate(o.startsAt)} → ${toBsDate(o.expiresAt)}` },
    {
      header: 'CLAIMED',
      accessor: (o: VoucherOffer) => (
        <span className="vouchers-claimed">
          {o.claimedCount} / {o.claimLimit}
          {o.claimedCount >= o.claimLimit && <StatusChip variant="solid" tone="warning">Full</StatusChip>}
        </span>
      ),
    },
    {
      header: 'STATUS',
      accessor: (o: VoucherOffer) => (
        <StatusChip variant="solid" tone={o.isActive ? 'success' : 'neutral'}>
          {o.isActive ? 'Live' : 'Paused'}
        </StatusChip>
      ),
    },
    {
      header: 'ACTION',
      accessor: (o: VoucherOffer) => (
        <div className="vouchers-row-actions">
          <Button variant="secondary" size="sm" onClick={() => { setVoucher(o); setVoucherError(''); }}>
            Voucher
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void toggle(o)}>
            {o.isActive ? 'Pause' : 'Resume'}
          </Button>
        </div>
      ),
      width: '200px',
    },
  ];

  return (
    <div className="vendor-finance-page vouchers-page">
      <PageHeader
        title="Vouchers"
        subtitle={admin
          ? 'Publish shipping offers vendors claim and spend on outbound delivery orders.'
          : 'Shipping offers you can use on an outbound order — type the code while creating it, or save one here first.'}
      />

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && (
        <Banner tone="danger">
          {error}{' '}
          <Button size="sm" variant="secondary" onClick={() => setRevision(v => v + 1)}>Retry</Button>
        </Banner>
      )}
      {loading && <div className="billing-skeleton billing-skeleton-table" aria-busy="true" aria-label="Loading vouchers" />}

      {!loading && !admin && <>
        {kycPrefill && !kycPrefill.hasApprovedKyc && (
          kycPrefill.pendingApplication ? (
            <section className="billing-card" aria-label="KYC verification status">
              <h2>KYC verification pending</h2>
              <p>
                <StatusChip tone="warning">Under review</StatusChip>
              </p>
              <p>Submitted {toBsDate(kycPrefill.pendingApplication.createdAt)}. Vouchers do not wait on this — approval moves you onto per-destination delivery rates.</p>
            </section>
          ) : (
            <section className="billing-card" aria-label="KYC verification">
              <h2>Verify your business</h2>
              <p>Not needed for vouchers — any code works without it. Verified vendors move onto per-destination delivery rates. Fill the form yourself; our team reviews it like any other application.</p>
              <div className="vouchers-claim-row">
                <Button variant="primary" onClick={() => { setKycFormError(''); setKycOpen(true); }}>Start KYC verification</Button>
              </div>
            </section>
          )
        )}
        <section className="billing-card" aria-label="Claim with a code">
          <h2>Have a code?</h2>
          <p>
            Type it straight into the order form to use it — for example <strong>MOVE100</strong>.
            Saving it to My Vouchers here is optional, and holds it for later.
          </p>
          <div className="vouchers-claim-row">
            <FormField
              label="Voucher code"
              hideLabel
              className="vouchers-code-field"
              value={code}
              disabled={claiming}
              onChange={v => setCode(v.toUpperCase())}
              placeholder="VOUCHER CODE"
              maxLength={32}
              error={claimError || undefined}
            />
            <Button variant="primary" disabled={claiming || !code.trim()} onClick={() => void claim()}>{claiming ? 'Claiming…' : 'Claim'}</Button>
          </div>
        </section>

        <section aria-label="Available vouchers">
          <h2>Available vouchers</h2>
          {!available.length
            ? <p>No live offers right now. Check back soon.</p>
            : <div className="vouchers-grid">
              {available.map(v => (
                <article key={v.id} className="voucher-card">
                  <div className="voucher-card-top">
                    <span className="voucher-code">{v.code}</span>
                    {v.myClaim && <StatusChip variant="solid" tone={claimTone(v.myClaim.state)}>{v.myClaim.state}</StatusChip>}
                  </div>
                  <h3>{v.title}</h3>
                  <p className="voucher-benefit">{voucherBenefit(v)}</p>
                  <p className="voucher-desc">{v.description}</p>
                  <dl className="voucher-meta">
                    <div><dt>Min. delivery charge</dt><dd>{formatCurrency(v.minimumCharge)}</dd></div>
                    <div><dt>Expires</dt><dd>{toBsDate(v.expiresAt)}<br />{new Date(v.expiresAt).toLocaleTimeString()}</dd></div>
                    <div><dt>Left to claim</dt><dd>{v.spotsLeft} of {v.claimLimit}</dd></div>
                  </dl>
                  {!v.myClaim && <Button variant="primary" disabled={claiming} onClick={() => void claim(v.id)}>Claim</Button>}
                </article>
              ))}
            </div>}
        </section>

        <section aria-label="My vouchers">
          <h2>My Vouchers</h2>
          {!mine.length
            ? <p>Nothing claimed yet — claim an offer above to use it on your next order.</p>
            : <div className="vouchers-grid">
              {mine.map(m => (
                <article key={m.claimId} className={`voucher-card${m.usable ? '' : ' voucher-card-spent'}`}>
                  <div className="voucher-card-top">
                    <span className="voucher-code">{m.voucher.code}</span>
                    <StatusChip variant="solid" tone={claimTone(m.state)}>{m.state}</StatusChip>
                  </div>
                  <h3>{m.voucher.title}</h3>
                  <p className="voucher-benefit">{voucherBenefit(m.voucher)}</p>
                  {!m.usable && m.unusableReason && <p className="voucher-unusable">{m.unusableReason}</p>}
                  <dl className="voucher-meta">
                    <div><dt>Min. delivery charge</dt><dd>{formatCurrency(m.voucher.minimumCharge)}</dd></div>
                    <div><dt>Expires</dt><dd>{toBsDate(m.voucher.expiresAt)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>}
        </section>

        {kycOpen && kycPrefill && !kycPrefill.hasApprovedKyc && (
          <div className="modal-overlay" onClick={() => setKycOpen(false)}>
            <div className="modal-content" role="dialog" aria-modal="true" aria-label="Start KYC verification" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Verify {kycPrefill.profile.onlineBusinessName}</h2>
                <Button variant="ghost" size="icon" className="modal-close-btn" onClick={() => setKycOpen(false)} aria-label="Close">
                  <X size={18} />
                </Button>
              </div>
              <p className="modal-desc">
                Anything left blank keeps your account value.
              </p>
              <KycVerificationForm
                initial={kycPrefill.profile}
                docsOnFile={kycPrefill.docsOnFile}
                emailLocked
                submitting={kycSubmitting}
                error={kycFormError}
                submitLabel="Submit verification"
                onSubmit={(values, files) => void submitKycVerification(values, files)}
                onCancel={() => setKycOpen(false)}
              />
            </div>
          </div>
        )}
      </>}

      {!loading && admin && <>
        <SegmentedTabs
          ariaLabel="Voucher management"
          value={adminView}
          onChange={setAdminView}
          options={[
            { value: 'campaigns', label: 'Campaigns', count: campaignTotal },
            { value: 'standalone', label: 'Standalone' },
          ]}
        />

        {adminView === 'campaigns' ? (
          selectedCampaignId ? (
            <CampaignDetail
              campaignId={selectedCampaignId}
              onBack={() => setSelectedCampaignId(null)}
              onChanged={() => setCampaignRevision(v => v + 1)}
              onPreviewCode={setVoucher}
            />
          ) : (
            <section aria-label="Voucher campaigns">
              <div className="vouchers-campaigns-head">
                <p>Bulk-code campaigns for print handouts — e.g. Dashain 20% off across 100 slips. Track claims per code.</p>
                <Button variant="primary" onClick={() => setWizardOpen(true)}>New campaign</Button>
              </div>
              {campaignsError && <Banner tone="danger">{campaignsError}</Banner>}
              {campaignsLoading
                ? <div className="billing-skeleton billing-skeleton-table" aria-busy="true" aria-label="Loading campaigns" />
                : <CampaignDirectory
                  campaigns={campaigns}
                  page={campaignPage}
                  totalPages={campaignTotalPages}
                  total={campaignTotal}
                  onPage={setCampaignPage}
                  onView={c => setSelectedCampaignId(c.id)}
                  onToggle={c => void toggleCampaign(c)}
                />}
            </section>
          )
        ) : (
          <>
            <form className="billing-card vouchers-create" onSubmit={submit}>
              <h2>Create a voucher</h2>
              <p>Fill in the offer and publish it. Once it is out, the terms are fixed — to stop it, pause it.</p>
          <div className="vouchers-create-body">
            <fieldset disabled={saving} className="vouchers-fields">
              <FormField
                label="Code vendors type"
                required
                minLength={3}
                gridColumn="1 / -1"
                hint="Letters and numbers, no spaces"
                error={fieldErrors.code}
                value={form.code}
                onChange={v => setForm({ ...form, code: v.toUpperCase() })}
                placeholder="MOVE100"
              />
              <VoucherTermsFields values={form} onChange={patch => setForm({ ...form, ...patch })} errors={fieldErrors} />
              <FormField
                label="Total uses"
                required
                type="number"
                min={1}
                max={100000}
                step={1}
                hint="Across all vendors"
                error={fieldErrors.claimLimit}
                value={form.claimLimit}
                onChange={v => setForm({ ...form, claimLimit: v })}
              />
              <FormField
                label="Uses per vendor"
                required
                type="number"
                min={1}
                max={100}
                step={1}
                hint="Everyone shares this code, so cap how often one vendor may spend it"
                error={fieldErrors.usesPerVendor}
                value={form.usesPerVendor}
                onChange={v => setForm({ ...form, usesPerVendor: v })}
              />
            </fieldset>
            {/* Seeing the vendor's view as you type does more to explain the
                fields than any amount of helper text. */}
            <aside className="vouchers-create-preview" aria-label="Preview">
              <span className="voucher-field-label">Vendors will see</span>
              <VoucherPromo offer={previewOffer} copyable={false} />
            </aside>
          </div>
          {formError && <p role="alert" className="vendor-finance-error">{formError}</p>}
          <div><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Publishing…' : 'Publish voucher'}</Button></div>
        </form>

        <section aria-label="Published vouchers">
          <h2>Published vouchers</h2>
          <Table
            columns={offerColumns}
            data={offers}
            selectable={false}
            emptyMessage="No vouchers published yet. Publish one above — it lands here for vendors to claim."
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Published vouchers"
            summary={total > 0 ? `${total} voucher${total === 1 ? '' : 's'}` : undefined}
          />
        </section>
          </>
        )}

        {wizardOpen && (
          <CampaignWizard
            onClose={() => setWizardOpen(false)}
            onCreated={c => { setWizardOpen(false); setSelectedCampaignId(c.id); setCampaignRevision(v => v + 1); }}
          />
        )}

        {voucher && (
          <div className="modal-overlay" onClick={() => setVoucher(null)}>
            <div className="modal-content voucher-preview-modal" role="dialog" aria-modal="true" aria-label={`Voucher ${voucher.code}`} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{voucher.code} voucher</h2>
                <Button variant="ghost" size="icon" className="modal-close-btn" onClick={() => setVoucher(null)} aria-label="Close">
                  <X size={18} />
                </Button>
              </div>
              <p className="modal-desc">
                Live preview of the vendor voucher — download the PNG to share, or print a copy to hand over.
              </p>
              <VoucherPromo offer={voucher} />
              {voucherError && <Banner tone="danger">{voucherError}</Banner>}
              <div className="modal-footer">
                <Button variant="secondary" onClick={() => setVoucher(null)}>Close</Button>
                <Button variant="secondary" disabled={voucherBusy !== null} onClick={() => void exportVoucher(voucher, 'print')}>
                  {voucherBusy === 'print' ? 'Preparing…' : 'Print'}
                </Button>
                <Button variant="primary" disabled={voucherBusy !== null} onClick={() => void exportVoucher(voucher, 'png')}>
                  {voucherBusy === 'png' ? 'Preparing…' : 'Download PNG'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </>}
    </div>
  );
}
