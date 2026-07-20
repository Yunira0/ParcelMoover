import React, { useCallback, useEffect, useState } from 'react';
import DashboardHeader from '../../components/DashboardHeader';
import SalesQuickActions from '../../components/sales/SalesQuickActions';
import SalesTicketsPanel from '../../components/sales/SalesTicketsPanel';
import SalesTopVendors from '../../components/sales/SalesTopVendors';
import VendorOverviewCards from '../../components/vendor/VendorOverviewCards';
import OrdersTrendDonut from '../../components/vendor/OrdersTrendDonut';
import VendorOrdersTrendChart from '../../components/vendor/VendorOrdersTrendChart';
import VendorTodayPanel from '../../components/vendor/VendorTodayPanel';
import { getDashboardSummary, type DashboardSummary } from '../../services/orders.service';
import { getCurrentUser } from '../../utils/auth';
import './SalesDashboard.css';

const REFRESH_INTERVAL_MS = 15_000;

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
    overdueReturn: 0,
    pickupHours: null,
    deliveryHours: null,
    transitHours: null,
    remarksHours: null,
    returnHours: null,
  },
  codSettlement: {
    totalCod: 0,
    settledCod: 0,
    pendingCod: 0,
    codFromRider: 0,
    pendingDeliveryCharge: 0,
    progressPercent: 0,
    scopedToRider: false,
    lastAmount: 0,
    lastSettledAt: null,
  },
  weeklyTrend: [],
  updatedAt: new Date().toISOString(),
};

// Sales dashboard reuses the same /orders/dashboard-summary endpoint as
// VendorDashboard - the backend already scopes it to the parcels of the
// vendors this sales rep owns (vendors.sales_user_id), so no separate
// endpoint or client-side filtering is needed here.
const SalesDashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      const res = await getDashboardSummary();
      if (res?.success && res.data) {
        setSummary(res.data);
        setError('');
      } else {
        setError('Dashboard data is unavailable.');
      }
    } catch {
      setError('Dashboard data is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const intervalId = window.setInterval(() => loadSummary(), REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) loadSummary();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSummary]);

  const { overview, today, weeklyTrend } = summary;

  return (
    <div className="sales-dashboard">
      <DashboardHeader user={getCurrentUser()?.fullName || ''} />

      <SalesQuickActions />

      {error && <p className="sales-dashboard-error">{error}</p>}

      <div className="sales-dashboard-card">
        <VendorOverviewCards
          totalOrders={overview.totalOrders}
          totalOrderAmount={overview.totalOrderAmount}
          delivered={overview.totalDelivered}
          deliveredAmount={overview.totalDeliveredAmount}
          rtvDelivered={overview.totalReturnedToVendor}
          rtvDeliveredAmount={overview.totalReturnedToVendorAmount}
          inDelivery={overview.inTransit}
          inDeliveryAmount={overview.inTransitAmount}
          pendingPickup={overview.pendingPickups}
          pendingPickupAmount={overview.pendingPickupsAmount}
          returnProcess={overview.pendingReturns}
          returnProcessAmount={overview.pendingReturnsAmount}
          loading={loading}
        />

        <div className="sales-dashboard-main-row">
          <div className="sales-dashboard-charts-col">
            <OrdersTrendDonut
              delivered={overview.totalDelivered}
              returns={overview.totalReturnedToVendor}
              loading={loading}
            />
            <VendorOrdersTrendChart data={weeklyTrend} loading={loading} />
          </div>

          <div className="sales-dashboard-side-col">
            <VendorTodayPanel
              orders={today.totalOrders}
              delivered={today.delivered}
              returns={today.returnedToVendor}
              remarks={today.remarks}
              loading={loading}
            />
            <SalesTicketsPanel />
          </div>
        </div>

        <SalesTopVendors />
      </div>
    </div>
  );
};

export default SalesDashboard;
