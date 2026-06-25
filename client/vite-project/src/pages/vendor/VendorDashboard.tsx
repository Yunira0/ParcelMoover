import React, { useCallback, useEffect, useState } from 'react';
import VendorQuickActions from '../../components/vendor/VendorQuickActions';
import VendorOverviewStrip from '../../components/vendor/VendorOverviewStrip';
import VendorOverviewCards from '../../components/vendor/VendorOverviewCards';
import OrdersTrendDonut from '../../components/vendor/OrdersTrendDonut';
import VendorOrdersTrendChart from '../../components/vendor/VendorOrdersTrendChart';
import VendorCodCard from '../../components/vendor/VendorCodCard';
import VendorOrderDetails from '../../components/vendor/VendorOrderDetails';
import { getDashboardSummary, type DashboardSummary } from '../../services/orders.service';
import './VendorDashboard.css';

const REFRESH_INTERVAL_MS = 15_000;

const EMPTY_SUMMARY: DashboardSummary = {
  overview: {
    totalOrders: 0,
    pendingPickups: 0,
    pendingReturns: 0,
    inTransit: 0,
    pendingDeliveries: 0,
    totalDelivered: 0,
    totalReturns: 0,
  },
  today: {
    totalOrders: 0,
    delivered: 0,
    inTransit: 0,
    returns: 0,
    remarks: 0,
    unclosedComments: 0,
  },
  codSettlement: {
    totalCod: 0,
    settledCod: 0,
    pendingCod: 0,
    progressPercent: 0,
    scopedToRider: false,
    lastAmount: 0,
    lastSettledAt: null,
  },
  weeklyTrend: [],
  updatedAt: new Date().toISOString(),
};

const VendorDashboard: React.FC = () => {
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

  return (
    <div className="vendor-dashboard">
      <VendorQuickActions />

      {error && <p className="vendor-dashboard-error">{error}</p>}

      <div className="vendor-dashboard-card">
        <VendorOverviewStrip
          orders={summary.today.totalOrders}
          delivered={summary.today.delivered}
          returns={summary.today.returns}
          remarks={summary.today.remarks}
          unclosedComments={summary.today.unclosedComments}
          loading={loading}
        />

        <VendorOverviewCards
          orders={summary.overview.totalOrders}
          delivered={summary.overview.totalDelivered}
          processing={summary.overview.inTransit}
          returns={summary.overview.totalReturns}
          loading={loading}
        />

        <div className="vendor-dashboard-charts-row">
          <OrdersTrendDonut delivered={summary.today.delivered} returns={summary.today.returns} loading={loading} />
          <VendorOrdersTrendChart data={summary.weeklyTrend} loading={loading} />
          <VendorCodCard data={summary.codSettlement} loading={loading} />
        </div>

        <VendorOrderDetails />
      </div>
    </div>
  );
};

export default VendorDashboard;
