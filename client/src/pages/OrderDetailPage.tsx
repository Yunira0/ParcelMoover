import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, ShieldAlert } from 'lucide-react';
import {
  addOrderRemark,
  updateOrderStatus,
  redirectOrder,
  forwardOrder,
  updateOrder,
  type OrderDetail,
  type OrderRemark,
  type ParcelStatus,
  type UpdateOrderInput,
} from '../services/orders.service';
import OrderDetailHeader, { STATUS_LABEL } from '../components/order-detail/OrderDetailHeader';
import { getCurrentUserRoles, isAccountantUser, isVendorSide, hasAdminPermission } from '../utils/auth';
import OrderInfoCards from '../components/order-detail/OrderInfoCards';
import OrderTimeline from '../components/order-detail/OrderTimeline';
import OrderRemarks from '../components/order-detail/OrderRemarks';
import OrderRemarkInput from '../components/order-detail/OrderRemarkInput';
import OrderPriceLog from '../components/order-detail/OrderPriceLog';
import OrderRedirectLog from '../components/order-detail/OrderRedirectLog';
import RedirectOrderModal from '../components/RedirectOrderModal';
import ForwardOrderModal from '../components/ForwardOrderModal';
import { printLabels } from '../utils/printLabels';
import { queryKeys } from '../queries/keys';
import { orderDetailQuery } from '../queries/orders';
import './OrderDetailPage.css';

// Statuses whose transition needs structured extra data (a rider pick, COD
// amounts, a destination hub) - those keep their dedicated ops flows and are
// left out of the raw super_admin override dropdown.
const OVERRIDE_EXCLUDED: ParcelStatus[] = [
  'rider_assigned',
  'sent_for_delivery',
  'partially_delivered',
];

// Mirrors REDIRECT_ALLOWED_STATUSES in order.service.ts — a parcel can only be
// re-routed while it hasn't reached a final resting state. Keep in sync, or the
// button offers an action the server refuses.
const REDIRECTABLE_STATUSES: ParcelStatus[] = [
  'pickup_ordered',
  'rider_assigned',
  'picked_up',
  'arrived',
  'ready_to_deliver',
  'sent_for_delivery',
  'oov',
  'dispatched',
  'arrived_at_branch',
  'hold',
  'failed_delivery',
  'follow_up',
];

// Mirrors EDIT_BLOCKED_STATUSES in order.service.ts — a parcel that has
// reached a terminal state is settled paperwork and must never be offered
// for edit, by anyone.
const EDIT_BLOCKED_STATUSES: ParcelStatus[] = [
  'delivered',
  'partially_delivered',
  'cancelled',
  'returned_to_vendor',
  'loss_and_damage',
];

// Mirrors VENDOR_EDITABLE_STATUSES in order.service.ts — a vendor may only
// edit while the parcel is still theirs to hand over; once it's in the
// network, changes go through ops staff instead.
const VENDOR_EDITABLE_STATUSES: ParcelStatus[] = [
  'pickup_ordered',
  'rider_assigned',
  'failed_pickup',
];

