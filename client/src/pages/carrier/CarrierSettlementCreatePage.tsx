import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListChecks, Truck } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import ReceiverPhones from '../../components/ReceiverPhones';
import { SectionHeader } from '../SettlementCreatePage';
import {
  CARRIERS,
  CARRIER_LABEL,
  createCarrierSettlement,
  getUnsettledCarrierOrders,
  type CarrierCode,
  type UnsettledCarrierOrder,
} from '../../services/carrierCod.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import { todayNepalAd } from '../../utils/nepaliDate';
import '../SettlementCreatePage.css';

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

/** The orders a pasted list names, and the values that named none. Null when nothing is pasted. */
function searchPasted(text: string, orders: UnsettledCarrierOrder[]) {
  const tokens = Array.from(new Set(text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean)));
  if (tokens.length === 0) return null;
  const matched = new Set<string>();
  const notFound: string[] = [];
  for (const token of tokens) {
    const hits = orders.filter((o) => matchesOrder(token, o));
    if (hits.length === 0) notFound.push(token);
    hits.forEach((o) => matched.add(o.codCollectionId));
  }
  return { matched, notFound };
}

/** Add a 3PL settlement - the same form as Add Settlement, with the carrier's charge per order. */
const CarrierSettlementCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [carrier, setCarrier] = useState<CarrierCode>(searchParams.get('carrier') === 'upaya' ? 'upaya' : 'ncm');
  const [settlementDate, setSettlementDate] = useState(todayNepalAd);
  const [defaultCharge, setDefaultCharge] = useState('');
  const [orders, setOrders] = useState<UnsettledCarrierOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A row's own charge, when it differs from the default above.
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [pasted, setPasted] = useState('');
  const [fetchingOrders, setFetchingOrders] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setFetchingOrders(true);
    getUnsettledCarrierOrders(carrier)
      .then((list) => {
        if (!active) return;
        setOrders(list);
        setSelected(new Set());
        setCharges({});
        setPasted('');
      })
      .catch(() => active && setOrders([]))
      .finally(() => active && setFetchingOrders(false));
    return () => { active = false; };
  }, [carrier]);

  const search = useMemo(() => searchPasted(pasted, orders), [pasted, orders]);
  const visible = search ? orders.filter((o) => search.matched.has(o.codCollectionId)) : orders;

  // Searching as you paste: the orders the list names are the ones selected.
  const onPaste = (value: string) => {
    setPasted(value);
    const result = searchPasted(value, orders);
    setSelected(result ? new Set(result.matched) : new Set());
  };

  const chargeOf = (id: string) => Number(charges[id] ?? defaultCharge) || 0;
  const selectedOrders = orders.filter((o) => selected.has(o.codCollectionId));
  const total = round2(selectedOrders.reduce((sum, o) => sum + o.collectedAmount - chargeOf(o.codCollectionId), 0));

  const toggleOrder = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((o) => selected.has(o.codCollectionId));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((o) => o.codCollectionId)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (selectedOrders.length === 0) {
      setError('Please select at least one order.');
      return;
    }
    const invalid = selectedOrders.find((o) => chargeOf(o.codCollectionId) < 0 || chargeOf(o.codCollectionId) > o.collectedAmount);
    if (invalid) {
      setError(`The charge on ${invalid.trackingId} must be between 0 and its COD.`);
      return;
    }
    setLoading(true);
    try {
      const created = await createCarrierSettlement({
        carrier,
        settlementDate,
        items: selectedOrders.map((o) => ({ codCollectionId: o.codCollectionId, carrierCharge: chargeOf(o.codCollectionId) })),
      });
      navigate(`/finance/carrier-cod/${created.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to create settlement'));
    } finally {
      setLoading(false);
    }
  };

  const label = CARRIER_LABEL[carrier];

  return (
    <div className="scp-page">
      <button type="button" className="scp-back" onClick={() => navigate('/finance/carrier-cod')}>
        <ArrowLeft size={15} />
        3PL COD
      </button>

      <div className="scp-header">
        <h1>Add Settlement</h1>
        <p>Select a carrier and choose the delivered orders it is paying for.</p>
      </div>

      <form className="scp-form" onSubmit={handleSubmit} noValidate>
        <section className="scp-section">
          <SectionHeader icon={<Truck size={18} />} title="Carrier" description="Choose the carrier, the settlement date and its charge per order." />
          <div className="scp-row">
            <div className="scp-field">
              <FormField
                label="Carrier"
                type="select"
                required
                value={carrier}
                onChange={(value) => setCarrier(value as CarrierCode)}
                options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))}
              />
            </div>
            <div className="scp-field">
              <FormField label="Settlement Date" type="date" value={settlementDate} onChange={setSettlementDate} />
            </div>
            <div className="scp-field">
              <FormField
                label="Charge per Order"
                type="decimal"
                value={defaultCharge}
                onChange={setDefaultCharge}
                placeholder="e.g. 150"
                hint={`What ${label} keeps on each order. Change a row below if it differs.`}
              />
            </div>
          </div>
        </section>

        <section className="scp-section">
          <SectionHeader
            icon={<ListChecks size={18} />}
            title={`Unsettled Orders (${search ? `${visible.length} of ${orders.length}` : orders.length})`}
            description={`Orders ${label} delivered and has not paid for yet.`}
          />
          <FormField
            label="Find orders"
            type="textarea"
            rows={2}
            value={pasted}
            onChange={onPaste}
            placeholder="Paste order numbers, tracking IDs or phone numbers"
          />
          {search && search.notFound.length > 0 && (
            <div className="scp-error" role="status">
              Not found ({search.notFound.length}): {search.notFound.join(', ')}
            </div>
          )}

          {fetchingOrders ? (
            <div className="scp-empty">Loading orders...</div>
          ) : visible.length === 0 ? (
            <div className="scp-empty">No unsettled orders found for {label}.</div>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                    </th>
                    <th>Order ID</th>
                    <th>Tracking ID</th>
                    <th>Receiver</th>
                    <th>Number</th>
                    <th>Destination</th>
                    <th className="scp-num">COD</th>
                    <th className="scp-num">{label} Charge</th>
                    <th className="scp-num">Net Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((order) => (
                    <tr
                      key={order.codCollectionId}
                      className={selected.has(order.codCollectionId) ? 'scp-row-selected' : ''}
                      onClick={() => toggleOrder(order.codCollectionId)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(order.codCollectionId)}
                          onChange={() => toggleOrder(order.codCollectionId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="scp-mono">#{order.orderNumber}</td>
                      <td className="scp-mono">{order.trackingId}</td>
                      <td>
                        {order.receiverName}
                        {order.vendorName && <div className="scp-subtext">{order.vendorName}</div>}
                      </td>
                      <td className="scp-mono"><ReceiverPhones phone={order.receiverPhone} /></td>
                      <td>{order.destination || '-'}</td>
                      <td className="scp-num">Rs. {order.collectedAmount.toLocaleString()}</td>
                      <td className="scp-num" onClick={(e) => e.stopPropagation()}>
                        <FormField
                          label={`${label} charge on ${order.trackingId}`}
                          hideLabel
                          type="decimal"
                          value={charges[order.codCollectionId] ?? defaultCharge}
                          onChange={(value) => setCharges((prev) => ({ ...prev, [order.codCollectionId]: value }))}
                          placeholder="0"
                        />
                      </td>
                      <td className="scp-num scp-num-strong">
                        Rs. {round2(order.collectedAmount - chargeOf(order.codCollectionId)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected.size > 0 && (
            <div className="scp-summary">
              <span>{selected.size} order{selected.size > 1 ? 's' : ''} selected</span>
              <span className="scp-summary-total">Total: Rs. {total.toLocaleString()}</span>
            </div>
          )}
        </section>

        {error && (
          <div className="scp-error" role="alert">
            {error}
          </div>
        )}

        <div className="scp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/finance/carrier-cod')} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Adding...' : 'Add Settlement'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CarrierSettlementCreatePage;
