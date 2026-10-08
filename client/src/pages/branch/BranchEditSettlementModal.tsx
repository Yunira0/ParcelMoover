import React, { useCallback } from 'react';
import StatementEditModal from '../../components/StatementEditModal';
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
  const { commissionPerParcel } = detail;

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
      orders: list.map((order) => {
        const collected = order.collectedAmount || 0;
        return {
          id: order.id,
          trackingId: order.trackingId,
          receiverName: order.receiverName,
          amount: Math.max(0, collected - Math.min(commissionPerParcel, collected)),
        };
      }),
      capped: list.length >= ORDER_PAGE_SIZE,
    };
  }, [detail.fromBranch.id, commissionPerParcel]);

  return (
    <StatementEditModal
      currentOrders={detail.items.map((item) => ({
        id: item.parcelId,
        trackingId: item.trackingId,
        receiverName: item.receiverName,
        amount: item.netPayable,
      }))}
      loadAddable={loadAddable}
      amountLabel="Net payable"
      payeeNoun="branch"
      onSave={async (selected) => {
        await updateBranchSettlement(detail.id, selected.map((order) => order.id));
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
};

export default BranchEditSettlementModal;
