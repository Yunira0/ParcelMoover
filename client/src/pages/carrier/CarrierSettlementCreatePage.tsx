import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListChecks, Truck } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Table from '../../components/Table';
import {
  CARRIERS,
  CARRIER_LABEL,
  createCarrierSettlement,
  getUnsettledCarrierOrders,
  type CarrierCode,
  type UnsettledCarrierOrder,
} from '../../services/carrierCod.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { toBsDate } from '../../utils/nepaliDate';
import '../SettlementCreatePage.css';
import './CarrierCod.css';

const money = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const digits = (value: string) => value.replace(/\D/g, '');

/**
 * Whether one pasted value names this order: its order number (with or without
 * "#"), its tracking ID or the tail of one (NCM echoes back the last 15
 * characters), or the receiver's phone number.
 */
function matchesOrder(token: string, order: UnsettledCarrierOrder): boolean {
  const value = token.replace(/^#/, '').toUpperCase();
  const tracking = order.trackingId.toUpperCase();
  if (value === String(order.orderNumber) || value === tracking) return true;
  if (value.length >= 6 && tracking.endsWith(value)) return true;
  const phone = digits(value);
  return phone.length >= 7 && digits(order.receiverPhone).endsWith(phone);
}

/** Put orders a carrier delivered on a statement, each with the charge the carrier kept. */
const CarrierSettlementCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [carrier, setCarrier] = useState<CarrierCode>(searchParams.get('carrier') === 'upaya' ? 'upaya' : 'ncm');
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [remark, setRemark] = useState('');
  const [orders, setOrders] = useState<UnsettledCarrierOrder[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [bulkCharge, setBulkCharge] = useState('');
  // Pasted list search: when set, only the matched orders are shown (and ticked).
  const [pasted, setPasted] = useState('');
  const [matchedIds, setMatchedIds] = useState<Set<string> | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    getUnsettledCarrierOrders(carrier)
      .then((list) => {
        if (!live) return;
        setOrders(list);
        setSelectedIds(new Set(list.map((o) => o.codCollectionId)));
        setCharges({});
        setMatchedIds(null);
        setNotFound([]);
        setError('');
      })
      .catch((err) => live && setError(apiErrorMessage(err, 'Failed to load delivered orders.')))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [carrier]);

  const rows = useMemo(
    () => orders.filter((o) => !matchedIds || matchedIds.has(o.codCollectionId)).map((o) => ({ ...o, id: o.codCollectionId })),
    [orders, matchedIds],
  );

  const findPasted = () => {
    const tokens = Array.from(new Set(pasted.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)));
    if (tokens.length === 0) return;
    const matched = new Set<string>();
    const missing: string[] = [];
    for (const token of tokens) {
      const hits = orders.filter((o) => matchesOrder(token, o));
      if (hits.length === 0) missing.push(token);
      hits.forEach((o) => matched.add(o.codCollectionId));
    }
    setMatchedIds(matched);
    setSelectedIds(new Set(matched));
    setNotFound(missing);
  };
  const clearPasted = () => {
    setPasted('');
    setMatchedIds(null);
    setNotFound([]);
  };
  const chargeOf = (id: string) => Number(charges[id] || 0);
  const selected = orders.filter((o) => selectedIds.has(o.codCollectionId));
  const codTotal = round2(selected.reduce((sum, o) => sum + o.collectedAmount, 0));
  const chargeTotal = round2(selected.reduce((sum, o) => sum + chargeOf(o.codCollectionId), 0));
  const invalid = selected.find((o) => !(chargeOf(o.codCollectionId) >= 0 && chargeOf(o.codCollectionId) <= o.collectedAmount));

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleRow = (id: string | number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const applyBulkCharge = () =>
    setCharges((prev) => {
      const next = { ...prev };
      for (const o of selected) next[o.codCollectionId] = bulkCharge;
      return next;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selected.length === 0) { setError('Select at least one order.'); return; }
    if (invalid) { setError(`The charge on ${invalid.trackingId} must be between 0 and its COD.`); return; }
    setSaving(true);
    setError('');
    try {
      const created = await createCarrierSettlement({
        carrier,
        settlementDate,
        items: selected.map((o) => ({ codCollectionId: o.codCollectionId, carrierCharge: chargeOf(o.codCollectionId) })),
        ...(remark.trim() ? { remark: remark.trim() } : {}),
      });
      navigate(`/finance/carrier-cod/${created.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create the statement.'));
    } finally {
      setSaving(false);
    }
  };

  type Row = (typeof rows)[number];
  const columns = [
    { header: 'ORDER', accessor: (o: Row) => `#${o.orderNumber}`, width: '80px' },
    { header: 'TRACKING ID', accessor: (o: Row) => o.trackingId, width: '170px' },
    { header: 'VENDOR', accessor: (o: Row) => o.vendorName || '—', width: '150px' },
    { header: 'RECEIVER', accessor: (o: Row) => o.receiverName, width: '150px' },
    { header: 'DESTINATION', accessor: (o: Row) => o.destination || '—', width: '130px' },
    { header: 'DELIVERED', accessor: (o: Row) => (o.deliveredAt ? toBsDate(o.deliveredAt) : '—'), width: '110px' },
    { header: 'COD', accessor: (o: Row) => <span className="scp-num">{money(o.collectedAmount)}</span>, width: '110px' },
    {
      header: `${CARRIER_LABEL[carrier].toUpperCase()} CHARGE`,
      width: '130px',
      accessor: (o: Row) => (
        <input
          className="scp-inline-input"
          type="number"
          min={0}
          max={o.collectedAmount}
          step="0.01"
          value={charges[o.codCollectionId] ?? ''}
          placeholder="0"
          aria-label={`Charge on ${o.trackingId}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setCharges((prev) => ({ ...prev, [o.codCollectionId]: e.target.value }))}
        />
      ),
    },
    {
      header: 'NET',
      width: '110px',
      accessor: (o: Row) => <span className="scp-num scp-num-strong">{money(round2(o.collectedAmount - chargeOf(o.codCollectionId)))}</span>,
    },
  ];

  return (
    <div className="scp-page">
      <button type="button" className="scp-back" onClick={() => navigate('/finance/carrier-cod')}>
        <ArrowLeft size={15} />
        3PL COD
      </button>
      <div className="scp-header">
        <h1>New 3PL statement</h1>
        <p>Select the orders the carrier is paying for and enter the charge it kept on each.</p>
      </div>

      <form className="scp-form" onSubmit={submit} noValidate>
        <section className="scp-section">
          <div className="scp-section-header">
            <div className="scp-section-icon"><Truck size={18} /></div>
            <div><h3>Carrier</h3><p>COD comes to us from this carrier, less its delivery charge.</p></div>
          </div>
          <div className="scp-row">
            <div className="scp-field">
              <FormField
                label="Carrier"
                type="select"
                value={carrier}
                onChange={(v) => setCarrier(v as CarrierCode)}
                options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))}
              />
            </div>
            <div className="scp-field">
              <FormField label="Statement date" type="date" value={settlementDate} onChange={setSettlementDate} />
            </div>
            <div className="scp-field">
              <FormField label="Remark" value={remark} onChange={setRemark} placeholder="Optional, e.g. the carrier's statement number" />
            </div>
          </div>
        </section>

        <section className="scp-section">
          <div className="scp-section-bar">
            <div className="scp-section-header">
              <div className="scp-section-icon"><ListChecks size={18} /></div>
              <div><h3>Delivered orders ({matchedIds ? `${rows.length} of ${orders.length}` : orders.length})</h3><p>Not yet paid for by {CARRIER_LABEL[carrier]} and not on another statement.</p></div>
            </div>
            <div className="scp-bulk">
              <FormField label="" type="decimal" value={bulkCharge} onChange={setBulkCharge} placeholder="Same charge for selected" />
              <Button type="button" variant="secondary" size="sm" onClick={applyBulkCharge} disabled={!bulkCharge || selected.length === 0}>
                Apply
              </Button>
            </div>
          </div>
          <div className="ccs-paste">
            <FormField
              label="Find orders from a list"
              type="textarea"
              rows={2}
              value={pasted}
              onChange={setPasted}
              placeholder="Paste order numbers, tracking IDs or phone numbers — one per line, or separated by commas or spaces"
            />
            <div className="ccs-paste-actions">
              <Button type="button" variant="secondary" size="sm" onClick={findPasted} disabled={!pasted.trim() || orders.length === 0}>
                Find &amp; select
              </Button>
              {matchedIds && (
                <Button type="button" variant="ghost" size="sm" onClick={clearPasted}>Show all orders</Button>
              )}
            </div>
          </div>
          {matchedIds && (
            <div className={notFound.length > 0 ? 'scp-error' : 'ccs-paste-result'} role="status">
              {matchedIds.size} order{matchedIds.size === 1 ? '' : 's'} found and selected.
              {notFound.length > 0 && ` Not found (${notFound.length}): ${notFound.join(', ')}`}
            </div>
          )}
          <Table
            columns={columns}
            data={rows}
            selectedIds={selectedIds}
            onToggleRow={toggleRow}
            allSelected={allSelected}
            someSelected={selectedIds.size > 0}
            onToggleAll={toggleAll}
            loading={loading}
            loadingMessage="Loading orders…"
            emptyMessage={`No delivered ${CARRIER_LABEL[carrier]} orders are waiting to be settled.`}
            minWidth="1150px"
          />
          {selected.length > 0 && (
            <div className="scp-summary">
              <span>{selected.length} order{selected.length > 1 ? 's' : ''} · COD {money(codTotal)} · charges {money(chargeTotal)}</span>
              <span className="scp-summary-total">To receive: {money(round2(codTotal - chargeTotal))}</span>
            </div>
          )}
        </section>

        {error && <div className="scp-error" role="alert">{error}</div>}

        <div className="scp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/finance/carrier-cod')}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create statement'}</Button>
        </div>
      </form>
    </div>
  );
};

export default CarrierSettlementCreatePage;
