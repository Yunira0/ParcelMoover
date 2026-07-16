import React, { useCallback, useEffect, useState } from 'react';
import StatCard from '../components/StatCard';
import CODSettlement from '../components/CODSettlement';
import TodayOverview from '../components/TodayOverview';
import WeeklyStats from '../components/WeeklyStats';
import DashboardHeader from '../components/DashboardHeader';
import Button from '../components/Button';
import { getDashboardSummary, type DashboardSummary } from '../services/orders.service';
import { getCurrentUser } from '../utils/auth';
import { 
  ClipboardList, 
  RefreshCw,
  RotateCcw, 
  Truck, 
  PackageCheck 
} from 'lucide-react';
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [trendPeriod, setTrendPeriod] = useState<7 | 30>(7);

  const loadSummary = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
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
      if (showRefreshing) setRefreshing(false);
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

  // Each card links to the screen where that number is actually worked
  // (status groups match the dashboard-summary SQL definitions).
  const stats = [
    {
      icon: ClipboardList,
      label: "PENDING PICKUPS",
      value: initialLoading ? '...' : summary.overview.pendingPickups.toLocaleString(),
      to: '/orders?tab=ready_to_pick',
    },
    {
      icon: RotateCcw,
      label: "Pending Return",
      value: initialLoading ? '...' : summary.overview.pendingReturns.toLocaleString(),
      to: '/return',
    },
    {
      icon: Truck,
      label: "In Transit",
      value: initialLoading ? '...' : summary.overview.inTransit.toLocaleString(),
      to: '/orders?tab=inprogress',
    },
    {
      icon: PackageCheck,
      label: "Pending Deliveries",
      value: initialLoading ? '...' : summary.overview.pendingDeliveries.toLocaleString(),
      to: '/orders?tab=inprogress&currentStatus=ready_to_deliver&currentStatus=sent_for_delivery&currentStatus=oov',
    }
  ];

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
          <Button
            variant="secondary"
            className="dashboard-refresh-btn"
            onClick={() => loadSummary(true)}
            disabled={refreshing}
            title="Refresh dashboard"
          >
            <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </Button>
        </div>
        <div className="stats-grid">
          {stats.map((stat, index) => (
            <StatCard key={index} {...stat} />
          ))}
        </div>
      </div>
      
      <div className="dashboard-main-grid">
        <div className="grid-left">
          <WeeklyStats
            data={summary.weeklyTrend}
            loading={initialLoading || chartLoading}
            period={trendPeriod}
            onPeriodChange={(p) => {
              setChartLoading(true);
              setTrendPeriod(p);
            }}
          />
        </div>
        <div className="grid-right">
          <CODSettlement data={summary.codSettlement} loading={initialLoading} />
          <TodayOverview data={summary.today} loading={initialLoading} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
