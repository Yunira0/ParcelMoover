import React from 'react';
import DashboardHeader from '../../components/DashboardHeader';
import VendorNoticeBanner from '../../components/vendor/VendorNoticeBanner';
import VendorQuickActions from '../../components/vendor/VendorQuickActions';
import VendorAnnouncements from '../../components/vendor/VendorAnnouncements';
import VendorOverviewCards from '../../components/vendor/VendorOverviewCards';
import OrdersTrendDonut from '../../components/vendor/OrdersTrendDonut';
import VendorOrdersTrendChart from '../../components/vendor/VendorOrdersTrendChart';
import VendorCodCard from '../../components/vendor/VendorCodCard';
import VendorTodayPanel from '../../components/vendor/VendorTodayPanel';
import VendorOrderDetails from '../../components/vendor/VendorOrderDetails';
import { EMPTY_VALLEY_SPLIT, type DashboardSummary } from '../../services/orders.service';
import { getCurrentUser, getCurrentUserRoles, hasStaffPermission } from '../../utils/auth';
import { useDashboardSummary } from '../../queries/dashboard';
import './VendorDashboard.css';

const EMPTY_SUMMARY: DashboardSummary = {
  overview: {
    totalOrders: 0,
    totalOrderAmount: 0,
    pendingPickups: 0,
    pendingPickupsAmount: 0,
    pendingReturns: 0,
    pendingReturnsAmount: 0,
    inTransit: 0,
    inTransitAmount: 0,
    pendingDeliveries: 0,
    pendingDeliveriesAmount: 0,
    awaitingPickup: 0,
    awaitingPickupAmount: 0,
    inDelivery: 0,
    inDeliveryAmount: 0,
    totalDelivered: 0,
    totalDeliveredAmount: 0,
    totalReturns: 0,
    totalReturnsAmount: 0,
    totalReturnedToVendor: 0,
    totalReturnedToVendorAmount: 0,
  },
  today: {
    totalOrders: 0,
    delivered: 0,
    deliveredAmount: 0,
    inTransit: 0,
    returns: 0,
    returnedToVendor: 0,
    remarks: 0,
    unclosedComments: 0,
  },
  sla: {
    overduePickup: 0,
    overdueDelivery: 0,
    overdueTransit: 0,
    overdueRemarks: 0,
    overdueBranchCod: 0,
    overdueBranchCodAmount: 0,
    branchCodHours: null,
    overdueReturn: 0,
    pickupHours: null,
    deliveryHours: null,
    transitHours: null,
    remarksHours: null,
    returnHours: null,
    pickupBreaches: [],
    deliveryBreaches: [],
    transitBreaches: [],
    returnBreaches: [],
    deliveryByValley: EMPTY_VALLEY_SPLIT,
  },
  codSettlement: {
    totalCod: 0,
    settledCod: 0,
    pendingCod: 0,
    codFromRiders: 0,
    codFromPmRider: 0,
    codFromNcm: 0,
    codFromUpaya: 0,
    codFromBranches: 0,
    pendingDeliveryCharge: 0,
    deliveryCharge: 0,
    progressPercent: 0,
    scopedToRider: false,
    lastAmount: 0,
    lastSettledAt: null,
  },
  weeklyTrend: [],
  updatedAt: new Date().toISOString(),
};

const VendorDashboard: React.FC = () => {
  const summaryQuery = useDashboardSummary();
  const summary: DashboardSummary =
    summaryQuery.data?.success && summaryQuery.data.data ? summaryQuery.data.data : EMPTY_SUMMARY;
  const loading = summaryQuery.isPending;
  const error = summaryQuery.isError || (summaryQuery.data && !summaryQuery.data.success)
    ? 'Dashboard data is unavailable.'
    : '';

  const { overview, today, codSettlement, weeklyTrend } = summary;
  const canSeeCod = !getCurrentUserRoles().includes('vendor_staff') || hasStaffPermission('FINANCE_ACCESS');

  return (
    <div className="vendor-dashboard">
      <DashboardHeader
        user={getCurrentUser()?.fullName || ''}
      />

      <VendorNoticeBanner />
      <VendorQuickActions />

      {error && <p className="vendor-dashboard-error">{error}</p>}

      <div className="vendor-dashboard-card">

        {/* 7 coloured metric cards */}
        <VendorOverviewCards
          totalOrders={overview.totalOrders}
          totalOrderAmount={overview.totalOrderAmount}
          delivered={overview.totalDelivered}
          deliveredAmount={overview.totalDeliveredAmount}
          rtvDelivered={overview.totalReturnedToVendor}
          rtvDeliveredAmount={overview.totalReturnedToVendorAmount}
          inTransit={overview.inTransit}
          inTransitAmount={overview.inTransitAmount}
          inProgress={overview.inDelivery}
          inProgressAmount={overview.inDeliveryAmount}
          pendingPickup={overview.awaitingPickup}
          pendingPickupAmount={overview.awaitingPickupAmount}
          returnProcess={overview.pendingReturns}
          returnProcessAmount={overview.pendingReturnsAmount}
          loading={loading}
          showAmounts={canSeeCod}
        />

        {/* Charts + side panel */}
        <div className="vendor-dashboard-main-row">
          <div className="vendor-dashboard-charts-col">
            <OrdersTrendDonut
              delivered={overview.totalDelivered}
              returns={overview.totalReturnedToVendor}
              loading={loading}
            />
            <VendorOrdersTrendChart data={weeklyTrend} loading={loading} />
            <VendorAnnouncements />
          </div>

          <div className="vendor-dashboard-side-col">
            <VendorTodayPanel
              orders={today.totalOrders}
              delivered={today.delivered}
              returns={today.returnedToVendor}
              remarks={today.remarks}
              loading={loading}
            />
            {canSeeCod && <VendorCodCard data={codSettlement} loading={loading} />}
          </div>
        </div>

        <VendorOrderDetails />
      </div>
    </div>
  );
};

export default VendorDashboard;
