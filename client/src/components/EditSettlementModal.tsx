import React, { useCallback, useRef } from 'react';
import StatementEditModal, { type EditableOrder } from './StatementEditModal';
import {
  getUnsettledOrders,
  updateSettlement,
  type PayeeType,
  type SettlementDetailItem,
} from '../services/finance.service';

interface EditSettlementModalProps {
  settlementId: string;
  payeeType: PayeeType;
  payeeId: string;
  currentItems: SettlementDetailItem[];
  onClose: () => void;
  onSuccess: () => void;
}

/** Edit a vendor or rider statement: a vendor order is worth its COD less the delivery charge, a rider's its COD. */
const EditSettlementModal: React.FC<EditSettlementModalProps> = ({
  settlementId,
  payeeType,
  payeeId,
  currentItems,
  onClose,
  onSuccess,
}) => {
  // Every order either window has shown, so the total can price any selection.
  const amounts = useRef(new Map<string, number>());
  const remember = (orders: EditableOrder[]) => {
    orders.forEach((order) => amounts.current.set(order.id, order.amount));
    return orders;
  };

  const currentOrders = remember(
    currentItems.map((item) => ({
      id: item.codCollectionId,
      trackingId: item.trackingId,
      receiverName: item.receiverName,
      amount: payeeType === 'vendor' ? item.collectedAmount - item.deliveryCharge : item.collectedAmount,
    })),
  );

  const loadAddable = useCallback(async () => {
    const res = await getUnsettledOrders(payeeType, payeeId);
    if (!res?.success) return { orders: [] };
    return {
      orders: remember(
        res.data.items.map((order) => ({
          id: order.codCollectionId,
          trackingId: order.trackingId,
          receiverName: order.receiverName,
          amount: order.netPayable,
        })),
      ),
      capped: !!res.data.capped,
    };
  }, [payeeType, payeeId]);

  return (
    <StatementEditModal
      currentOrders={currentOrders}
      loadAddable={loadAddable}
      amountLabel={payeeType === 'vendor' ? 'Net Payable' : 'Collected'}
      payeeNoun={payeeType}
      totalOf={(ids) => ids.reduce((sum, id) => sum + (amounts.current.get(id) ?? 0), 0)}
      onSave={async (ids) => {
        await updateSettlement(settlementId, ids);
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
};

export default EditSettlementModal;
