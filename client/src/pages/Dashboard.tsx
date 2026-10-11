import React, { useMemo, useState } from 'react';
import OverviewMetrics from '../components/OverviewMetrics';
import CODSettlement from '../components/CODSettlement';
import TodayOverview from '../components/TodayOverview';
import WeeklyStats from '../components/WeeklyStats';
import DashboardHeader from '../components/DashboardHeader';
import QuickActions from '../components/QuickActions';
import RecentOrders from '../components/RecentOrders';
import TopVendors from '../components/TopVendors';
import NeedsAttention from '../components/NeedsAttention';
import { EMPTY_VALLEY_SPLIT, type DashboardSummary } from '../services/orders.service';
import { getCurrentUser, isBranchWorkspaceUser } from '../utils/auth';
import { useDashboardSummary } from '../queries/dashboard';
import './Dashboard.css';

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

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const Dashboard: React.FC = () => {
  // A branch workspace gets a trimmed dashboard: no office-wide COD settlement
  // panel (it tracks COD in Branch COD / Rider COD instead). The top-vendors
  // panel is branch-scoped server-side, so it stays.
  const isBranch = isBranchWorkspaceUser();
  const [trendPeriod, setTrendPeriod] = useState<7 | 30>(7);

  // Switching the trend period keeps the previous summary on screen, so only
  // the chart shows a loading state - the money/status widgets never blank.
  const summaryQuery = useDashboardSummary(trendPeriod);
  const summary: DashboardSummary =
    summaryQuery.data?.success && summaryQuery.data.data ? summaryQuery.data.data : EMPTY_SUMMARY;
  // initialLoading only covers the very first fetch - it's what blanks the
  // stat cards, COD Settlement, and Today's Overview to a loading state.
  const initialLoading = summaryQuery.isPending;
  const chartLoading = summaryQuery.isPlaceholderData;
  const error = summaryQuery.isError || (summaryQuery.data && !summaryQuery.data.success)
    ? 'Dashboard data is unavailable.'
    : '';

  // Real period-over-period delta for "Delivered today" from the daily trend
  // (last day vs the previous day). Snapshot metrics have no stored history, so
  // they show no delta until the backend supplies previous-period counts.
  // Found by Nepal date rather than position, so a trend window that doesn't
  // end today can't compare the wrong two days.
  const deltas = useMemo(() => {
    const t = summary.weeklyTrend;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
    const todayIndex = t.findIndex((d) => d.date === today);
    if (todayIndex < 1) return undefined;
    const prev = t[todayIndex - 1].delivered;
    if (!prev) return undefined;
    const pct = Math.round(((t[todayIndex].delivered - prev) / prev) * 100);
    return { deliveredToday: pct } as const;
  }, [summary.weeklyTrend]);

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

      {isBranch ? (
        <>
          <WeeklyStats
            data={summary.weeklyTrend}
            loading={initialLoading || chartLoading}
            period={trendPeriod}
            onPeriodChange={setTrendPeriod}
          />

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
              <NeedsAttention sla={summary.sla} loading={initialLoading} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="dashboard-row">
            <div className="grid-left">
              <WeeklyStats
                data={summary.weeklyTrend}
                loading={initialLoading || chartLoading}
                period={trendPeriod}
                onPeriodChange={setTrendPeriod}
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
              <NeedsAttention sla={summary.sla} loading={initialLoading} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
