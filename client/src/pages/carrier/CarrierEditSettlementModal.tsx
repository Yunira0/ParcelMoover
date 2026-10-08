import React, { useCallback } from 'react';
import StatementEditModal, { type EditableOrder } from '../../components/StatementEditModal';
import {
  CARRIER_LABEL,
  getUnsettledCarrierOrders,
  updateCarrierSettlement,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import { splitTotal, useCarrierCharges } from './carrierCharges';
import { CarrierChargeFields, CarrierChargeInput } from './CarrierChargeFields';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Edit an unpaid 3PL statement: its orders, and the carrier's charge on each - per order or as one total. */
const CarrierEditSettlementModal: React.FC<{
  detail: CarrierSettlementDetail;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ detail, onClose, onSuccess }) => {
  const label = CARRIER_LABEL[detail.carrier];
  // A statement whose charges are an even split of its total opens on that
  // total, so adding or dropping an order re-splits it. Uneven charges open
  // per order, so saving never quietly evens them out.
  const saved = detail.items.map((item) => item.carrierCharge);
  const evenSplit = saved.join() === splitTotal(detail.carrierCharges, saved.length).join();
  const charges = useCarrierCharges(
    Object.fromEntries(detail.items.map((item) => [item.codCollectionId, String(item.carrierCharge)])),
    evenSplit ? String(detail.carrierCharges) : '',
  );
  // An order's amount here is its COD; the charge comes off it.
  const chargesOf = (selected: EditableOrder[]) => charges.chargesFor(selected.map((order) => order.id));

  const loadAddable = useCallback(async () => ({
    orders: (await getUnsettledCarrierOrders(detail.carrier)).map((order) => ({
      id: order.codCollectionId,
      trackingId: order.trackingId,
      receiverName: order.receiverName,
      amount: order.collectedAmount,
    })),
  }), [detail.carrier]);

  return (
    <StatementEditModal
      currentOrders={detail.items.map((item) => ({
        id: item.codCollectionId,
        trackingId: item.trackingId,
        receiverName: item.receiverName,
        amount: item.collectedAmount,
      }))}
      loadAddable={loadAddable}
      amountLabel="COD"
      payeeNoun="carrier"
      extraColumn={{
        header: `${label} Charge`,
        render: (order, selected) => (
          <CarrierChargeInput
            charges={charges}
            id={order.id}
            share={chargesOf(selected).get(order.id)}
            label={`${label} charge on ${order.trackingId}`}
          />
        ),
      }}
      totalOf={(selected) => {
        const map = chargesOf(selected);
        return round2(selected.reduce((sum, order) => sum + order.amount - (map.get(order.id) ?? 0), 0));
      }}
      onSave={async (selected) => {
        const map = chargesOf(selected);
        const items = selected.map((order) => ({ codCollectionId: order.id, carrierCharge: map.get(order.id) ?? 0 }));
        if (selected.some((order) => (map.get(order.id) ?? 0) > order.amount)) {
          throw new Error('Each charge must be between 0 and the COD on that order.');
        }
        await updateCarrierSettlement(detail.id, items);
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    >
      <div className="scp-row esm-section">
        <CarrierChargeFields charges={charges} carrierLabel={label} fieldClassName="scp-field" />
      </div>
    </StatementEditModal>
  );
};

export default CarrierEditSettlementModal;
