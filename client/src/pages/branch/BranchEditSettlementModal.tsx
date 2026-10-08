import React, { useCallback, useRef } from 'react';
import StatementEditModal, { type EditableOrder } from '../../components/StatementEditModal';
import { getBranchOrders, updateBranchSettlement, type BranchSettlementDetail } from '../../services/branchTracking.service';

/** Same page size the create screen loads eligible orders with. */
const ORDER_PAGE_SIZE = 100;

/**
 * Edit an unpaid branch statement's orders. Each order is worth its COD less
 * the statement's own commission per parcel, which the edit never changes.
 */
const BranchEditSettlementModal: React.FC<{
  detail: BranchSettlementDetail;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ detail, onClose, onSuccess }) => {
  const netOf = (collected: number) => Math.max(0, collected - Math.min(detail.commissionPerParcel, collected));
  // Net per order, for every order either table has shown.
  const amounts = useRef(new Map<string, number>());
  const remember = (orders: EditableOrder[]) => {
    orders.forEach((order) => amounts.current.set(order.id, order.amount));
    return orders;
  };

  const currentOrders = remember(
    detail.items.map((item) => ({
      id: item.parcelId,
      trackingId: item.trackingId,
      receiverName: item.receiverName,
      amount: item.netPayable,
    })),
  );

  const loadAddable = useCallback(async () => {
    // The create screen's lookup: delivered by the paying branch, on no statement.
    const res = await getBranchOrders({
      toBranchId: detail.fromBranch.id,
      metric: 'pendingDeposit',
      availableForSettlement: true,
      pageSize: ORDER_PAGE_SIZE,
    });
    const list = Array.isArray(res.data) ? res.data : [];
    return {
      orders: remember(
        list.map((order) => ({
          id: order.id,
          trackingId: order.trackingId,
          receiverName: order.receiverName,
          amount: netOf(order.collectedAmount || 0),
        })),
      ),
      capped: list.length >= ORDER_PAGE_SIZE,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.fromBranch.id]);

  return (
    <StatementEditModal
      currentOrders={currentOrders}
      loadAddable={loadAddable}
      amountLabel="Net payable"
      payeeNoun="branch"
      totalOf={(ids) => ids.reduce((sum, id) => sum + (amounts.current.get(id) ?? 0), 0)}
      onSave={async (ids) => {
        await updateBranchSettlement(detail.id, ids);
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
};

export default BranchEditSettlementModal;
