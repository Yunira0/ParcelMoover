import React, { useCallback, useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import { Banner } from '../accounting/ui';
import {
  COD_REQUEST_STATUS_LABELS,
  createCodSettlementRequest,
  getCodSettlementRequests,
  isLiveCodRequest,
  type CodSettlementRequest,
} from '../../services/codSettlementRequests.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../CodSettlementRequests.css';

// Asking to be paid out the COD we're holding.
//
// This used to be a support ticket. The reason it is its own page is the rule
// at the centre of it: one live request at a time. A vendor with a request
// already open sees that request instead of a form, so the constraint is
// visible up front rather than arriving as an error after they have typed
// their bank details out.

const emptyForm = { bankName: '', accountNumber: '', accountName: '', note: '' };

const VendorCodSettlementRequests: React.FC = () => {
  const [requests, setRequests] = useState<CodSettlementRequest[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  // The server is the authority here (a partial unique index, not a check), but
  // the list already tells us the answer, so the form can be replaced rather
  // than shown and then refused.
  const liveRequest = requests.find((request) => isLiveCodRequest(request.status)) ?? null;

  const update = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    if (!form.bankName.trim() || !form.accountNumber.trim() || !form.accountName.trim()) {
      setError('Bank name, account number and account holder name are all required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCodSettlementRequest({
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        accountName: form.accountName.trim(),
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
    { header: 'REQUEST', accessor: (r: CodSettlementRequest) => r.requestNo, width: '170px' },
    {
      header: 'STATUS',
      accessor: (r: CodSettlementRequest) => COD_REQUEST_STATUS_LABELS[r.status],
      width: '120px',
    },
    {
      header: 'ACCOUNT',
      accessor: (r: CodSettlementRequest) => (
        <div className="cod-request-account">
          <span>{r.bankName}</span>
          <span>{r.accountNumber}</span>
        </div>
      ),
    },
    {
      header: 'RAISED',
      accessor: (r: CodSettlementRequest) => r.createdAt.slice(0, 10),
      width: '120px',
    },
    {
      header: 'OUTCOME',
      accessor: (r: CodSettlementRequest) =>
        r.status === 'rejected'
          ? r.decisionNote || 'Rejected'
          : r.status === 'settled'
            ? r.settlementStatementId || 'Settled'
            : '—',
    },
  ];

  return (
    <div className="cod-request-page">
      <header className="cod-request-header">
        <h1>
          <Banknote size={20} /> COD Settlement
        </h1>
        <p>Request a payout of the COD we are holding for you, and track what happened to it.</p>
      </header>

      {error && <Banner tone="danger">{error}</Banner>}
      {notice && !error && <Banner tone="success">{notice}</Banner>}

      {liveRequest ? (
        <Banner tone="info">
          Request <strong>{liveRequest.requestNo}</strong> is {COD_REQUEST_STATUS_LABELS[liveRequest.status].toLowerCase()}.
          You can raise another once this one has been settled or rejected.
        </Banner>
      ) : (
        <section className="cod-request-card">
          <h2>Request a settlement</h2>
          <p className="cod-request-hint">
            Tell us where to send the money. We use these details for this payout only, so they can
            differ from the account registered at signup.
          </p>
          <div className="cod-request-form">
            <FormField
              label="Bank Name"
              required
              value={form.bankName}
              onChange={(value) => update({ bankName: value })}
            />
            <FormField
              label="Account Number"
              required
              value={form.accountNumber}
              onChange={(value) => update({ accountNumber: value })}
            />
            <FormField
              label="Account Holder Name"
              required
              value={form.accountName}
              onChange={(value) => update({ accountName: value })}
            />
            <FormField
              label="Note (optional)"
              type="textarea"
              value={form.note}
              onChange={(value) => update({ note: value })}
            />
          </div>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Raise request'}
          </Button>
        </section>
      )}

      <section className="cod-request-card">
        <h2>Your requests</h2>
        <Table columns={columns} data={requests} loading={loading} />
      </section>
    </div>
  );
};

export default VendorCodSettlementRequests;
