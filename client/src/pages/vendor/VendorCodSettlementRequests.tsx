import React, { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import Banner from '../../components/Banner';
import StatusChip, { type StatusChipTone } from '../../components/StatusChip';
import {
  COD_REQUEST_STATUS_LABELS,
  createCodSettlementRequest,
  getCodSettlementRequests,
  getRegisteredBankDetails,
  isLiveCodRequest,
  type CodSettlementRequest,
  type CodSettlementRequestStatus,
  type RegisteredBankDetails,
} from '../../services/codSettlementRequests.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { formatDate } from '../../utils/format';
import './VendorCodSettlementRequests.css';

// Asking to be paid out the COD we're holding.
//
// This used to be a support ticket. The reason it is its own page is the rule
// at the centre of it: one live request at a time. A vendor with a request
// already open sees that request instead of a form, so the constraint is
// visible up front rather than arriving as an error after they have asked.

/** Only the note is the vendor's to fill in — the account comes from their profile. */
const emptyForm = { note: '' };

const STATUS_TONE: Record<CodSettlementRequestStatus, StatusChipTone> = {
  open: 'info',
  in_progress: 'warning',
  settled: 'success',
  rejected: 'danger',
};

const VendorCodSettlementRequests: React.FC = () => {
  const [requests, setRequests] = useState<CodSettlementRequest[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registeredBank, setRegisteredBank] = useState<RegisteredBankDetails | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getCodSettlementRequests({ pageSize: 50 });
      setRequests(response.data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load your COD settlement requests'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The account on the vendor's profile — the only account a payout can go to.
  // Not a prefill: it is what gets submitted, and the vendor cannot type over
  // it, so a failure here has to surface rather than be swallowed.
  useEffect(() => {
    let cancelled = false;
    getRegisteredBankDetails()
      .then((response) => {
        if (cancelled || !response?.success) return;
        setRegisteredBank(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'Could not load your registered bank details'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The server is the authority here (a partial unique index, not a check), but
  // the list already tells us the answer, so the form can be replaced rather
  // than shown and then refused.
  const liveRequest = requests.find((request) => isLiveCodRequest(request.status)) ?? null;

  /** Whether there is an account to pay into at all. */
  const hasRegisteredBank = Boolean(
    registeredBank?.bankName && registeredBank.accountNumber && registeredBank.accountName,
  );

  const submit = async () => {
    // The details come from the profile, not the form, so there is nothing for
    // the vendor to get wrong — only the case where the profile itself is
    // incomplete, which the card already explains.
    if (!registeredBank || !hasRegisteredBank) {
      setError('There are no bank details on your profile to send a payout to.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCodSettlementRequest({
        bankName: registeredBank.bankName,
        accountNumber: registeredBank.accountNumber,
        accountName: registeredBank.accountName,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      setForm(emptyForm);
      setNotice('Your COD settlement request has been raised.');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not raise the request'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { header: 'Request', accessor: (r: CodSettlementRequest) => r.requestNo, width: '170px' },
    {
      header: 'Status',
      width: '130px',
      accessor: (r: CodSettlementRequest) => (
        <StatusChip variant="solid" tone={STATUS_TONE[r.status]}>
          {COD_REQUEST_STATUS_LABELS[r.status]}
        </StatusChip>
      ),
    },
    {
      header: 'Account',
      width: '220px',
      accessor: (r: CodSettlementRequest) => (
        <>
          <span className="vcr-line">{r.bankName}</span>
          <span className="vcr-line">{r.accountNumber}</span>
        </>
      ),
    },
    {
      header: 'Raised',
      width: '130px',
      accessor: (r: CodSettlementRequest) => formatDate(r.createdAt),
    },
    {
      header: 'Outcome',
      accessor: (r: CodSettlementRequest) =>
        r.status === 'rejected'
          ? r.decisionNote || 'Rejected'
          : r.status === 'settled'
            ? r.settlementStatementId || 'Settled'
            : '—',
    },
  ];

  return (
    <div className="vcr-page">
      <PageHeader
        title="COD Settlement"
        subtitle="Request a payout of the COD we are holding for you, and track what happened to it."
      />

      {error && <Banner tone="danger">{error}</Banner>}
      {notice && !error && <Banner tone="success">{notice}</Banner>}

      {liveRequest ? (
        <Banner tone="info">
          Request <strong>{liveRequest.requestNo}</strong> is{' '}
          {COD_REQUEST_STATUS_LABELS[liveRequest.status].toLowerCase()}. You can raise another once
          this one has been settled or rejected.
        </Banner>
      ) : (
        <section className="vcr-card">
          <div className="vcr-card-head">
            <h2>Request a settlement</h2>
            <p>
              Your payout goes to the account registered on your profile. To change it, contact us
              and we will update your profile.
            </p>
          </div>

          {hasRegisteredBank ? (
            <>
              {/* Read-only on purpose, and enforced on the server too: the
                  service reads the destination off the vendor record and
                  ignores whatever the request body says. Letting a payout be
                  redirected to an account typed in here is the shape of a
                  payment-redirection fraud.

                  A definition list rather than disabled inputs — these are
                  facts being quoted back, and a row of greyed-out boxes reads
                  as "editable later" when it never is. */}
              <dl className="vcr-bank">
                <div>
                  <dt>Bank</dt>
                  <dd>{registeredBank?.bankName}</dd>
                </div>
                <div>
                  <dt>Account number</dt>
                  <dd>{registeredBank?.accountNumber}</dd>
                </div>
                <div>
                  <dt>Account holder</dt>
                  <dd>{registeredBank?.accountName}</dd>
                </div>
              </dl>

              <FormField
                label="Note"
                type="textarea"
                value={form.note}
                onChange={(value) => setForm({ note: value })}
                placeholder="Anything we should know about this payout"
                hint="Optional"
              />

              <div className="vcr-actions">
                {/* Button defaults to `secondary`, which rendered the page's
                    one real action in grey. This is the primary action on the
                    screen, so it takes the brand colour. */}
                <Button variant="primary" onClick={submit} disabled={submitting}>
                  <Send size={16} />
                  {submitting ? 'Sending…' : 'Raise request'}
                </Button>
              </div>
            </>
          ) : (
            // Bank details are required at vendor creation now, so this is only
            // reachable by an account registered before that rule. It has to say
            // what to do rather than showing a form that cannot be submitted.
            <Banner tone="warning">
              We do not have bank details on your profile, so there is nowhere to send a payout.
              Contact us to have them added, then raise your request.
            </Banner>
          )}
        </section>
      )}

      <section className="vcr-card">
        <div className="vcr-card-head">
          <h2>Your requests</h2>
        </div>
        <Table
          columns={columns}
          data={requests}
          loading={loading}
          loadingMessage="Loading your requests…"
          emptyMessage="You have not raised a settlement request yet."
          minWidth="880px"
        />
      </section>
    </div>
  );
};

export default VendorCodSettlementRequests;
