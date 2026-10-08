import React, { useCallback } from 'react';
import StatementEditModal from './StatementEditModal';
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
  const loadAddable = useCallback(async () => {
    const res = await getUnsettledOrders(payeeType, payeeId);
    if (!res?.success) return { orders: [] };
    return {
      orders: res.data.items.map((order) => ({
        id: order.codCollectionId,
        trackingId: order.trackingId,
        receiverName: order.receiverName,
        amount: order.netPayable,
      })),
      capped: !!res.data.capped,
    };
  }, [payeeType, payeeId]);

  return (
    <StatementEditModal
      currentOrders={currentItems.map((item) => ({
        id: item.codCollectionId,
        trackingId: item.trackingId,
        receiverName: item.receiverName,
        amount: payeeType === 'vendor' ? item.collectedAmount - item.deliveryCharge : item.collectedAmount,
      }))}
      loadAddable={loadAddable}
      amountLabel={payeeType === 'vendor' ? 'Net Payable' : 'Collected'}
      payeeNoun={payeeType}
      onSave={async (selected) => {
        await updateSettlement(settlementId, selected.map((order) => order.id));
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
};

export default EditSettlementModal;
