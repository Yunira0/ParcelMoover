import React, { useCallback, useEffect, useMemo, useState } from 'react';
import OverviewMetrics from '../components/OverviewMetrics';
import CODSettlement from '../components/CODSettlement';
import TodayOverview from '../components/TodayOverview';
import WeeklyStats from '../components/WeeklyStats';
import DashboardHeader from '../components/DashboardHeader';
import QuickActions from '../components/QuickActions';
import RecentOrders from '../components/RecentOrders';
import TopVendors from '../components/TopVendors';
import NeedsAttention from '../components/NeedsAttention';
import { getDashboardSummary, type DashboardSummary } from '../services/orders.service';
import { getCurrentUser } from '../utils/auth';
import './Dashboard.css';

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
    progressPercent: 0,
    scopedToRider: false,
    lastAmount: 0,
    lastSettledAt: null,
  },
  weeklyTrend: [],
  updatedAt: new Date().toISOString(),
};

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  // initialLoading only covers the very first fetch - it's what blanks the
  // stat cards, COD Settlement, and Today's Overview to a loading state.
  // chartLoading is scoped to the Weekly Stats period toggle, which refetches
  // the whole summary just to get new trend data; without the split, that
  // refetch used to blank the unrelated money/status widgets too.
  const [initialLoading, setInitialLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState('');
  const [trendPeriod, setTrendPeriod] = useState<7 | 30>(7);

  const handlePeriodChange = useCallback((p: 7 | 30) => {
    setChartLoading(true);
    setTrendPeriod(p);
  }, []);

  // Real period-over-period delta for "Delivered today" from the daily trend
  // (last day vs the previous day). Snapshot metrics have no stored history, so
  // they show no delta until the backend supplies previous-period counts.
  const deltas = useMemo(() => {
    const t = summary.weeklyTrend;
    if (t.length < 2) return undefined;
    const prev = t[t.length - 2].delivered;
    if (!prev) return undefined;
    const pct = Math.round(((t[t.length - 1].delivered - prev) / prev) * 100);
    return { deliveredToday: pct } as const;
  }, [summary.weeklyTrend]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await getDashboardSummary(trendPeriod);
      if (res?.success && res.data) {
        setSummary(res.data);
        setError('');
      } else {
        setError('Dashboard data is unavailable.');
      }
    } catch {
      setError('Dashboard data is unavailable.');
    } finally {
      setInitialLoading(false);
      setChartLoading(false);
    }
  }, [trendPeriod]);

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
    <div className="dashboard-container">

      <DashboardHeader
        user={getCurrentUser()?.fullName || ''}
      />

      <div className="overview-section">
        <div className="overview-heading">
          <div>
            <h2 className="overview-title">Realtime Overview</h2>
            <p className="overview-meta">
              {error || `Last updated ${formatUpdatedAt(summary.updatedAt)}`}
            </p>
          </div>
        </div>
        <OverviewMetrics
          overview={summary.overview}
          today={summary.today}
          loading={initialLoading}
          deltas={deltas}
        />
      </div>

      <QuickActions />

      <div className="dashboard-row">
        <div className="grid-left">
          <WeeklyStats
            data={summary.weeklyTrend}
            loading={initialLoading || chartLoading}
            period={trendPeriod}
            onPeriodChange={handlePeriodChange}
          />
        </div>
        <CODSettlement data={summary.codSettlement} loading={initialLoading} />
      </div>

      <div className="dashboard-row">
        <div className="dashboard-panel">
          <RecentOrders />
        </div>
        <div className="dashboard-panel">
          <TodayOverview today={summary.today} overview={summary.overview} loading={initialLoading} />
        </div>
      </div>

      <div className="dashboard-row dashboard-row-split">
        <div className="dashboard-panel">
          <TopVendors />
        </div>
        <div className="dashboard-panel">
          <NeedsAttention
            sla={summary.sla}
            loading={initialLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