const OrderDetailPage: React.FC = () => {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orderKey = queryKeys.orders.detail(trackingId ?? '');
  // A revisit paints the cached parcel at once and refetches behind it; any
  // order change in this tab refetches it too (queryClient.ts). A failed
  // background refetch keeps the parcel on screen rather than blanking it.
  const orderQuery = useQuery({
    ...orderDetailQuery(trackingId ?? ''),
    enabled: Boolean(trackingId),
  });
  const order: OrderDetail | null = orderQuery.data?.success ? orderQuery.data.data : null;
  const loading = orderQuery.isPending && Boolean(trackingId);
  const error = orderQuery.isError
    ? 'Failed to load order details. Please try again.'
    : orderQuery.data && !orderQuery.data.success ? 'Order not found.' : null;
  // Every mutation used below announces itself, which already started the
  // refetch - wait for that one instead of starting a second.
  const fetchOrder = () => orderQuery.refetch({ cancelRefetch: false });
  const [replyingTo, setReplyingTo] = useState<OrderRemark | null>(null);
  const [highlightedRemarkId, setHighlightedRemarkId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // super_admin or FORCE_STATUS_CHANGE: force the parcel into any status,
  // ignoring the transition map (the server grants the same bypass).
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const canForceStatus = hasAdminPermission('FORCE_STATUS_CHANGE');
  const [overrideStatus, setOverrideStatus] = useState<ParcelStatus | ''>('');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  // Redirect (customer moved) and forwarding: admins and the accountant, same as the server routes.
  const isAdmin = getCurrentUserRoles().some((r) => ['admin', 'super_admin'].includes(r));
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectSaving, setRedirectSaving] = useState(false);
  const [redirectError, setRedirectError] = useState('');
  // Forwarding charge — a delivered parcel forwarded on to another destination.
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardSaving, setForwardSaving] = useState(false);
  const [forwardError, setForwardError] = useState('');

  // Edit parcel details — inline, field by field, directly on the details
  // card (OrderInfoCards). Ops staff can edit any non-terminal parcel; a
  // vendor/vendor_staff actor only while it's still theirs to hand over.
  // Matches EDIT_BLOCKED_STATUSES / VENDOR_EDITABLE_STATUSES on the server so
  // the card never offers an edit the API would then refuse.
  const isVendorActor = isVendorSide();
  const handleSaveOrderField = async (patch: UpdateOrderInput) => {
    if (!order) return;
    await updateOrder(order.id, patch);
    await fetchOrder();
  };

  const handleAddRemark = async (remark: string, parentRemarkId?: string | null) => {
    if (!order) return;
    const response = await addOrderRemark(order.id, remark, parentRemarkId);
    if (response.success) {
      const newRemark = response.data;
      queryClient.setQueryData<{ success: boolean; data: OrderDetail }>(orderKey, (prev) =>
        prev?.success ? { ...prev, data: { ...prev.data, remarks: [...prev.data.remarks, newRemark] } } : prev,
      );
      setHighlightedRemarkId(newRemark.id);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = setTimeout(() => setHighlightedRemarkId(null), 2500);
      setReplyingTo(null);
    }
  };

  const handleReply = (remark: OrderRemark) => {
    setReplyingTo(remark);
  };

  const handlePrint = () => {
    if (!order) return;
    const { remarks, statusHistory, canChangeStatus, redirectLog, ...orderFields } = order;
    void printLabels([orderFields]);
  };

  const handleOverrideStatus = async () => {
    if (!order || !overrideStatus || overrideStatus === order.status) return;
    try {
      setOverrideSaving(true);
      setOverrideError('');
      await updateOrderStatus(order.id, overrideStatus, overrideRemarks.trim() || undefined);
      setOverrideStatus('');
      setOverrideRemarks('');
      await fetchOrder();
    } catch (err: any) {
      setOverrideError(err?.response?.data?.message ?? 'Failed to update status');
    } finally {
      setOverrideSaving(false);
    }
  };

  const handleRedirect = async (data: {
    destinationLocationId: string;
    address: string;
    reason: string;
    redirectCharge: number;
  }) => {
    if (!order) return;
    try {
      setRedirectSaving(true);
      setRedirectError('');
      await redirectOrder(order.id, data);
      setRedirectOpen(false);
      await fetchOrder();
    } catch (err: any) {
      setRedirectError(err?.response?.data?.message ?? 'Failed to redirect order');
    } finally {
      setRedirectSaving(false);
    }
  };

  const handleForward = async (data: {
    destinationLocationId: string;
    forwardingCharge: number;
    reason?: string;
  }) => {
    if (!order) return;
    try {
      setForwardSaving(true);
      setForwardError('');
      await forwardOrder(order.id, data);
      setForwardOpen(false);
      await fetchOrder();
    } catch (err: any) {
      setForwardError(err?.response?.data?.message ?? 'Failed to add forwarding charge');
    } finally {
      setForwardSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="od-page">
        <div className="od-container">
          <div className="od-loading">
            <div className="od-skeleton od-skeleton-header" />
            <div className="od-skeleton od-skeleton-card" />
            <div className="od-skeleton od-skeleton-timeline" />
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="od-page">
        <div className="od-container">
          <button className="od-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            Back
          </button>
          <div className="od-empty">
            <div className="od-empty-icon">
              <Package size={24} strokeWidth={1.5} />
            </div>
            <h3>{error || 'Order not found'}</h3>
            <p>The order you are looking for does not exist or has been removed.</p>
          </div>
        </div>
      </div>
    );
  }

  const isEditBlocked = EDIT_BLOCKED_STATUSES.includes(order.status);
  // Office staff edit order details: admins and the accountant (finance corrections).
  const isOfficeEditor = isAdmin || isAccountantUser();
  const canEditNow = isOfficeEditor ? !isEditBlocked : isVendorActor && VENDOR_EDITABLE_STATUSES.includes(order.status);
  // Hidden outright for a terminal parcel or a viewer with no edit permission
  // at all (rider/sales); disabled-with-reason only for the vendor window
  // that closes once ops has the parcel, since that's a temporary, explainable
  // state worth surfacing rather than a settled one worth hiding.
  const showEditDisabled = !canEditNow && !isEditBlocked && isVendorActor;
  // Narrow escape hatch: super_admin, the accountant, or an admin holding
  // EDIT_SETTLEMENTS may still fix the COD amount on an otherwise-locked
  // (delivered/RTV/RTO) parcel — every other field stays locked. Server
  // re-enforces this exactly; this only decides whether to offer the affordance.
  const canOverrideCod = isSuperAdmin || isAccountantUser() || (isAdmin && hasAdminPermission('EDIT_SETTLEMENTS'));
  const codEditable = canEditNow || canOverrideCod;

  return (
    <div className="od-page">
      <div className="od-container">
        <button className="od-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          Back to orders
        </button>

        <OrderDetailHeader
          trackingId={order.trackingId}
          orderNumber={order.orderNumber}
          status={order.status}
          orderType={order.orderType}
          serviceType={order.serviceType}
          createdAt={order.createdAtRaw}
          orderId={order.id}
          onPrint={handlePrint}
        />

        {canForceStatus && (
          <div className="od-override">
            <div className="od-override-title">
              <ShieldAlert size={15} />
              <span>Force status</span>
            </div>
            <div className="od-override-controls">
              <select
                className="od-override-select"
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value as ParcelStatus | '')}
                disabled={overrideSaving}
                aria-label="New status"
              >
                <option value="">Select new status...</option>
                {(Object.keys(STATUS_LABEL) as ParcelStatus[])
                  .filter((s) => s !== order.status && !OVERRIDE_EXCLUDED.includes(s))
                  .map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
              </select>
              <input
                className="od-override-remarks"
                type="text"
                placeholder="Remarks (optional)"
                value={overrideRemarks}
                onChange={(e) => setOverrideRemarks(e.target.value)}
                disabled={overrideSaving}
              />
              <button
                className="od-override-apply"
                onClick={handleOverrideStatus}
                disabled={overrideSaving || !overrideStatus}
              >
                {overrideSaving ? 'Applying...' : 'Apply'}
              </button>
            </div>
            {overrideError && <p className="od-override-error">{overrideError}</p>}
          </div>
        )}

        <OrderInfoCards
          senderName={order.senderName}
          senderPhone={order.senderPhone}
          senderAddress={order.senderAddress}
          receiverName={order.receiverName}
          receiverPhone={order.receiverPhone}
          receiverAlternatePhone={order.receiverAlternatePhone}
          receiverAddress={order.receiverAddress}
          origin={order.origin}
          destination={order.destination}
          destinationLocationId={order.destinationLocationId}
          codAmount={order.codAmount}
          itemValue={order.itemValue}
          deliveryCharge={order.deliveryCharge}
          grossDeliveryCharge={order.grossDeliveryCharge}
          discountAmount={order.discountAmount}
          voucher={order.voucher ?? null}
          pieces={order.pieces}
          weightKg={order.weightKg}
          editable={canEditNow}
          codEditable={codEditable}
          lockedReason={
            showEditDisabled
              ? 'Editing locks once the parcel is picked up — contact support for changes.'
              : undefined
          }
          onSave={handleSaveOrderField}
        />

        <div className="od-activity">
          <div className="od-activity-left">
            <div className="od-section-header">
              <h2>Status Timeline</h2>
              <span className="od-section-count">{order.statusHistory.length}</span>
            </div>
            <OrderTimeline
              statusHistory={order.statusHistory}
              currentStatus={order.status}
              showCarrierBadge={!isVendorActor}
            />
          </div>
          <div className="od-activity-right">
            <div className="od-remarks-header">
              <h2>Remarks</h2>
              <span className="od-section-count">{order.remarks.length}</span>
            </div>
            <OrderRemarks
              remarks={order.remarks}
              onReply={handleReply}
              highlightedRemarkId={highlightedRemarkId}
            />
            {/* The accountant reads orders only; the remark API refuses it. */}
            {!isAccountantUser() && (
              <OrderRemarkInput
                onSubmit={handleAddRemark}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
              />
            )}
          </div>
        </div>

        <div className="od-pricelog">
          <div className="od-section-header">
            <h2>Price Log</h2>
            <span className="od-section-count">{order.priceLog.length}</span>
          </div>
          <OrderPriceLog entries={order.priceLog} />

          <div className="od-section-header od-section-header-divided">
            <h2>Redirect / Forward Log</h2>
            <span className="od-section-count">{order.redirectLog.length}</span>
            {isOfficeEditor && (order.status === 'delivered' || REDIRECTABLE_STATUSES.includes(order.status)) && (
              <button
                type="button"
                className="od-section-action"
                onClick={() => {
                  // Same slot as redirect: once delivered, the action becomes a forward.
                  if (order.status === 'delivered') {
                    setForwardError('');
                    setForwardOpen(true);
                  } else {
                    setRedirectError('');
                    setRedirectOpen(true);
                  }
                }}
              >
                {order.status === 'delivered' ? 'Forward order' : 'Redirect order'}
              </button>
            )}
          </div>
          <OrderRedirectLog entries={order.redirectLog} />
        </div>
      </div>

      <RedirectOrderModal
        isOpen={redirectOpen}
        trackingId={order.trackingId}
        currentBranch={order.destination}
        currentAddress={order.receiverAddress}
        currentDeliveryCharge={order.deliveryCharge}
        busy={redirectSaving}
        error={redirectError}
        onClose={() => setRedirectOpen(false)}
        onConfirm={handleRedirect}
      />

      <ForwardOrderModal
        isOpen={forwardOpen}
        trackingId={order.trackingId}
        currentBranch={order.destination}
        currentDeliveryCharge={order.deliveryCharge}
        busy={forwardSaving}
        error={forwardError}
        onClose={() => setForwardOpen(false)}
        onConfirm={handleForward}
      />
    </div>
  );
};

export default OrderDetailPage;
