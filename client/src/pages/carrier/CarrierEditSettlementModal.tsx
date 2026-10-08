import React, { useCallback, useRef, useState } from 'react';
import StatementEditModal, { type EditableOrder } from '../../components/StatementEditModal';
import {
  CARRIER_LABEL,
  getUnsettledCarrierOrders,
  updateCarrierSettlement,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import { CarrierChargeFields, CarrierChargeInput, useCarrierCharges } from './carrierCharges';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Edit an unpaid 3PL statement: its orders, and the carrier's charge on each - per order or as one total. */
const CarrierEditSettlementModal: React.FC<{
  detail: CarrierSettlementDetail;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ detail, onClose, onSuccess }) => {
  const label = CARRIER_LABEL[detail.carrier];
  // Opens on the statement's total, so adding or dropping an order re-splits
  // it rather than changing what the carrier keeps. Clearing it falls back to
  // each order's saved charge.
  const charges = useCarrierCharges(
    Object.fromEntries(detail.items.map((item) => [item.codCollectionId, String(item.carrierCharge)])),
    String(detail.carrierCharges),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // COD per order, for every order either table has shown.
  const collected = useRef(new Map<string, number>());
  const remember = (orders: EditableOrder[]) => {
    orders.forEach((order) => collected.current.set(order.id, order.amount));
    return orders;
  };

  const currentOrders = remember(
    detail.items.map((item) => ({
      id: item.codCollectionId,
      trackingId: item.trackingId,
      receiverName: item.receiverName,
      amount: item.collectedAmount,
    })),
  );

  const loadAddable = useCallback(async () => ({
    orders: remember(
      (await getUnsettledCarrierOrders(detail.carrier)).map((order) => ({
        id: order.codCollectionId,
        trackingId: order.trackingId,
        receiverName: order.receiverName,
        amount: order.collectedAmount,
      })),
    ),
  }), [detail.carrier]);

  const chargeMap = charges.chargesFor(selectedIds);

  return (
    <StatementEditModal
      currentOrders={currentOrders}
      loadAddable={loadAddable}
      amountLabel="COD"
      payeeNoun="carrier"
      onSelectionChange={setSelectedIds}
      extraColumn={{
        header: `${label} Charge`,
        render: (order, included) => (
          <CarrierChargeInput
            charges={charges}
            id={order.id}
            share={included ? chargeMap.get(order.id) : undefined}
            label={`${label} charge on ${order.trackingId}`}
          />
        ),
      }}
      totalOf={(ids) => round2(ids.reduce((sum, id) => sum + (collected.current.get(id) ?? 0) - (chargeMap.get(id) ?? 0), 0))}
      onSave={async (ids) => {
        const items = ids.map((id) => ({ codCollectionId: id, carrierCharge: chargeMap.get(id) ?? 0 }));
        const over = items.find((item) => item.carrierCharge < 0 || item.carrierCharge > (collected.current.get(item.codCollectionId) ?? 0));
        if (over) throw new Error('Each charge must be between 0 and the COD on that order.');
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
